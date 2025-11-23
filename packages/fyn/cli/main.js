"use strict";

const Path = require("path");
const chalk = require("chalk");
const Promise = require("aveazul");
const FynCli = require("./fyn-cli");
const _ = require("lodash");
const CliLogger = require("../lib/cli-logger");
const logger = require("../lib/logger");
const { NixClap } = require("nix-clap");
const myPkg = require("./mypkg");
const loadRc = require("./load-rc");
const defaultRc = require("./default-rc");
const fynTil = require("../lib/util/fyntil");
const optionalRequire = require("optional-require")(require);
const { runInitPackage } = require("init-package");
const FynGlobal = require("../lib/fyn-global");

function setLogLevel(ll) {
  if (ll) {
    const levels = Object.keys(CliLogger.Levels);
    const real = _.find(levels, l => l.startsWith(ll));
    const x = CliLogger.Levels[real];
    if (x !== undefined) {
      logger._logLevel = x;
    } else {
      logger.error(`Invalid log level "${ll}".  Supported levels are: ${levels.join(", ")}`);
      fynTil.exit(1);
    }
  }
}

const pickEnvOptions = () => {
  const mapping = {
    NODE_ENV: { optKey: "production", checkValue: "production" }
  };

  return Object.keys(mapping).reduce((cfg, envKey) => {
    if (process.env.hasOwnProperty(envKey)) {
      const m = mapping[envKey];
      const ev = process.env[envKey];
      cfg[m.optKey] = ev === m.checkValue;
      logger.info(`setting option ${m.optKey} to ${cfg[m.optKey]} by env ${envKey} value ${ev}`);
    }
  }, {});
};

const pickOptions = async (cmd, checkFynpo = true) => {
  const meta = cmd.jsonMeta;
  // Global options (like --cwd) are stored in cmd.rootCmd.opts
  // Merge root command options with command-specific options
  const rootOpts = cmd.rootCmd?.opts || {};
  const cmdOpts = cmd.opts || {};
  const allOpts = Object.assign({}, rootOpts, cmdOpts, meta.opts);
  setLogLevel(allOpts.logLevel);

  chalk.enabled = allOpts.colors;

  let cwd = allOpts.cwd || process.cwd();

  if (!Path.isAbsolute(cwd)) {
    cwd = Path.join(process.cwd(), cwd);
  }

  let fynpo = {};

  if (checkFynpo) {
    try {
      fynpo = await fynTil.loadFynpo(cwd);
    } catch (err) {
      logger.error(err.stack);
      process.exit(1);
    }
  }

  const rcData = loadRc(allOpts.rcfile === false ? false : cwd, fynpo.dir);

  const rc = rcData.all || defaultRc;

  _.defaults(allOpts, rc);
  cmd.applyConfig(pickEnvOptions());

  allOpts.cwd = cwd;
  meta.opts.cwd = cwd;

  chalk.enabled = allOpts.colors;

  if (meta.source.saveLogs && !meta.source.saveLogs.startsWith("cli")) {
    allOpts.saveLogs = undefined;
    meta.opts.saveLogs = undefined;
  }

  // Preserve cwd from CLI/config, don't let fynpo config override it
  const savedCwd = allOpts.cwd;
  cmd.applyConfig(_.get(fynpo, "config.fyn.options", {}));
  if (savedCwd) {
    allOpts.cwd = savedCwd;
    meta.opts.cwd = savedCwd;
  }

  logger.debug("Final RC", JSON.stringify(fynTil.removeAuthInfo(allOpts)));

  setLogLevel(allOpts.logLevel);
  if (allOpts.progress) logger.setItemType(allOpts.progress);

  return { opts: allOpts, rcData, _cliSource: meta.source, _fynpo: fynpo };
};

