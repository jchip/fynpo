// @ts-nocheck
"use strict";

/* eslint-disable global-require, prefer-template */

const Fs = require("./util/file-ops");
const Path = require("path");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin to node_modules/.bin
// TODO: only do this for packages in package.json [*]dependencies
//

const CYGWIN_LINK = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")

case \`uname\` in
    *CYGWIN*) basedir=\`cygpath -w "$basedir"\`;;
esac

if [ -x "$basedir/node" ]; then
  "$basedir\\node"  "$basedir\\{{TARGET}}" "$@"
  ret=$?
else
  node  "$basedir\\{{TARGET}}" "$@"
  ret=$?
fi
exit $ret
`;

const CMD_BATCH = `@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\{{TARGET}}" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\{{TARGET}}" %*
)
`;

class PkgBinLinkerWin32 extends PkgBinLinkerBase {
  constructor(options) {
    super(options);
  }

  //
  // Platform specific
  //

  async _isBinLinkTarget(symlink, target) {
    try {
      const existTarget = (await Fs.readFile(symlink)).toString();
      return existTarget.indexOf(target) >= 0;
    } catch (err) {
      return false;
    }
  }

  async _ensureGoodLink(symlink, target) {
    if (await this._isBinLinkTarget(symlink, target)) {
      return true;
    }

    await this._rmBinLink(symlink);

    return false;
  }

  async _generateBinLink(relTarget, symlink) {
    await this._saveCmd(symlink, CYGWIN_LINK, relTarget);
    await this._saveCmd(symlink + ".cmd", CMD_BATCH, relTarget);
  }

  async _rmBinLink(symlink) {
    await this._unlinkFile(symlink);
    await this._unlinkFile(symlink + ".cmd");
  }

  // Extract the {{TARGET}} path baked into a generated .cmd wrapper (the path
  // after `%~dp0\`, ignoring the node.exe reference).
  async _readBinLinkTarget(symlink) {
    const content = (await Fs.readFile(symlink + ".cmd")).toString();
    const matches = [...content.matchAll(/%~dp0[\\/]+([^"\r\n]+)/g)].map(m => m[1]);
    return matches.find(m => m !== "node.exe");
  }

  //
  // Platform specific: the "bin" is a pair of regular script files (cygwin +
  // .cmd), not a symlink, so the base _cleanLink's Fs.access on the wrapper
  // always succeeds and never cleans a stale bin. Instead, read the wrapper and
  // remove it only if the target it points to no longer exists.
  //
  async _cleanLink(sym) {
    const symlink = Path.join(this._binDir, sym);

    try {
      const target = await this._readBinLinkTarget(symlink);
      if (target && (await Fs.exists(Path.join(this._binDir, target)))) {
        return false;
      }
    } catch (e) {
      // unreadable / malformed wrapper -> treat as stale and remove
    }

    await this._rmBinLink(symlink);

    return true;
  }

  async _readBinLinks() {
    return (await Fs.readdir(this._binDir)).filter(x => !x.endsWith(".cmd"));
  }

  async _saveCmd(name, data, target) {
    return Fs.writeFile(name, data.replace(/{{TARGET}}/g, target));
  }
}

module.exports = PkgBinLinkerWin32;
