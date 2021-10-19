#!/usr/bin/env node

import Path from "path";
import NixClap from "nix-clap";
import Bootstrap from "./bootstrap";
import Prepare from "./prepare";
import Changelog from "./update-changelog";
import Publish from "./publish";
import Run from "./run";
import Init from "./init";
import Updated from "./updated";
import Commitlint from "./commitlint";
import Version from "./version";
import { makePkgDeps, readFynpoPackages, FynpoDepGraph } from "@fynpo/base";
import logger from "./logger";
import * as utils from "./utils";
import Fs, { read } from "fs";
import _ from "lodash";

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

const makeOpts = async (parsed) => {
  const cwd = parsed.opts.cwd || process.cwd();
  const fynpo: any = utils.loadConfig();
  const optConfig = Object.assign({}, fynpo.fynpoRc, parsed.opts);
  const opts = { cwd, patterns: ["packages/*"], ...optConfig };

  return opts;
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

const makeBootstrap = async (parsed) => {
  const opts = await makeOpts(parsed);
  const graph = await makeDepGraph(opts);
  return new Bootstrap(graph, opts);
};

const execBootstrap = async (parsed, cli, second = false) => {
  const bootstrap = await makeBootstrap(parsed);
  const fynpoDataStart = await readFynpoData(bootstrap.cwd);
  let statusCode = 0;

  if (!second) {
    logger.debug("CLI options", JSON.stringify(parsed));
  }

  let secondRun = false;
  try {
    await bootstrap.exec({
      build: parsed.opts.build,
      fynOpts: parsed.opts.fynOpts,
      concurrency: parsed.opts.concurrency,
      skip: parsed.opts.skip,
    });

    if (!second) {
      const fynpoDataEnd = await readFynpoData(bootstrap.cwd);
      if (fynpoDataEnd.__timestamp !== fynpoDataStart.__timestamp) {
        logger.info(
          "=== fynpo data changed - running bootstrap again - fynpo recommands that you commit the .fynpo-data.json file ==="
        );
        secondRun = true;
        return await execBootstrap(parsed, cli, true);
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
      if (statusCode !== 0 || parsed.opts.saveLog) {
        Fs.writeFileSync("fynpo-debug.log", logger.logData.join("\n") + "\n");
        logger.error("Please check the file fynpo-debug.log for more info.");
      }
      process.exit(statusCode);
    }
  }

  return undefined;
};

const execLocal = async (parsed) => {
  return await makeBootstrap(parsed);
};

const execPrepare = async (parsed) => {
  const opts = Object.assign({ cwd: process.cwd() }, parsed.opts);

  return new Prepare(opts, await readPackages(opts)).exec();
};

const execChangelog = async (parsed) => {
  logger.info("updating changelog");
  const opts = await makeOpts(parsed);
  logger.info("fynpo opts", JSON.stringify(opts, null, 2));
  const graph = await makeDepGraph(opts);

  return new Changelog(opts, graph).exec();
};

const execUpdated = async (parsed) => {
  const opts = await makeOpts(parsed);
  const graph = await makeDepGraph(opts);

  return new Updated(opts, graph).exec();
};

const execPublish = async (parsed) => {
  const opts = Object.assign({ cwd: process.cwd() }, parsed.opts);

  return new Publish(opts, await readPackages(opts)).exec();
};

const execVersion = async (parsed) => {
  const opts = await makeOpts(parsed);
  const graph = await makeDepGraph(opts);

  return new Version(opts, graph).exec();
};

const execRunScript = async (parsed) => {
  const opts = await makeOpts(parsed);
  const graph = await makeDepGraph(opts);
  return new Run(opts, parsed.args, graph).exec();
};

const execInit = (parsed) => {
  const opts = Object.assign({ cwd: process.cwd() }, parsed.opts);

  return new Init(opts).exec();
};

const execLinting = (parsed) => {
  const opts = Object.assign({ cwd: process.cwd() }, parsed.opts);

  return new Commitlint(opts).exec();
};

const nixClap = new NixClap({
  usage: "$0 [command] [options]",
  handlers: {
    parsed: (data) => {
      try {
        const cwd = data.parsed.opts.cwd || process.cwd();
        /* eslint-disable @typescript-eslint/no-var-requires */
        data.nixClap.applyConfig(require(Path.join(cwd, "lerna.json")).fynpo, data.parsed);
      } catch (e) {
        // Error
      }
    },
  },
}).init(
  {
    cwd: {
      type: "string",
      desc: "set fynpo's working directory",
    },
    ignore: {
      alias: "i",
      type: "string array",
      desc: "list of packages to ignore",
      allowCmd: ["bootstrap", "local", "run"],
    },
    only: {
      alias: "o",
      type: "string array",
      desc: "list of packages to handle only",
      allowCmd: ["bootstrap", "local", "run"],
    },
    scope: {
      alias: "s",
      type: "string array",
      desc: "include only packages with names matching the given scopes",
      allowCmd: ["bootstrap", "local", "run"],
    },
    deps: {
      alias: "d",
      type: "number",
      default: 10,
      desc: "level of deps to include even if they were ignored",
      allowCmd: ["bootstrap", "local", "run"],
    },
    commit: {
      type: "boolean",
      default: true,
      desc: "no-commit to disable committing the changes to changelog and package.json",
      allowCmd: ["changelog", "version", "prepare"],
    },
    "force-publish": {
      alias: "fp",
      type: "string array",
      desc: "force publish packages",
      allowCmd: ["updated", "changelog", "version"],
    },
    "ignore-changes": {
      alias: "ic",
      type: "string array",
      desc: "ignore patterns",
      allowCmd: ["updated", "changelog", "version"],
    },
    "save-log": {
      alias: "sl",
      type: "boolean",
      default: false,
      desc: "save logs to fynpo-debug.log",
    },
  },
  {
    bootstrap: {
      alias: "b",
      desc: "bootstrap packages",
      default: true,
      exec: execBootstrap,
      options: {
        build: {
          type: "boolean",
          default: true,
          desc: "run npm script build if no prepare",
        },
        concurrency: {
          alias: "cc",
          type: "number",
          default: 3,
          desc: "number of packages to bootstrap concurrently",
        },
        skip: {
          type: "string array",
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
          type: "boolean",
          default: false,
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
          type: "boolean",
          default: false,
          desc: "enable to trigger publish with changelog commit",
        },
        tag: {
          type: "boolean",
          default: false,
          desc: "create tags for individual packages",
        },
      },
    },
    run: {
      alias: "r",
      desc: "Run passed npm script in each package",
      args: "<script>",
      exec: execRunScript,
      options: {
        stream: {
          type: "boolean",
          default: false,
          desc: "stream output from child processes, prefixed with the originating package name",
        },
        parallel: {
          type: "boolean",
          default: false,
          desc: "run a given command or script immediately in all matching packages with prefixed streaming output",
        },
        prefix: {
          type: "boolean",
          default: true,
          desc: "no-prefix to disable package name prefixing for stream output",
        },
        bail: {
          type: "boolean",
          default: true,
          desc: "no-bail to disable exit on error and run script in all packages regardless of exit code",
        },
        concurrency: {
          alias: "cc",
          type: "number",
          default: 3,
          desc: "number of packages to bootstrap concurrently",
        },
        sort: {
          type: "boolean",
          default: true,
          desc: "no-sort to disable topological sorting",
        },
      },
    },
    version: {
      alias: "v",
      desc: "Update changelog and bump version",
      exec: execVersion,
      options: {
        tag: {
          type: "boolean",
          default: false,
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
          type: "string",
          desc: "set publish tag for all packages",
        },
        "dry-run": {
          type: "boolean",
          default: false,
          desc: "publish dry run",
        },
        push: {
          type: "boolean",
          default: true,
          desc: "no-push to skip pushing release tag to remote",
        },
      },
    },
    init: {
      alias: "i",
      desc: "Initialize a new fynpo repo",
      exec: execInit,
      options: {
        commitlint: {
          type: "boolean",
          default: false,
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
          type: "string",
          description: "path to the config file",
        },
        color: {
          alias: "c",
          default: true,
          description: "toggle colored output",
          type: "boolean",
        },
        edit: {
          alias: "e",
          description:
            "read last commit message from the specified file or fallbacks to ./.git/COMMIT_EDITMSG",
          type: "string",
        },
        verbose: {
          alias: "V",
          type: "boolean",
          description: "enable verbose output for reports without problems",
        },
      },
    },
  }
);

nixClap.parseAsync();
