"use strict";

//
// With code copied from:
//
// https://github.com/npm/cli/blob/58ece8973f43c77b1f4f44ded0f49556ad30eb57/lib/pack.js
//
// Licensed under The Artistic License 2.0 as the original code.
//
// Heavily modified to allow custom callback hooks
//
// Prepare packages that did not come from npm registry, therefore may not
// have gone through the standard npm publish process, and npm scripts such
// as prepare may not have been executed.
//
// So if npm script prepare exist, then need to install dependencies (with dev)
// for the package, execute the prepare script, and finally pack files into
// tgz file for pacote.
//

const cacache = require("cacache");
const Path = require("path");
const Promise = require("aveazul");
const PassThrough = require("stream").PassThrough;
const mississippi = require("mississippi");
const pipe = Promise.promisify(mississippi.pipe, { context: mississippi });
const tar = require("tar");
const packlist = require("npm-packlist");
const Fs = require("opfs");

const readPkgJson = (dir) => {
  return Fs.readFile(Path.join(dir, "package.json").toString().trim()).then(JSON.parse);
};

class PkgPreper {
  constructor({ tmpDir, installDependencies }) {
    this._tmpDir = tmpDir;
    this._installDependencies = installDependencies;
  }

  packDirectory(mani, dir, target) {
    return (
      readPkgJson(dir)
        // .then(pkg => {
        //   return lifecycle(pkg, "prepack", dir);
        // })
        // .then(() => {
        //   return readJson(path.join(dir, "package.json"));
        // })
        .then((pkg) => {
          return cacache.tmp.withTmp(this._tmpDir, { tmpPrefix: "packing" }, (tmp) => {
            const tmpTarget = Path.join(tmp, Path.basename(target));

            const tarOpt = {
              file: tmpTarget,
              cwd: dir,
              prefix: "package/",
              portable: true,
              // Provide a specific date in the 1980s for the benefit of zip,
              // which is confounded by files dated at the Unix epoch 0.
              mtime: new Date("1985-10-26T08:15:00.000Z"),
              gzip: true,
            };

            return Promise.resolve(packlist({ path: dir }))
              .then((files) => {
                // NOTE: node-tar does some Magic Stuff depending on prefixes for files
                //       specifically with @ signs, so we just neutralize that one
                //       and any such future "features" by prepending `./`
                return tar.create(
                  tarOpt,
                  files.map((f) => `./${f}`)
                );
              })
              .tap(() => Fs.rename(tmpTarget, target));
            // .then(() => getContents(pkg, tmpTarget, filename, logIt))
            // // thread the content info through
            // .tap(() => move(tmpTarget, target, { Promise: BB, fs }))
            // .tap(() => lifecycle(pkg, "postpack", dir))
          });
        })
    );
  }

  //
  // dirPacker for pacote when retrieving packages from remote, particularly github
  // reference: https://github.com/npm/cli/blob/58ece8973f43c77b1f4f44ded0f49556ad30eb57/lib/pack.js#L293
  //
  depDirPacker(manifest, dir) {
    const stream = new PassThrough();

    readPkgJson(dir)
      .then((pkg) => {
        if (pkg.scripts && pkg.scripts.prepare) {
          return this._installDependencies(
            dir,
            `preparing gitdep package ${pkg.name} from ${manifest._resolved}`
          );
        }
      })
      .tap(() => stream.emit("prepared"))
      .then(() => {
        return cacache.tmp.withTmp(this._tmpDir, { tmpPrefix: "pacote-packing" }, (tmp) => {
          const tmpTar = Path.join(tmp, "package.tgz");
          return this.packDirectory(manifest, dir, tmpTar).then(() => {
            return pipe(Fs.createReadStream(tmpTar), stream);
          });
        });
      })
      .catch((err) => {
        stream.emit("error", err);
      });

    return stream;
  }

  getDirPackerCb() {
    return (m, d) => this.depDirPacker(m, d);
  }
}

module.exports = PkgPreper;
