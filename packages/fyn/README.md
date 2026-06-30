# fyn

[![NPM version][npm-image]][npm-url]
[![Apache 2.0 License][apache-2.0-blue-image]][apache-2.0-url]
[![Build Status][build-image]][build-url]
[![Coverage Status][coveralls-image]][coveralls-url]

**fyn** is the package manager for [fynpo], a zero setup monorepo manager for node.js.

It treats your disk as a registry so you can develop, publish, and test all your packages using local copies directly.

## Quick Start

Interested in giving it a quick test? Just install and run it on your project:

```sh
npm i -g fyn
cd <your-project>
fyn
```

Want to add a package on your local disk as a dependency to your project? Do this:

```sh
fyn add ../another-package
```

To see detailed stats about any package, use the `stat` command:

```sh
fyn stat lodash
```

- It can read and use some settings from your `.npmrc`.
- It can use `npm-shrinkwrap.json` or `package-lock.json` files.

## Configuring fyn

fyn options can be listed in help:

```sh
fyn --help
```

fyn loads config from `CWD/.fynrc`, `CWD/.npmrc`, `~/.fynrc`, and `~/.npmrc` in this specified order, from highest to lowest priority.

From `.npmrc`, only fields `registry`, `@<scope>:registry`,`email`, and `_auth` are read.

`.fynrc` file can be an [ini] or `YAML` format. For the `YAML` format, the first line must be `---`.

Below is an `YAML` example, with all the options set to their default values:

```yml
---
registry: https://registry.npmjs.org
"@scope:registry": https://registry.custom.com
offline: false
forceCache: false
lockOnly: false
progress: normal
logLevel: info
production: false
centralStore: false
```

Or as an ini:

```ini
registry=https://registry.npmjs.org
@scope:registry=https://registry.custom.com
offline=false
forceCache=false
lockOnly=false
progress=normal
logLevel=info
production=false
centralStore=false
```

### Lifecycle script allow list (`fyn.allowScripts`)

As a security hardening measure, `fyn` does **not** run a package's npm lifecycle
scripts (`preinstall`, `install`, `postinstall`) during install unless the package
came from a configured registry (the primary `registry` or a `@scope:registry`) or
is a local `file:`/`link:`/symlink dependency.

Packages pulled from other sources — `github:`, git URLs (`git+https`, `git+ssh`,
…), and `http(s)` tarball URLs — have their lifecycle scripts **skipped by default**,
and `fyn` prints a warning showing how to allow them.

To allow specific scripts for such a package, add a `fyn.allowScripts` map to your
`package.json`. Each key is `name@<spec-or-version>` and the value is the list of
allowed script names:

```json
{
  "fyn": {
    "allowScripts": {
      "foo@github:user/foo#v1": ["install", "postinstall"],
      "bar@2.3.0": ["preinstall"]
    }
  }
}
```

- The key matches **either** the original dependency spec (e.g. `foo@github:user/foo#v1`)
  **or** the resolved version (e.g. `bar@2.3.0`).
- Script names are matched case-insensitively.
- Use `["*"]` (or `true`) as the value to allow all lifecycle scripts for that package.

### Thank you `npm`

Node Package Manager is a very large and complex piece of software. Developing `fyn` was 10 times easier because of the generous open source software from the community, especially the individual packages that are part of `npm`.

Other than benefiting from the massive package ecosystem and all the documents from `npm`, these are the concrete packages from `npm` that `fyn` is using directly.

- [node-tar] - for untaring `tgz` files.
- [semver] - for handling Semver versions.
- [pacote] - for retrieving `npm` package data.
- [ini] - for handling `ini` config files.
- [npm-packlist] - for filtering files according to npm ignore rules.
- [@npmcli/run-script] - for running package scripts.
- [npmlog] - for offering the `run` command as a convenience.
- And all the other packages they depend on.

## License

Copyright (c) 2015-2021, WalmartLabs

Licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

[node_options]: https://nodejs.org/dist/latest-v8.x/docs/api/cli.html#cli_node_options_options
[`-r` option]: https://nodejs.org/docs/latest-v6.x/api/cli.html#cli_r_require_module
[fyn-demo-gif]: ./images/fyn-demo.gif
[ini]: https://www.npmjs.com/package/ini
[node_preserve_symlinks]: https://nodejs.org/docs/latest-v8.x/api/cli.html#cli_node_preserve_symlinks_1
[require-at]: https://www.npmjs.com/package/require-at
[travis-image]: https://travis-ci.org/electrode-io/fyn.svg?branch=master
[travis-url]: https://travis-ci.org/electrode-io/fyn
[npm-image]: https://badge.fury.io/js/fyn.svg
[npm-url]: https://npmjs.org/package/fyn
[coveralls-image]: https://coveralls.io/repos/github/electrode-io/fyn/badge.svg?branch=master
[coveralls-url]: https://coveralls.io/github/electrode-io/fyn?branch=master
[daviddm-image]: https://david-dm.org/electrode-io/fyn/status.svg
[daviddm-url]: https://david-dm.org/electrode-io/fyn
[daviddm-dev-image]: https://david-dm.org/electrode-io/fyn/dev-status.svg
[daviddm-dev-url]: https://david-dm.org/electrode-io/fyn?type=dev
[apache-2.0-blue-image]: https://img.shields.io/badge/License-Apache%202.0-blue.svg
[apache-2.0-url]: https://www.apache.org/licenses/LICENSE-2.0
[npm scripts]: https://docs.npmjs.com/misc/scripts
[node-tar]: https://www.npmjs.com/package/tar
[semver]: https://www.npmjs.com/package/semver
[pacote]: https://www.npmjs.com/package/pacote
[ini]: https://www.npmjs.com/package/ini
[npm-packlist]: https://www.npmjs.com/package/npm-packlist
[pnpm]: https://www.npmjs.com/package/pnpm
[npm]: https://www.npmjs.com/package/npm
[lerna]: https://www.npmjs.com/package/lerna
[fynpo]: https://www.npmjs.com/package/fynpo
[npm link]: https://docs.npmjs.com/cli/link.html
[@npmcli/run-script]: https://www.npmjs.com/package/@npmcli/run-script
[npmlog]: https://www.npmjs.com/package/npmlog
[build-image]: https://github.com/jchip/fynpo/actions/workflows/ci.yml/badge.svg
[build-url]: https://github.com/jchip/fynpo/actions/workflows/ci.yml
[fynpo]: https://github.com/jchip/fynpo
