#!/usr/bin/env node

import Path from "path";
import { NixClap } from "nix-clap";
import { Bootstrap } from "./bootstrap";
import { Prepare } from "./prepare";
import Changelog from "./update-changelog";
import Publish from "./publish";
import { Run } from "./run";
import { Init } from "./init";
import { Updated } from "./updated";
import { Commitlint } from "./commitlint";
import { Version } from "./version";
import { makePkgDeps, readFynpoPackages, FynpoDepGraph } from "@fynpo/base";
import { logger } from "./logger";
import * as utils from "./utils";
import Fs from "fs";
import _ from "lodash";

const xrequire = eval("require"); // eslint-disable-line

const globalCmnds = ["bootstrap", "local", "run"];

const readPackages = async (opts: any, cmdName: string = "") => {
  const result = await makePkgDeps(
    await readFynpoPackages(_.pick(opts, ["patterns", "cwd"])),
    opts
  );
  if (!_.isEmpty(result.warnings)) {
    result.warnings.forEach((w) => logger.warn(w));
  }

  if (result.focusPkgPath) {
    if (globalCmnds.includes(cmdName)) {
      logger.error(
        `${cmdName} command is only supported at mono-repo root level but CWD is '${result.focusPkgPath}`
      );
      process.exit(1);
    }
  }

  return result;
};

const readFynpoData = async (cwd) => {
  try {
    const data = Fs.readFileSync(Path.join(cwd, ".fynpo-data.json"), "utf-8");
    return JSON.parse(data);
  } catch (_err) {
    return { indirects: {} };
  }
};

const makeOpts = async (cmd, _parsed) => {
  // In nix-clap v2, merge root command opts with subcommand opts
  const rootOpts = cmd.rootCmd?.jsonMeta?.opts || {};
  const cmdOpts = cmd.jsonMeta?.opts || {};
  const allOpts = { ...rootOpts, ...cmdOpts };

  let cwd = process.cwd();
  if (allOpts.cwd) {
    logger.info(`Setting CWD to ${allOpts.cwd}`);
    cwd = allOpts.cwd;
    process.chdir(cwd);
  }
  const fynpo: any = utils.loadConfig(cwd);
  const optConfig = Object.assign({}, fynpo.fynpoRc, allOpts, {
    cwd: fynpo.dir,
    patterns: fynpo.fynpoRc.packages,
  });

  return optConfig;
};

const makeDepGraph = async (opts) => {
  const graph = new FynpoDepGraph(opts);
  await graph.resolve();
  const fynpoData = await readFynpoData(opts.cwd);
  if (!_.isEmpty(fynpoData.indirects)) {
    _.each(fynpoData.indirects, (relations) => {
      graph.addDepRelations(relations);
    });
    graph.updateDepMap();
  }

  return graph;
};

const makeBootstrap = async (cmd, parsed) => {
  const opts = await makeOpts(cmd, parsed);
  const graph = await makeDepGraph(opts);
  return new Bootstrap(graph, opts);
};

const execBootstrap = async (cmd, parsed, firstRunTime = 0) => {
  const bootstrap = await makeBootstrap(cmd, parsed);
  const fynpoDataStart = await readFynpoData(bootstrap.cwd);
  let statusCode = 0;

  // In nix-clap v2, use cmd.jsonMeta for merged options and args
  const meta = cmd.jsonMeta;

  if (!firstRunTime) {
    logger.debug("CLI options", JSON.stringify({ opts: meta.opts, args: meta.argList }));
  }

  let secondRun = false;
  try {
    await bootstrap.exec({
      build: meta.opts.build,
      fynOpts: meta.opts.fynOpts,
      concurrency: meta.opts.concurrency,
      skip: meta.opts.skip,
    });

    if (!firstRunTime) {
      const fynpoDataEnd = await readFynpoData(bootstrap.cwd);
      if (fynpoDataEnd.__timestamp !== fynpoDataStart.__timestamp) {
        logger.info(
          "=== fynpo data changed - running bootstrap again - fynpo recommands that you commit the .fynpo-data.json file ==="
        );
        secondRun = true;
        return await execBootstrap(cmd, parsed, bootstrap.elapsedTime);
      }
    }

    bootstrap.logErrors();
    statusCode = bootstrap.failed;
  } catch (err) {
    if (!secondRun) {
      bootstrap.logErrors();
      statusCode = 1;
    }
  } finally {
    if (!secondRun) {
      const sec = ((bootstrap.elapsedTime + firstRunTime) / 1000).toFixed(2);
      logger.info(`bootstrap completed in ${sec}secs`);
      if (statusCode !== 0 || meta.opts.saveLog) {
        Fs.writeFileSync("fynpo-debug.log", logger.logData.join("\n") + "\n");
        logger.error("Please check the file fynpo-debug.log for more info.");
      }
      process.exit(statusCode);
    }
  }

  return undefined;
};

