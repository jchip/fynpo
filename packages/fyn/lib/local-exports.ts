// @ts-nocheck
"use strict";

const Path = require("path");
const Fs = require("./util/file-ops");
const fynTil = require("./util/fyntil");
const { getUrlType } = require("./util/lifecycle-script-policy");

/* eslint-disable complexity, max-statements, no-magic-numbers, jsdoc/require-jsdoc */

const DEFAULT_ROOT_DIR = "_fyn";
const MANIFEST_FILE = ".fyn-local-exports.json";
const MANIFEST_VERSION = 1;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const posixify = value => value.split(Path.sep).join("/");

const rootOfEntry = entry => entry.root || DEFAULT_ROOT_DIR;

const emptyManifest = () => ({ version: MANIFEST_VERSION, exports: {} });

const packagePathParts = name => {
  const parts = typeof name === "string" ? name.split("/") : [];
  const scoped = parts.length === 2 && parts[0][0] === "@";
  const safe = scoped
    ? SAFE_NAME.test(parts[0].slice(1)) && SAFE_NAME.test(parts[1])
    : parts.length === 1 && SAFE_NAME.test(parts[0]);
  if (!safe) {
    throw new Error(`Invalid package name for fyn.localExports: ${name}`);
  }
  return parts;
};

const checkExportName = (packageName, exportName) => {
  if (!SAFE_NAME.test(exportName) || exportName === "." || exportName === "..") {
    throw new Error(
      `Invalid fyn.localExports export name ${JSON.stringify(exportName)} in ${packageName}`
    );
  }
};

const normalizeRootDir = (value, ctx) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${ctx} must be a non-empty relative directory`);
  }
  if (Path.isAbsolute(value) || Path.posix.isAbsolute(value) || Path.win32.isAbsolute(value)) {
    throw new Error(`${ctx} must not be absolute: ${value}`);
  }
  const parts = value.split(/[\\/]+/).filter(part => part && part !== ".");
  if (
    parts.length === 0 ||
    parts.includes("..") ||
    parts.includes("node_modules") ||
    parts.includes(".git")
  ) {
    throw new Error(`Unsafe ${ctx}: ${value}`);
  }
  return parts.join("/");
};

const nestsWithin = (parent, child) => {
  const relative = Path.posix.relative(parent, child);
  return relative !== "" && !relative.startsWith("..");
};

const assertNoNestedRoots = roots => {
  const uniq = [...new Set(roots)];
  for (const a of uniq) {
    for (const b of uniq) {
      if (a !== b && nestsWithin(a, b)) {
        throw new Error(`fyn local export directories must not nest: ${a} contains ${b}`);
      }
    }
  }
};

// Resolve the consumer-owned export directory configuration from the consuming
// package's merged fyn metadata: a default directory plus per-package overrides.
const resolveLocalExportsConfig = pkg => {
  const fyn = (pkg && pkg.fyn) || {};
  const defaultDir =
    fyn.localExportsDir === undefined
      ? DEFAULT_ROOT_DIR
      : normalizeRootDir(fyn.localExportsDir, "fyn.localExportsDir");
  const byPackage = {};
  const dirs = fyn.localExportsDirs;
  if (dirs !== undefined && dirs !== null) {
    if (typeof dirs !== "object" || Array.isArray(dirs)) {
      throw new Error("fyn.localExportsDirs must be an object of package name to directory");
    }
    for (const name of Object.keys(dirs)) {
      packagePathParts(name);
      byPackage[name] = normalizeRootDir(dirs[name], `fyn.localExportsDirs[${JSON.stringify(name)}]`);
    }
  }
  assertNoNestedRoots([defaultDir, ...Object.values(byPackage)]);
  return { defaultDir, byPackage };
};

const rootDirForPackage = (config, name) =>
  (config.byPackage && config.byPackage[name]) || config.defaultDir;

// Glob patterns for the configured export roots so the consumer file scan can
// treat them as generated, disposable state (like the default `_fyn`).
const localExportsScanIgnores = pkg => {
  let config;
  try {
    config = resolveLocalExportsConfig(pkg);
  } catch (err) {
    return [];
  }
  const roots = [config.defaultDir, ...Object.values(config.byPackage)];
  return [...new Set(roots)].map(root => `**/${root}`);
};

const groupByRoot = exportsMap => {
  const byRoot = new Map();
  for (const target of Object.keys(exportsMap)) {
    const root = rootOfEntry(exportsMap[target]);
    if (!byRoot.has(root)) {
      byRoot.set(root, {});
    }
    byRoot.get(root)[target] = exportsMap[target];
  }
  return byRoot;
};

const normalizeManifest = manifest => {
  if (!manifest) {
    return emptyManifest();
  }
  if (
    manifest.version !== MANIFEST_VERSION ||
    !manifest.exports ||
    Array.isArray(manifest.exports) ||
    typeof manifest.exports !== "object"
  ) {
    throw new Error("Invalid fyn local exports manifest");
  }
  for (const target of Object.keys(manifest.exports)) {
    const entry = manifest.exports[target];
    if (!entry || typeof entry !== "object" || typeof entry.source !== "string" || !entry.source) {
      throw new Error("Invalid fyn local exports manifest entry");
    }
    const root = normalizeRootDir(rootOfEntry(entry), "fyn local exports manifest root");
    const expectedTarget = posixify(
      Path.join(root, ...packagePathParts(entry.package), entry.export)
    );
    checkExportName(entry.package, entry.export);
    if (target !== expectedTarget || entry.target !== expectedTarget) {
      throw new Error(`Invalid fyn local exports manifest target: ${target}`);
    }
  }
  return manifest;
};

const checkSourcePath = (packageName, sourcePath) => {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new Error(`fyn.localExports source for ${packageName} must be a relative directory`);
  }
  if (
    Path.isAbsolute(sourcePath) ||
    Path.posix.isAbsolute(sourcePath) ||
    Path.win32.isAbsolute(sourcePath)
  ) {
    throw new Error(`fyn.localExports source for ${packageName} must not be absolute`);
  }
  const parts = sourcePath.split(/[\\/]+/);
  if (parts.includes("..") || parts.includes("node_modules") || parts.includes(".git")) {
    throw new Error(`Unsafe fyn.localExports source ${sourcePath} in ${packageName}`);
  }
};

const isInside = (root, child) => {
  const relative = Path.relative(root, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${Path.sep}`);
};