const options = {
  fynlocal: {
    args: "<flag boolean>",
    desc: "enable/disable fynlocal mode",
    argDefault: "true"
  },
  "always-fetch-dist": {
    args: "<flag boolean>",
    desc: "fetch package dist tarball during dep resolving",
    argDefault: "false"
  },
  "central-store": {
    args: "<flag boolean>",
    alias: ["central", "cs"],
    desc: "keep single copy of packages in central store",
    argDefault: "false"
  },
  copy: {
    args: "[packages string..]",
    alias: "cp",
    desc: "copy package even in central store mode"
  },
  "log-level": {
    alias: "q",
    args: "<level string>",
    desc: "One of: debug,verbose,info,warn,error,fyi,none",
    argDefault: "info"
  },
  "save-logs": {
    args: "[file string]",
    alias: "sl",
    argDefault: "fyn-debug.log",
    desc: "Save all logs to the specified file"
  },
  colors: {
    args: "<flag boolean>",
    argDefault: "true",
    desc: "Log with colors (--no-colors turn off)"
  },
  progress: {
    args: "<type string>",
    alias: "pg",
    argDefault: "normal",
    desc: "Log progress type: normal,simple,none"
  },
  cwd: {
    args: "<dir string>",
    desc: "Change current working dir"
  },
  "fyn-dir": {
    args: "<dir string>",
    desc: "Dir for cache etc, default {HOME}/.fyn"
  },
  "force-cache": {
    alias: "f",
    args: "<flag boolean>",
    desc: "Don't check registry if cache exists."
  },
  offline: {
    args: "<flag boolean>",
    desc: "Only lockfile or local cache. Fail if miss."
  },
  "lock-only": {
    alias: "k",
    args: "<flag boolean>",
    desc: "Only resolve with lockfile. Fail if needs changes."
  },
  "prefer-lock": {
    args: "<flag boolean>",
    desc: "Prefer resolving with lockfile."
  },
  lockfile: {
    args: "<flag boolean>",
    alias: "lf",
    argDefault: "true",
    desc: "Support lockfile"
  },
  "lock-time": {
    args: "<time string>",
    desc: "Lock dependencies by time"
  },
  "npm-lock": {
    args: "<flag boolean>",
    desc: "force on/off loading npm lock"
  },
  "refresh-optionals": {
    args: "<flag boolean>",
    argDefault: "false",
    desc: "refresh all optionalDependencies"
  },
  "refresh-meta": {
    args: "<flag boolean>",
    argDefault: "false",
    desc: "force refresh package meta from registry"
  },
  "ignore-dist": {
    alias: "i",
    args: "<flag boolean>",
    desc: "Ignore host in tarball URL from meta dist."
  },
  "show-deprecated": {
    alias: "s",
    args: "<flag boolean>",
    desc: "Force show deprecated messages"
  },
  "deep-resolve": {
    alias: "dr",
    args: "<flag boolean>",
    desc: "Resolve dependency tree as deep as possible"
  },
  "source-maps": {
    alias: "sm",
    args: "<flag boolean>",
    argDefault: "false",
    desc: "Generate pseudo source maps for local linked packages"
  },
  production: {
    args: "<flag boolean>",
    alias: "prod",
    argDefault: "false",
    desc: "Ignore devDependencies"
    // allowCmd: ["add", "remove", "install"]
  },
  rcfile: {
    args: "<flag boolean>",
    argDefault: "true",
    desc: "Load .fynrc and .npmrc files"
  },
  registry: {
    args: "<url string>",
    alias: "reg",
    desc: "Override registry url"
  },
  concurrency: {
    args: "<num number>",
    alias: "cc",
    desc: "Max network concurrency",
    argDefault: "15"
  },
  "auto-run": {
    args: "<flag boolean>",
    argDefault: "true",
    desc: "auto run npm scripts after install"
  },
  "build-local": {
    args: "<flag boolean>",
    argDefault: "true",
    desc: "auto run fyn to install and build local dependency packages"
  },
  "flatten-top": {
    args: "<flag boolean>",
    argDefault: "true",
    desc: "flattening hoists pkg to top level node_modules"
  },
  layout: {
    args: "<type string>",
    argDefault: "normal",
    // node_modules package directory layouts
    // normal - top level and hoist deps are all copied node_modules
    // detail - every packages in their own path with version detail and symlink to node_modules
    // TODO: simple - where top level deps are copied, but promoted packages are hoisted with symlinks
    desc: "set node_modules packages layout - normal or detail"
  },
  "meta-memoize": {
    args: "<url string>",
    alias: "meta-mem",
    desc: "a url to a server that helps multiple fyn to share meta cache"
  }
};