const execLocal = async (cmd, parsed) => {
  return await makeBootstrap(cmd, parsed);
};

const execPrepare = async (cmd, _parsed) => {
  // In nix-clap v2, use cmd.jsonMeta.opts for merged options
  const opts = Object.assign({ cwd: process.cwd() }, cmd.jsonMeta?.opts || {});

  // prepare only applies at top level, so switch CWD there
  process.chdir(opts.cwd);

  return new Prepare(opts, await readPackages(opts)).exec();
};

const execChangelog = async (cmd, _parsed) => {
  logger.info("updating changelog");
  const opts = await makeOpts(cmd, _parsed);
  const graph = await makeDepGraph(opts);

  // changelog only applies at top level, so switch CWD there
  process.chdir(opts.cwd);

  return new Changelog(opts, graph).exec();
};

const execUpdated = async (cmd, _parsed) => {
  const opts = await makeOpts(cmd, _parsed);
  const graph = await makeDepGraph(opts);

  return new Updated(opts, graph).exec();
};

const execPublish = async (cmd, _parsed) => {
  const opts = await makeOpts(cmd, _parsed);
  const graph = await makeDepGraph(opts);

  return new Publish(opts, graph).exec();
};

const execVersion = async (cmd, _parsed) => {
  const opts = await makeOpts(cmd, _parsed);
  const graph = await makeDepGraph(opts);

  return new Version(opts, graph).exec();
};

const execRunScript = async (cmd, _parsed) => {
  const opts = await makeOpts(cmd, _parsed);
  const graph = await makeDepGraph(opts);
  let exitCode = 0;
  try {
    // In nix-clap v2, use cmd.jsonMeta.args for named arguments
    const scriptArgs = cmd.jsonMeta?.args || {};
    return await new Run(opts, scriptArgs, graph).exec();
  } catch (err) {
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }

  return undefined;
};

const execInit = (cmd, _parsed) => {
  // In nix-clap v2, use cmd.jsonMeta.opts for merged options
  const opts = Object.assign({ cwd: process.cwd() }, cmd.jsonMeta?.opts || {});

  return new Init(opts).exec();
};

const execLinting = (cmd, _parsed) => {
  // In nix-clap v2, use cmd.jsonMeta.opts for merged options
  const opts = Object.assign({ cwd: process.cwd() }, cmd.jsonMeta?.opts || {});

  return new Commitlint(opts).exec();
};

const myPkg = xrequire(Path.join(__dirname, "../package.json"));

