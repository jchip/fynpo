/* eslint-disable complexity, consistent-return, max-depth */

import logger from "../logger";
import { execSync } from "../child-process";
import minimatch from "minimatch";
import _ from "lodash";

export type CommitData = {
  /** hash ID of the commit */
  hash?: string;
  /** tags of the commit */
  tags?: string[];
  /** Commit message subject */
  subject?: string;
  /** Files changed by this commit */
  files?: string[];
};

const parseTags = (strTag: string): string[] => {
  const matchTags = strTag && strTag.trim().match(/\((tag:[^\)]+)\)/);
  const tags = matchTags ? matchTags[1].split(", ").map((x) => x.split("tag: ")[1]) : [];

  return tags;
};

const searchPublishCommit = (execOptions): CommitData => {
  try {
    const output = execSync(
      "git",
      ["--no-pager", "log", `--pretty=format:%H\\:\\%d\\:\\%s`, `--grep=\\[Publish\\]`, "-1"],
      execOptions
    );
    logger.info("found publish commit", output);
    const [hash, tag, subject] = output.trim().split(`\\:\\`);
    return { hash, tags: parseTags(tag), subject };
  } catch (err) {
    logger.warn("Can't search for publish commits", err);
    return {};
  }
};

const getCommitsSinceHash = (hash, execOptions): CommitData[] => {
  try {
    const output = execSync(
      "git",
      ["--no-pager", "log", `--pretty=format:%H\\:\\%d\\:\\%s`, `...${hash}`],
      execOptions
    );
    logger.info("found commits", output);
    return output.split("\n").map((x): CommitData => {
      const [hash, tags, subject] = x.trim().split(`\\:\\`);
      return { hash, tags: parseTags(tags), subject };
    });
  } catch (err) {
    logger.warn("Can't search for publish commits", err);
    return [];
  }
};

const getCommitChangeFiles = (hash, execOptions) => {
  try {
    const output = execSync(
      "git",
      ["--no-pager", "diff-tree", `--no-commit-id`, `--name-only`, `-r`, hash],
      execOptions
    );
    const files = output.split("\n").filter((x) => x.trim().length > 0);
    return files;
  } catch (err) {
    return [];
  }
};

const addDependents = (name, changed, packages) => {
  const dependents = _.get(packages, [name, "dependents"], {});
  dependents.forEach((dep) => {
    if (!changed.pkgs.includes(dep)) {
      changed.pkgs.push(dep);
    }
    changed.depMap[dep] ??= [];
    changed.depMap[dep].push(name);
  });
};

const addVersionLocks = (name, changed, opts) => {
  const verLocks = opts.versionLockMap[name];
  changed.verLocks[name] = [];

  if (verLocks) {
    logger.info("version locks:", name, verLocks);
    for (const lockPkgName of _.without(verLocks, name)) {
      if (!changed.pkgs.includes(lockPkgName)) {
        changed.pkgs.push(lockPkgName);
      }
      changed.verLocks[name].push(lockPkgName);
    }
  }
};

export const getUpdatedPackages = (data, opts) => {
  let latestTag;
  const changed = {
    pkgs: [],
    depMap: {},
    verLocks: {},
    forceUpdated: [],
    latestTag: undefined,
  };
  const packages = data.packages || {};
  const forced = opts.forcePublish || [];
  const execOpts = {
    cwd: opts.cwd,
  };

  const publishCommit = searchPublishCommit(execOpts);
  let effectiveCommits;

  if (publishCommit.hash && !_.isEmpty(publishCommit.tags)) {
    logger.info("Found last publish commit", publishCommit);
    latestTag = changed.latestTag = publishCommit.tags[0];
    const commits = getCommitsSinceHash(publishCommit.hash, execOpts);
    effectiveCommits = commits.filter(
      (x) => !x.subject.startsWith("Merge pull request #") && !x.subject.includes("[no-changelog]")
    );
    logger.info("commits", commits);
    logger.info("effective commits", effectiveCommits);
    if (effectiveCommits.length === 0 && forced.length === 0) {
      logger.info("No commits since previous release. Skipping change detection");
      return changed;
    }
  }

  effectiveCommits.forEach((x) => (x.files = getCommitChangeFiles(x.hash, execOpts)));

  console.log("effectiveCommits files", effectiveCommits);

  if (!latestTag || forced.includes("*") || opts.lockAll) {
    if (forced.includes("*")) {
      logger.info("Force updating all the packages.");
    }
    if (opts.lockAll) {
      logger.info("All packages are version locked.");
    }
    logger.info("Assuming all packages changed.");
    Object.keys(packages).forEach((name) => {
      changed.pkgs.push(name);
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

    // const isChanged = (name) => {
    //   const pkg = packages[name];

    //   const args = ["diff", "--name-only", `${latestTag}...HEAD`];
    //   const pathArg = slash(path.relative(execOpts.cwd || process.cwd(), pkg.path));
    //   if (pathArg) {
    //     args.push("--", pathArg);
    //   }

    //   const diff = execSync("git", args, execOpts);
    //   if (diff === "") {
    //     return false;
    //   }

    //   let changedFiles = diff.split("\n");
    //   if (filterFunctions.length) {
    //     for (const filerFn of filterFunctions) {
    //       changedFiles = changedFiles.filter(filerFn);
    //     }
    //   }

    //   return changedFiles.length > 0;
    // };

    // Object.keys(packages).forEach((name) => {
    //   if (isForced(name) || isChanged(name)) {
    //     changed.pkgs.push(name);
    //   }
    // });

    // changed.pkgs.forEach((name) => {
    //   addVersionLocks(name, changed, opts);
    // });

    // changed.pkgs.forEach((name) => {
    //   addDependents(name, changed, packages);
    // });
  }

  return changed;
};

// export = getUpdatedPackages;