const commands = {
  install: {
    alias: "i",
    desc: "Install modules",
    async exec(cmd) {
      const cli = new FynCli(await pickOptions(cmd));
      return cli.install();
    },
    options: {
      "run-npm": {
        desc: "additional npm scripts to run after install",
        args: "[scripts string..]"
      },
      "force-install": {
        alias: "fi",
        desc: "force install even if no files changed since last install",
        args: "<flag boolean>"
      }
    }
  },
  add: {
    alias: "a",
    args: "[packages string..]",
    usage: "$0 $1 [packages..] [--dev <dev packages>]",
    desc: "add packages to package.json",
    exec: async cmd => {
      const meta = cmd.jsonMeta;
      // Global options (like --cwd) are stored in cmd.rootCmd.opts
      // Merge root command options into meta.opts so pickOptions can access them
      if (cmd.rootCmd && cmd.rootCmd.opts) {
        Object.assign(meta.opts, cmd.rootCmd.opts);
      }
      const config = await pickOptions(cmd);
      const lockFile = config.lockfile;
      config.lockfile = false;
      const cli = new FynCli(config);
      const opts = Object.assign({}, meta.opts, meta.args);
      return cli.add(opts).then(added => {
        if (!added || !meta.opts.install) return;
        config.lockfile = lockFile;
        config.noStartupInfo = true;
        logger.info("installing...");
        fynTil.resetFynpo();
        return new FynCli(config).install();
      });
    },
    options: {
      dev: {
        alias: ["d"],
        args: "[packages string..]",
        desc: "List of packages to add to devDependencies"
      },
      opt: {
        args: "[packages string..]",
        desc: "List of packages to add to optionalDependencies"
      },
      peer: {
        alias: ["p"],
        args: "[packages string..]",
        desc: "List of packages to add to peerDependencies"
      },
      install: {
        args: "<flag boolean>",
        argDefault: "true",
        desc: "Run install after added"
      },
      "pkg-fyn": {
        args: "<flag boolean>",
        desc: "save fyn section to package-fyn.json",
        argDefault: "false"
      }
    }
  },
  remove: {
    alias: "rm",
    args: "<packages string..>",
    desc: "Remove packages from package.json and install",
    exec: async cmd => {
      const meta = cmd.jsonMeta;
      // Global options (like --cwd) are stored in cmd.rootCmd.opts
      // Merge root command options into meta.opts for consistent access
      if (cmd.rootCmd && cmd.rootCmd.opts) {
        Object.assign(meta.opts, cmd.rootCmd.opts);
      }
      const options = await pickOptions(cmd);
      const lockFile = options.lockfile;
      options.lockfile = false;
      const cli = new FynCli(options);
      const opts = Object.assign({}, meta.opts, meta.args);
      const removed = await cli.remove(opts);
      if (removed) {
        if (!meta.opts.install) return;
        options.lockfile = lockFile;
        options.noStartupInfo = true;
        fynTil.resetFynpo();
        logger.info("installing...");
        return await new FynCli(options).install();
      }
    },
    options: {
      install: {
        args: "<flag boolean>",
        argDefault: "true",
        desc: "Run install after removed"
      }
    }
  },
  stat: {
    desc: "Show stats of installed packages",
    usage: "$0 $1 <package-name>[@semver] [...]",
    args: "<packages string..>",
    exec: async cmd => {
      return new FynCli(await pickOptions(cmd)).stat(cmd.jsonMeta);
    }
  },
  run: {
    desc: "Run a npm script",
    args: "[script string] [args...]",
    alias: ["rum", "r"],
    usage: "$0 $1 <command> [args...] [-- <args>...]",
    exec: async (cmd, parsed) => {
      try {
        const meta = cmd.jsonMeta;
        const options = await pickOptions(cmd, !meta.opts.list);
        return await new FynCli(options).run(meta, undefined, cmd, parsed);
      } catch (err) {
        // Determine exit code from error
        // @npmcli/run-script uses err.code (exit code), not err.errno
        const exitCode = err.errno !== undefined ? err.errno : (err.code || 1);

        // Format and log the error cleanly
        if (err.event && err.script) {
          // This is a script execution error
          logger.error(chalk.red(`Script '${err.event}' failed${err.pkgid ? ` for ${err.pkgid}` : ''}`));
          if (err.path) {
            logger.error(chalk.dim(`  Location: ${err.path}`));
          }
          if (err.cmd && err.args) {
            logger.error(chalk.dim(`  Command: ${err.cmd} ${err.args.join(' ')}`));
          } else if (err.script) {
            logger.error(chalk.dim(`  Script: ${err.script}`));
          }
          if (typeof exitCode === 'number') {
            logger.error(chalk.dim(`  Exit code: ${exitCode}`));
          }
          if (err.signal) {
            logger.error(chalk.dim(`  Signal: ${err.signal}`));
          }
        } else {
          // Generic error
          logger.error(chalk.red("Script execution failed:"));
          logger.error(err.message || err.toString());
          if (err.stack && logger._logLevel <= CliLogger.Levels.debug) {
            logger.debug(err.stack);
          }
        }

        fynTil.exit(typeof exitCode === 'number' ? exitCode : 1);
      }
    },
    options: {
      list: {
        desc: "list scripts",
        alias: "l",
        args: "<flag boolean>"
      }
    }
  },
  init: {
    desc: "initialize a package.json file",
    usage: "$0 $1 <command> [--yes]",
    exec: async cmd => {
      try {
        await runInitPackage(cmd.jsonMeta.opts.yes);
      } catch (err) {
        process.exit(1);
      }
    },
    options: {
      yes: {
        alias: ["y"],
        desc: "skip prompt and use default values",
        args: "<flag boolean>"
      }
    }
  },

  "sync-local": {
    desc: "Refresh locally linked package files",
    alias: "sl",
    async exec(cmd) {
      try {
        const opts = await pickOptions(cmd, true);
        const cli = new FynCli(opts);
        return cli.syncLocalLinks();
      } catch (err) {
        process.exit(1);
      }
    }
  },

  global: {
    desc: "Manage global packages",
    subCommands: {
      add: {
        desc: "Install packages globally",
        args: "<packages string..>",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          const packages = cmd.args?.packages || [];

          if (packages.length === 0) {
            logger.error("No packages specified");
            fynTil.exit(1);
          }

          for (const pkg of packages) {
            try {
              await fynGlobal.installGlobalPackage(pkg);
            } catch (err) {
              logger.error(`Failed to install ${pkg}: ${err.message}`);
              fynTil.exit(1);
            }
          }
        }
      },

      remove: {
        desc: "Remove a global package",
        alias: "rm",
        args: "<package string>",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          const packageName = cmd.args?.package;

          if (!packageName) {
            logger.error("No package specified");
            fynTil.exit(1);
          }

          const removed = await fynGlobal.removeGlobalPackage(packageName);
          if (!removed) {
            fynTil.exit(1);
          }
        }
      },

      list: {
        desc: "List globally installed packages",
        alias: "ls",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          await fynGlobal.listGlobalPackages();
        }
      },

      update: {
        desc: "Update global packages",
        args: "[package string]",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          const packageName = cmd.args?.package;

          if (packageName) {
            const updated = await fynGlobal.updateGlobalPackage(packageName);
            if (!updated) {
              fynTil.exit(1);
            }
          } else {
            // Update all packages
            const packages = await fynGlobal.getAllGlobalPackages();
            if (packages.length === 0) {
              logger.info("No global packages to update");
              return;
            }
            for (const pkg of packages) {
              await fynGlobal.updateGlobalPackage(pkg.meta.package);
            }
          }
        }
      },

      use: {
        desc: "Switch to Node version's global packages",
        args: "[version string]",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          await fynGlobal.useNodeVersion(cmd.args?.version);
        }
      },

      "setup-path": {
        desc: "Show PATH setup instructions",
        options: {
          "dir": { args: "<dir string>", desc: "Directory for global packages (default: ~/.fyn/global)" }
        },
        async exec(cmd) {
          setLogLevel(cmd.opts?.logLevel || cmd.rootCmd?.opts?.logLevel);
          const fynGlobal = new FynGlobal({ globalDir: cmd.opts?.dir });
          fynGlobal.showPathSetup();
        }
      }
    }
  }
};