const readOwnedManifest = async (cwd, root) => {
  const marker = Path.join(cwd, root, MANIFEST_FILE);
  try {
    const value = JSON.parse(await Fs.readFile(marker, "utf8"));
    return normalizeManifest(value);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return null;
    }
    throw new Error(`Invalid ${root} ownership manifest: ${err.message}`);
  }
};

const sourcePathFor = (cwd, entry) => Path.resolve(cwd, entry.source);

const linkMatches = async (cwd, entry) => {
  try {
    const target = await Fs.realpath(Path.resolve(cwd, entry.target));
    const source = await Fs.realpath(sourcePathFor(cwd, entry));
    return target === source;
  } catch (err) {
    return false;
  }
};

async function makeLocalExportsManifest({ cwd, depInfos, config: exportsConfig }) {
  const resolved = exportsConfig || { defaultDir: DEFAULT_ROOT_DIR, byPackage: {} };
  const entries = {};
  const consumerRoot = await Fs.realpath(cwd);

  for (const depInfo of depInfos) {
    if (depInfo.local !== "hard" || getUrlType(depInfo) || depInfo.optFailed || depInfo._removed) {
      continue;
    }

    const config = depInfo.json && depInfo.json.fyn && depInfo.json.fyn.localExports;
    if (config === undefined || config === false) {
      continue;
    }
    if (!config || Array.isArray(config) || typeof config !== "object") {
      throw new Error(`fyn.localExports for ${depInfo.name} must be an object or false`);
    }

    const packageParts = packagePathParts(depInfo.name);
    const packageRoot = await Fs.realpath(depInfo.dir);
    for (const exportName of Object.keys(config).sort()) {
      const configuredSource = config[exportName];
      if (configuredSource === false) {
        continue;
      }
      checkExportName(depInfo.name, exportName);
      checkSourcePath(depInfo.name, configuredSource);

      const unresolvedSource = Path.resolve(packageRoot, configuredSource);
      let source;
      let sourceStat;
      try {
        source = await Fs.realpath(unresolvedSource);
        sourceStat = await Fs.stat(source);
      } catch (err) {
        throw new Error(
          `fyn.localExports source ${configuredSource} in ${depInfo.name} does not exist`
        );
      }
      if (!isInside(packageRoot, source)) {
        throw new Error(
          `fyn.localExports source ${configuredSource} in ${depInfo.name} escapes the package`
        );
      }
      if (!sourceStat.isDirectory()) {
        throw new Error(
          `fyn.localExports source ${configuredSource} in ${depInfo.name} is not a directory`
        );
      }

      const root = rootDirForPackage(resolved, depInfo.name);
      const target = posixify(Path.join(root, ...packageParts, exportName));
      const relativeSource = posixify(Path.relative(consumerRoot, source));
      const prior = entries[target];
      if (prior && (prior.source !== relativeSource || prior.version !== depInfo.version)) {
        throw new Error(
          `Local export destination collision for ${depInfo.name}@${depInfo.version}: ${target}`
        );
      }

      const targetPath = Path.resolve(consumerRoot, target);
      entries[target] = {
        package: depInfo.name,
        version: depInfo.version,
        export: exportName,
        source: relativeSource,
        target,
        root,
        linkTarget: fynTil.isWin32
          ? source
          : posixify(Path.relative(Path.dirname(targetPath), source))
      };
    }
  }

  const sortedEntries = {};
  for (const target of Object.keys(entries).sort()) {
    sortedEntries[target] = entries[target];
  }
  return { version: MANIFEST_VERSION, exports: sortedEntries };
}

