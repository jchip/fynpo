import Promise from "aveazul";
import Path from "path";
import Fs from "fs";
import minimatch from "minimatch";
import { logger } from "../logger";
import { execSync } from "../child-process";

const xrequire = eval("require"); // eslint-disable-line

export const isAnythingCommitted = (opts) => {
  const anyCommits = execSync("git", ["rev-list", "--count", "--all", "--max-count=1"], opts);

  return Boolean(parseInt(anyCommits, 10));
};

export const getNewCommits = (opts, changed) => {
  const execOpts = {
    cwd: opts.cwd,
  };

  const tag = changed.latestTag;

  let args;
  if (tag) {
    args = ["log", `${tag}...HEAD`, "--pretty=format:'%H %s'"];
  } else {
    args = ["log", "--pretty=format:'%H %s'"];
  }

  const stdout = execSync("git", args, execOpts);
  const commits = stdout
    .split("\n")
    .map((x) => x.replace(/['"]+/g, ""))
    .filter(
      (x) => x.length > 0 && !x.startsWith("Merge pull request #") && !x.includes("[no-changelog]")
    );
  const commitIds = commits.reduce(
    (a, x) => {
      const idx = x.indexOf(" ");
      const id = x.substr(0, idx);
      a.ids.push(id);
      a[id] = x.substr(idx + 1);
      return a;
    },
    { ids: [] }
  );

  return Promise.resolve(commitIds).then((commitObj) => {
    if (opts.changeLog.indexOf(commitObj.ids[0]) >= 0) {
      logger.error("change log already contain a commit from new commits");
      process.exit(1);
    }
    return { commits: commitObj, changed, opts };
  });
};

export const collateCommitsPackages = ({ commits, changed, opts }) => {
  const commitIds = commits.ids;
  const execOpts = {
    cwd: opts.cwd,
  };

  const collated = {
    realPackages: [],
    packages: {},
    samples: {},
    others: {},
    files: {},
    changed,
    opts,
  };

  const ignoreChanges = opts.ignoreChanges || [];
  if (ignoreChanges.length) {
    logger.info("Ignoring commits in files matching patterns:", ignoreChanges);
  }

  /**
   * Find the package that owns a changed file, by longest matching dir prefix.
   *
   * Resolved against the dep graph so it works for any monorepo layout. This used
   * to only recognize a top level `packages/` (or `samples/`) dir, which meant a
   * repo laid out any other way collated no packages at all - nothing was version
   * bumped, the changelog's `## Packages` section came out empty, and publish
   * (which parses that commit body) had nothing to publish.
   */
  const byPath = opts.graph && opts.graph.packages && opts.graph.packages.byPath;
  const findPkgForFile = (file: string) => {
    const parts = file.split("/");

    if (byPath) {
      for (let i = parts.length - 1; i > 0; i--) {
        const pkg = byPath[parts.slice(0, i).join("/")];
        if (pkg) {
          return { name: pkg.name, dirName: pkg.pkgDir || pkg.path };
        }
      }
      return undefined;
    }

    // no graph to resolve against - fall back to the original packages/ assumption
    if (parts[0] === "packages" || parts[0] === "samples") {
      const dir = Path.resolve(opts.cwd || process.cwd(), "packages", parts[1]);
      if (Fs.existsSync(dir)) {
        /* eslint-disable @typescript-eslint/no-var-requires */
        const Pkg = xrequire(Path.join(dir, "package.json"));
        return { name: Pkg.name, dirName: parts[1] };
      }
    }

    return undefined;
  };
  const filterFunctions = ignoreChanges.map((p) =>
    minimatch.filter(`!${p}`, {
      matchBase: true,
      dot: true,
    })
  );

  return Promise.map(
    commitIds,
    (id) => {
      const args = ["diff-tree", "--no-commit-id", "--name-only", "--root", "-r", `${id}`];
      const stdout = execSync("git", args, execOpts);
      let files = stdout.split("\n").filter((x) => x.trim().length > 0);

      if (filterFunctions.length) {
        for (const filerFn of filterFunctions) {
          files = files.filter(filerFn);
        }
      }

      const handled = { packages: {}, others: {}, files: {} };

      files.reduce((a, x) => {
        const parts = x.split("/");
        const add = (group, key) => {
          if (handled[group][key]) return;
          a[group][key] ??= {};
          if (!a[group][key].msgs) {
            a[group][key].msgs = [];
          }
          a[group][key].msgs.push({ m: commits[id], id });
          handled[group][key] = true;
        };

        const ownerPkg = findPkgForFile(x);
        if (ownerPkg) {
          if (collated.realPackages.indexOf(ownerPkg.name) < 0) {
            collated.realPackages.push(ownerPkg.name);
            a.packages[ownerPkg.name] = { dirName: ownerPkg.dirName };
          }
          add("packages", ownerPkg.name);
        } else if (parts.length > 1) {
          add("others", parts[0]);
        } else {
          add("files", parts[0]);
        }

        return a;
      }, collated);
      return "";
    },
    { concurrency: 1 }
  ).then(() => collated);
};