const createNixClap = (handlers = {}) => {
  const nc = new NixClap({
    name: myPkg.name,
    usage: "$0 [options] <command>",
    handlers: handlers,
    defaultCommand: "install", // Run install when no command is given (e.g., `fyn` or `fyn --verbose`)
    unknownCommandFallback: "run", // Make `fyn <script>` behave like `fyn run <script>`
    helpZebra: true // Enable zebra striping for better readability on wide terminals
  });
  nc.version(myPkg.version);
  return nc;
};

const run = async (args, start, tryRun = true) => {
  fynTil.resetFynpo();

  if (start === undefined && args !== undefined) {
    start = 0;
  }

  // Store args and start for use in no-action handler
  const storedArgs = args;
  const storedStart = start;

  const handlers = {
    "parse-fail": parsed => {
      // In v2, check errorNodes instead of commands
      const hasCommands =
        parsed.command &&
        parsed.command.jsonMeta &&
        Object.keys(parsed.command.jsonMeta.subCommands || {}).length > 0;
      if (
        !hasCommands &&
        parsed.errorNodes &&
        parsed.errorNodes.length > 0 &&
        parsed.errorNodes[0].error.message.includes("Unknown command")
      ) {
        // Skip exec for unknown commands
        return;
      } else {
        // Get the NixClap instance from the parsed result
        const nc = parsed.command?._nixClap || this;
        if (nc && nc.showError) {
          nc.showError(parsed.errorNodes?.[0]?.error);
        }
      }
    },
    "unknown-option": () => {}
    // No "no-action" handler needed - defaultCommand handles running install when no command is given
  };

  const nc = createNixClap(handlers);
  nc.init2({
    options,
    subCommands: commands
  });

  const parsed = await nc.parseAsync(args, start);

  if (!tryRun || !parsed.errorNodes || parsed.errorNodes.length === 0) {
    return;
  }

  // Check if we should try to inject "run" command
  const hasCommands =
    parsed.command &&
    parsed.command.jsonMeta &&
    Object.keys(parsed.command.jsonMeta.subCommands || {}).length > 0;
  if (parsed.errorNodes && !hasCommands) {
    const x = start === undefined ? 2 : start;
    const args2 = (args || process.argv).slice();
    args2.splice(x, 0, "run");

    const nc2 = createNixClap();
    nc2.init2({
      options,
      subCommands: commands
    });
    await nc2.parseAsync(args2, x);
  } else {
    nc.showError(parsed.errorNodes?.[0]?.error);
  }
};

const fun = () => {
  const argv = process.argv.slice();

  argv.splice(2, 0, "run");

  return run(argv, 2, false);
};

const nodeGyp = () => {
  require("node-gyp/bin/node-gyp");
};

const hardLinkDir = require("../lib/util/hard-link-dir");

module.exports = {
  run,
  fun,
  nodeGyp,
  hardLinkDir
};