async function rootNeedsInstall(cwd, root, exportsForRoot) {
  const rootManifest = { version: MANIFEST_VERSION, exports: exportsForRoot };
  let realized;
  try {
    realized = await readOwnedManifest(cwd, root);
  } catch (err) {
    return true;
  }
  if (!realized || JSON.stringify(realized) !== JSON.stringify(rootManifest)) {
    return true;
  }
  for (const target of Object.keys(exportsForRoot)) {
    if (!(await linkMatches(cwd, exportsForRoot[target]))) {
      return true;
    }
  }
  return false;
}

async function localExportsNeedInstall({ cwd, manifest }) {
  const desired = normalizeManifest(manifest);
  const byRoot = groupByRoot(desired.exports);
  if (byRoot.size === 0) {
    try {
      return Boolean(await readOwnedManifest(cwd, DEFAULT_ROOT_DIR));
    } catch (err) {
      return false;
    }
  }

  for (const [root, exportsForRoot] of byRoot) {
    if (await rootNeedsInstall(cwd, root, exportsForRoot)) {
      return true;
    }
  }
  return false;
}

async function reconcileOneRoot(cwd, root, exportsForRoot) {
  const targets = Object.keys(exportsForRoot);
  const rootPath = Path.join(cwd, root);
  let owned;
  try {
    owned = await readOwnedManifest(cwd, root);
  } catch (err) {
    if (targets.length === 0) {
      return;
    }
    throw err;
  }

  if (targets.length === 0) {
    if (owned) {
      await Fs.$.rimraf(rootPath);
    }
    return;
  }
  if ((await Fs.exists(rootPath)) && !owned) {
    throw new Error(`Refusing to modify ${rootPath} without a fyn ownership manifest`);
  }
  if (owned && !(await rootNeedsInstall(cwd, root, exportsForRoot))) {
    return;
  }

  const desiredRootManifest = { version: MANIFEST_VERSION, exports: exportsForRoot };
  const suffix = `${process.pid}-${Date.now()}`;
  const staging = `${rootPath}.fyn-tmp-${suffix}`;
  const backup = `${rootPath}.fyn-old-${suffix}`;
  let movedExisting = false;

  try {
    await Fs.$.rimraf(staging);
    await Fs.$.mkdirp(staging);
    for (const target of targets) {
      const entry = exportsForRoot[target];
      const stagedTarget = Path.join(staging, Path.relative(root, target));
      const source = sourcePathFor(cwd, entry);
      const stat = await Fs.stat(source);
      if (!stat.isDirectory()) {
        throw new Error(`Local export source is not a directory: ${source}`);
      }
      await Fs.$.mkdirp(Path.dirname(stagedTarget));
      await fynTil.symlinkDir(stagedTarget, source, !fynTil.isWin32);
    }
    await Fs.writeFile(
      Path.join(staging, MANIFEST_FILE),
      `${JSON.stringify(desiredRootManifest, null, 2)}\n`
    );

    if (owned) {
      await Fs.$.rimraf(backup);
      await Fs.rename(rootPath, backup);
      movedExisting = true;
    }
    await Fs.$.mkdirp(Path.dirname(rootPath));
    await Fs.rename(staging, rootPath);
    if (movedExisting) {
      movedExisting = false;
      await Fs.$.rimraf(backup);
    }
  } catch (err) {
    await Fs.$.rimraf(staging);
    if (movedExisting) {
      await Fs.$.rimraf(rootPath);
      await Fs.rename(backup, rootPath);
    }
    throw err;
  }
}

async function reconcileLocalExports({ cwd, manifest, previous }) {
  const desired = normalizeManifest(manifest);
  const byRoot = groupByRoot(desired.exports);
  // The default root is always a cleanup candidate so a leftover owned tree is
  // removed even when the recorded previous state is unavailable.
  const allRoots = new Set([DEFAULT_ROOT_DIR, ...byRoot.keys()]);
  if (previous) {
    for (const root of groupByRoot(normalizeManifest(previous).exports).keys()) {
      allRoots.add(root);
    }
  }

  // Remove orphaned roots before creating desired ones so a relocated default
  // root cannot clobber a newly created child root nested under it.
  for (const root of [...allRoots].sort()) {
    if (!byRoot.has(root)) {
      await reconcileOneRoot(cwd, root, {});
    }
  }
  for (const root of [...byRoot.keys()].sort()) {
    await reconcileOneRoot(cwd, root, byRoot.get(root));
  }
}

async function syncLocalExports(options) {
  return reconcileLocalExports(options);
}

module.exports = {
  makeLocalExportsManifest,
  reconcileLocalExports,
  syncLocalExports,
  localExportsNeedInstall,
  resolveLocalExportsConfig,
  localExportsScanIgnores
};
