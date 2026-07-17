// @ts-nocheck
"use strict";

const Path = require("path");
const Fs = require("./util/file-ops");
const fynTil = require("./util/fyntil");
const { getUrlType } = require("./util/lifecycle-script-policy");

/* eslint-disable complexity, max-statements, no-magic-numbers, jsdoc/require-jsdoc */

const ROOT_DIR = "_fyn";
const MANIFEST_FILE = ".fyn-local-exports.json";
const MANIFEST_VERSION = 1;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const posixify = value => value.split(Path.sep).join("/");

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
    const expectedTarget = posixify(
      Path.join(ROOT_DIR, ...packagePathParts(entry.package), entry.export)
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

const readOwnedManifest = async cwd => {
  const marker = Path.join(cwd, ROOT_DIR, MANIFEST_FILE);
  try {
    const value = JSON.parse(await Fs.readFile(marker, "utf8"));
    return normalizeManifest(value);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return null;
    }
    throw new Error(`Invalid ${ROOT_DIR} ownership manifest: ${err.message}`);
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

async function makeLocalExportsManifest({ cwd, depInfos }) {
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

      const target = posixify(Path.join(ROOT_DIR, ...packageParts, exportName));
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

async function localExportsNeedInstall({ cwd, manifest }) {
  const desired = normalizeManifest(manifest);
  const targets = Object.keys(desired.exports);
  if (targets.length === 0) {
    try {
      return Boolean(await readOwnedManifest(cwd));
    } catch (err) {
      return false;
    }
  }

  let realized;
  try {
    realized = await readOwnedManifest(cwd);
  } catch (err) {
    return true;
  }
  if (!realized || JSON.stringify(realized) !== JSON.stringify(desired)) {
    return true;
  }

  for (const target of targets) {
    if (!(await linkMatches(cwd, desired.exports[target]))) {
      return true;
    }
  }
  return false;
}

async function reconcileLocalExports({ cwd, manifest }) {
  const desired = normalizeManifest(manifest);
  const targets = Object.keys(desired.exports);
  const root = Path.join(cwd, ROOT_DIR);
  let owned;
  try {
    owned = await readOwnedManifest(cwd);
  } catch (err) {
    if (targets.length === 0) {
      return;
    }
    throw err;
  }

  if (targets.length === 0) {
    if (owned) {
      await Fs.$.rimraf(root);
    }
    return;
  }
  if ((await Fs.exists(root)) && !owned) {
    throw new Error(`Refusing to modify ${root} without a fyn ownership manifest`);
  }
  if (owned && !(await localExportsNeedInstall({ cwd, manifest: desired }))) {
    return;
  }

  const suffix = `${process.pid}-${Date.now()}`;
  const staging = `${root}.fyn-tmp-${suffix}`;
  const backup = `${root}.fyn-old-${suffix}`;
  let movedExisting = false;

  try {
    await Fs.$.rimraf(staging);
    await Fs.$.mkdirp(staging);
    for (const target of targets) {
      const entry = desired.exports[target];
      const stagedTarget = Path.join(staging, Path.relative(ROOT_DIR, target));
      const source = sourcePathFor(cwd, entry);
      const stat = await Fs.stat(source);
      if (!stat.isDirectory()) {
        throw new Error(`Local export source is not a directory: ${source}`);
      }
      await Fs.$.mkdirp(Path.dirname(stagedTarget));
      await fynTil.symlinkDir(stagedTarget, source, !fynTil.isWin32);
    }
    await Fs.writeFile(Path.join(staging, MANIFEST_FILE), `${JSON.stringify(desired, null, 2)}\n`);

    if (owned) {
      await Fs.$.rimraf(backup);
      await Fs.rename(root, backup);
      movedExisting = true;
    }
    await Fs.rename(staging, root);
    if (movedExisting) {
      movedExisting = false;
      await Fs.$.rimraf(backup);
    }
  } catch (err) {
    await Fs.$.rimraf(staging);
    if (movedExisting) {
      await Fs.$.rimraf(root);
      await Fs.rename(backup, root);
    }
    throw err;
  }
}

async function syncLocalExports(options) {
  return reconcileLocalExports(options);
}

module.exports = {
  makeLocalExportsManifest,
  reconcileLocalExports,
  syncLocalExports,
  localExportsNeedInstall
};
