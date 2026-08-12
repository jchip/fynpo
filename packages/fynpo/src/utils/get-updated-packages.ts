/* eslint-disable complexity, consistent-return, max-depth */

import { logger } from "../logger";
import { execSync } from "../child-process";
import minimatch from "minimatch";
import Path from "path";
import slash from "slash";
import _ from "lodash";
import { FynpoDepGraph } from "@fynpo/base";

import { makePublishTagSearchTerm, makePublishFilter } from "../utils";

const ifTagExists = (opts) => {
  let result = false;

  const tagTmpl = _.get(opts, "command.publish.gitTagTemplate");
  const searchTerm = makePublishTagSearchTerm(tagTmpl);

  try {
    result = !!execSync("git", ["tag", "--list", searchTerm], { cwd: opts.cwd });
  } catch (err) {
    logger.warn("Can't find latest release tag from this branch!");
  }

  return result;
};

const getLatestTag = (opts) => {
  const tagTmpl = _.get(opts, "command.publish.gitTagTemplate");
  const searchTerm = makePublishTagSearchTerm(tagTmpl);

  const args = ["describe", "--long", "--first-parent", "--match", searchTerm];
  const stdout = execSync("git", args, { cwd: opts.cwd });
  const [, tagName, commitCount, sha] = /^(.*)-(\d+)-g([0-9a-f]+)$/.exec(stdout) || [];
  return { tagName, commitCount, sha };
};

const addDependents = (name, changed, graph: FynpoDepGraph, canPublish) => {
  const pkg = graph.getPackageByName(name);
  const depPaths = Object.keys(graph.depMapByPath[pkg.path].dependentsByPath);
  const dependents = depPaths.map((path) => graph.packages.byPath[path].name);

  dependents.forEach((dep) => {
    // a dependent that can't be published must not be pulled back into the
    // changed set just because something it depends on changed
    if (!canPublish(dep)) {
      return;
    }
    if (!changed.pkgs.includes(dep)) {
      changed.pkgs.push(dep);
    }
    changed.depMap[dep] ??= [];
    changed.depMap[dep].push(name);
  });
};

const addVersionLocks = (name, changed, opts, canPublish) => {
  const verLocks = opts.versionLockMap[name];
  changed.verLocks[name] = [];

  if (verLocks) {
    for (const lockPkgName of _.without(verLocks, name)) {
      if (!canPublish(lockPkgName)) {
        continue;
      }
      if (!changed.pkgs.includes(lockPkgName)) {
        changed.pkgs.push(lockPkgName);
      }
      changed.verLocks[name].push(lockPkgName);
    }
  }
};

export const getUpdatedPackages = (graph: FynpoDepGraph, opts) => {
  let latestTag;
  const changed = {
    pkgs: [],
    depMap: {},
    verLocks: {},
    forceUpdated: [],
    latestTag: undefined,
  };
  const packages = graph.packages.byName || {};
  const forced = opts.forcePublish || [];
  const execOpts = {
    cwd: opts.cwd,
  };

  // `command.publish.includePackages` / `excludePackages`. Filtering here keeps every
  // downstream consumer consistent - the changed list that's printed, the changelog,
  // the version bumps, and the `[Publish]` commit body that publish later parses.
  // `packages` is keyed by name and each value is an array, since the same name can
  // exist at more than one path; a name is publishable if any of its paths is.
  const publishFilter = makePublishFilter(opts.fynpoRc || opts);
  const canPublish = (name: string): boolean => {
    const infos = [].concat(packages[name] || []);
    return infos.some((info) => publishFilter(info));
  };
  const publishableNames = Object.keys(packages).filter(canPublish);

  const skipped = Object.keys(packages).length - publishableNames.length;
  if (skipped > 0) {
    logger.info(`Excluded ${skipped} package(s) from publishing by command.publish config`);
  }

  if (ifTagExists(opts)) {
    const { tagName, commitCount } = getLatestTag(opts);
    changed.latestTag = tagName;

    if (commitCount === "0" && forced.length === 0) {
      logger.info("No commits since previous release. Skipping change detection");
      return changed;
    }

    latestTag = tagName;
  }

  if (!latestTag || forced.includes("*") || opts.lockAll) {
    if (forced.includes("*")) {
      logger.info("Force updating all the packages.");
    }
    if (opts.lockAll) {
      logger.info("All packages are version locked.");
    }
    logger.info("Assuming all packages changed.");
    const pkgNames = publishableNames;
    pkgNames.forEach((name) => {
      changed.pkgs.push(name);
      changed.verLocks[name] = pkgNames;
    });
  } else {
    logger.info(`Detecting changed packages since the release tag: ${latestTag}`);

    const ignoreChanges = opts.ignoreChanges || [];
    if (ignoreChanges.length) {
      logger.info("Ignoring changes in files matching patterns:", ignoreChanges);
    }
    const filterFunctions = ignoreChanges.map((p) =>
      minimatch.filter(`!${p}`, {
        matchBase: true,
        dot: true,
      })
    );

    const isForced = (name) => {
      if (forced.includes("*") || forced.includes(name)) {
        logger.info(`force updating package: ${name}`);
        changed.forceUpdated.push(name);
        return true;
      }
      return false;
    };

    const isChanged = (name) => {
      const pkg = packages[name][0];

      const args = ["diff", "--name-only", `${latestTag}...HEAD`];
      const pathArg = slash(Path.relative(execOpts.cwd || process.cwd(), pkg.path));
      if (pathArg) {
        args.push("--", pathArg);
      }

      const diff = execSync("git", args, execOpts);
      if (diff === "") {
        return false;
      }

      let changedFiles = diff.split("\n");
      if (filterFunctions.length) {
        for (const filerFn of filterFunctions) {
          changedFiles = changedFiles.filter(filerFn);
        }
      }

      return changedFiles.length > 0;
    };

    publishableNames.forEach((name) => {
      if (isForced(name) || isChanged(name)) {
        changed.pkgs.push(name);
      }
    });

    changed.pkgs.forEach((name) => {
      addVersionLocks(name, changed, opts, canPublish);
    });
  }

  changed.pkgs.forEach((name) => {
    addDependents(name, changed, graph, canPublish);
  });

  return changed;
};