export const fynpoMain = () => {
  const nixClap = new NixClap({
    name: myPkg.name,
    usage: "$0 [command] [options]",
    defaultCommand: "bootstrap" // Run bootstrap when no command is given
  });
  nixClap.version(myPkg.version);

  const options = {
    cwd: {
      args: "<path string>",
      desc: "set fynpo's working directory",
    },
    ignore: {
      alias: "i",
      args: "<vals string..>",
      desc: "list of packages to ignore",
      allowCmd: ["bootstrap", "local", "run"],
    },
    only: {
      alias: "o",
      args: "<vals string..>",
      desc: "list of packages to handle only",
      allowCmd: ["bootstrap", "local", "run"],
    },
    scope: {
      alias: "s",
      args: "<vals string..>",
      desc: "include only packages with names matching the given scopes",
      allowCmd: ["bootstrap", "local", "run"],
    },
    deps: {
      alias: "d",
      args: "[val number]",
      argDefault: "10",
      desc: "level of deps to include even if they were ignored",
      allowCmd: ["bootstrap", "local", "run"],
    },
    commit: {
      args: "[flag boolean]",
      argDefault: "true",
      desc: "commit the changes to changelog and package.json (use --no-commit to disable)",
      allowCmd: ["changelog", "version", "prepare"],
    },
    "force-publish": {
      alias: "fp",
      args: "<vals string..>",
      desc: "force publish packages",
      allowCmd: ["updated", "changelog", "version"],
    },
    "ignore-changes": {
      alias: "ic",
      args: "<vals string..>",
      desc: "ignore patterns",
      allowCmd: ["updated", "changelog", "version"],
    },
    "save-log": {
      alias: "sl",
      desc: "save logs to fynpo-debug.log",
    },
  };

  const subCommands = {
    bootstrap: {
      alias: "b",
      desc: "bootstrap packages",
      exec: execBootstrap,
      options: {
        build: {
          args: "[flag boolean]",
          argDefault: "true",
          desc: "run npm script build if no prepare (use --no-build to disable)",
        },
        concurrency: {
          alias: "cc",
          args: "[val number]",
          argDefault: "6",
          desc: "number of packages to bootstrap concurrently",
        },
        skip: {
          args: "<vals string..>",
          desc: "list of packages to skip running fyn install on, but won't ignore",
        },
      },
    },
    local: {
      alias: "l",
      desc: "update packages dependencies to point to local",
      exec: execLocal,
    },
    prepare: {
      alias: "p",
      desc: "Prepare packages versions for publish",
      exec: execPrepare,
      options: {
        tag: {
          desc: "create tags for individual packages",
        },
      },
    },
    updated: {
      alias: "u",
      desc: "list changed packages",
      exec: execUpdated,
    },
    changelog: {
      alias: "c",
      desc: "Update changelog",
      exec: execChangelog,
      options: {
        publish: {
          desc: "enable to trigger publish with changelog commit",
        },
        tag: {
          desc: "create tags for individual packages",
        },
      },
    },
    run: {
      alias: "r",
      desc: "Run passed npm script in each package",
      args: "<script string>",
      exec: execRunScript,
      options: {
        stream: {
          desc: "stream output from child processes, prefixed with the originating package name",
        },
        parallel: {
          desc: "run script immediately in up to concurrency number of matching packages",
        },
        prefix: {
          args: "[flag boolean]",
          argDefault: "true",
          desc: "add package name prefixing for stream output (use --no-prefix to disable)",
        },
        bail: {
          args: "[flag boolean]",
          argDefault: "true",
          desc: "immediately stop if any package's script fail (use --no-bail to disable)",
        },
        concurrency: {
          alias: "cc",
          args: "[val number]",
          argDefault: "6",
          desc: "number of packages to run script concurrently when parallel is not set",
        },
        sort: {
          args: "[flag boolean]",
          argDefault: "true",
          desc: "run the script through packages in topological sort order (use --no-sort to disable)",
        },
        cache: {
          desc: "cache the run results",
        },
      },
    },
    version: {
      alias: "v",
      desc: "Update changelog and bump version",
      exec: execVersion,
      options: {
        tag: {
          desc: "create tags for individual packages",
        },
      },
    },
    publish: {
      alias: "pb",
      desc: "Publish Packages",
      exec: execPublish,
      options: {
        "dist-tag": {
          args: "<tag string>",
          desc: "set publish tag for all packages",
        },
        "dry-run": {
          desc: "publish dry run",
        },
        push: {
          args: "[flag boolean]",
          argDefault: "true",
          desc: "push release tag to remote (use --no-push to skip)",
        },
      },
    },
    init: {
      alias: "i",
      desc: "Initialize a new fynpo repo",
      exec: execInit,
      options: {
        commitlint: {
          desc: "To add commitlint configuration",
        },
      },
    },
    commitlint: {
      alias: "cl",
      desc: "Commit lint",
      exec: execLinting,
      options: {
        config: {
          args: "<path string>",
          desc: "path to the config file",
        },
        color: {
          alias: "c",
          args: "[flag boolean]",
          argDefault: "true",
          desc: "toggle colored output (use --no-color to disable)",
        },
        edit: {
          alias: "e",
          args: "<file string>",
          desc: "read last commit message from the specified file or fallbacks to ./.git/COMMIT_EDITMSG",
        },
        verbose: {
          alias: "V",
          desc: "enable verbose output for reports without problems",
        },
      },
    },
  };

  nixClap.init2({
    options,
    subCommands
  });

  return nixClap.parseAsync();
};
