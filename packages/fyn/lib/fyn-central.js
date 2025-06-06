"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements, no-empty */

const Path = require("path");
const Fs = require("./util/file-ops");
const ssri = require("ssri");
const Tar = require("tar");
const { missPipe } = require("./util/fyntil");
const { linkFile, copyFile } = require("./util/hard-link-dir");
const logger = require("./logger");
const { AggregateError } = require("@jchip/error");
const filterScanDir = require("filter-scan-dir");
const Crypto = require("crypto");
const xaa = require("xaa");

/**
 * convert a directory tree structure to a flatten one like:
 * ```
 * {
 *  dirs: [
 *    "/dir1"
 *  ],
 *  files: [
 *    "/file1",
 *    "/dir1/file1"
 *  ]
 * }
 * ```
 *
 * @param {*} tree - the dir tree
 * @param {*} output - output object
 * @param {*} baseDir - base dir path
 * @returns flatten dir list
 */
function flattenTree(tree, output, baseDir) {
  const dirs = Object.keys(tree);

  for (const dir of dirs) {
    if (dir === "/") continue;
    const fdir = Path.join(baseDir, dir);
    output.dirs.push(fdir);
    flattenTree(tree[dir], output, fdir);
  }

  const files = Object.keys(tree["/"]);
  for (const file of files) {
    output.files.push(Path.join(baseDir, file));
  }

  return output;
}

/**
 * create and maintain the fyn central storage
 */
class FynCentral {
  constructor({ centralDir = ".fyn/_central-storage" }) {
    this._centralDir = Path.resolve(centralDir);
    this._map = new Map();
  }

  _analyze(integrity) {
    const sri = ssri.parse(integrity, { single: true });

    const algorithm = sri.algorithm;
    const hex = sri.hexDigest();

    const segLen = 2;
    const contentPath = Path.join(
      ...[this._centralDir, algorithm].concat(
        hex.substr(0, segLen),
        hex.substr(segLen, segLen),
        hex.substr(segLen * 2)
      )
    );

    return { algorithm, contentPath, hex };
  }

  /**
   * load a dir tree for a centrally stored package
   *
   * @param {*} integrity - package integrity checksum
   * @param {*} _info - package info
   * @param {*} _noSet - if true, then do not mark package in map
   * @returns dir tree info
   */
  async _loadTree(integrity, _info, _noSet) {
    let info = _info;
    let noSet = _noSet;

    if (!info) {
      if (this._map.has(integrity)) {
        info = this._map.get(integrity);
        noSet = true;
      } else {
        info = this._analyze(integrity);
        info.tree = false;
      }
    }

    try {
      const stat = await Fs.stat(info.contentPath);
      info.exist = true;
      if (stat.isDirectory()) {
        await this.readInfoTree(info);
        if (!noSet) {
          this._map.set(integrity, info);
        }
      }
      return info;
    } catch (err) {
      return info;
    }
  }

  /**
   * check if central has the package
   *
   * @param {*} integrity - package integrity
   * @returns boolean
   */
  async has(integrity) {
    const info = this._map.has(integrity)
      ? this._map.get(integrity)
      : await this._loadTree(integrity);

    return Boolean(info.tree);
  }

  /**
   * check if if a package is allowed to go into central store
   *
   * @param {*} integrity  - package integrity
   * @returns boolean
   */
  async allow(integrity) {
    const info = this._map.has(integrity)
      ? this._map.get(integrity)
      : await this._loadTree(integrity);

    return info.mutates ? false : true;
  }

  async getContentPath(integrity) {
    return (await this.getInfo(integrity)).contentPath;
  }

  async getInfo(integrity) {
    if (this._map.has(integrity)) {
      return this._map.get(integrity);
    }
    const info = await this._loadTree(integrity);
    if (!info.tree) {
      throw new Error(`fyn-central can't get package for integrity ${integrity}`);
    }
    return info;
  }

  async _calcContentShasum(info, pkgDir = undefined) {
    try {
      const packageDir = pkgDir || Path.join(info.contentPath, "package");
      const filter = (_file, _path, extras) => {
        const { stat, dirFile } = extras;
        return { formatName: `${dirFile}-${stat.mtimeMs}-${stat.size}` };
      };

      const files = await filterScanDir({
        cwd: packageDir,
        filter,
        filterDir: filter,
        fullStat: true, // need full stat for mtimeMs and size prop
        concurrency: 500,
        sortFiles: false, // concurrency breaks sorting, sort files all at once after
        includeDir: true
      });

      const hash = Crypto.createHash("sha512");
      const shaSum = hash.update(JSON.stringify(files.sort())).digest("base64");
      return shaSum;
    } catch (_err) {
      return undefined;
    }
  }

  /**
   * Get the hash of a npm package's extracted content.
   * - only consider the file names and their mtime and size because npm tar files
   *   with a fixed timestamp to publish, so the mtime give us some assurance
   *   to know if file changed.
   *
   * @param {*} integrity - shasum integrity for the package
   * @returns void
   */
  async getContentShasum(integrity) {
    try {
      const info = await this.getInfo(integrity);
      return this._calcContentShasum(info);
    } catch (_err) {
      return undefined;
    }
  }

  async getMutation(integrity) {
    const info = this._map.has(integrity)
      ? this._map.get(integrity)
      : await this._loadTree(integrity);

    return info.mutates;
  }

  async delete(integrity) {
    const info = this._map.get(integrity);
    if (info && info.exist && info.contentPath) {
      await Fs.$.rimraf(info.contentPath);
      this._map.delete(integrity);
    }
  }

  /**
   * Read the content dir tree from file into into
   *
   * @param {*} info - info
   */
  async readInfoTree(info) {
    const treeFile = Path.join(info.contentPath, "tree.json");
    try {
      const data = await Fs.readFile(treeFile);
      const tree = JSON.parse(data);
      if (tree._ >= 1) {
        if (tree.mutates !== undefined) {
          info.mutates = tree.mutates;
        }
        info.tree = tree.$;
        info.shaSum = tree.shaSum;
      } else {
        info.tree = tree;
      }
    } catch (err) {
      throw new AggregateError([err], `fyn-central: reading tree file ${treeFile}`);
    }
  }

  /**
   * Save the content dir tree from info to file
   *
   * @param {*} info - info
   * @param {*} path - path to save the file
   */
  async saveInfoTree(info, path) {
    await Fs.writeFile(
      Path.join(path || info.contentPath, "tree.json"),
      JSON.stringify({ $: info.tree, shaSum: info.shaSum, mutates: info.mutates, _: 1 })
    );
  }

  async setMutation(integrity, mutates = true) {
    const info = await this._loadTree(integrity);
    if (!info.exist || !info.tree || info.mutates === mutates) {
      return;
    }
    info.mutates = mutates;
    await this.saveInfoTree(info);
  }

  async replicate(integrity, destDir) {
    try {
      const info = await this.getInfo(integrity);

      const list = flattenTree(info.tree, { dirs: [], files: [] }, "");

      for (const dir of list.dirs) {
        await Fs.$.mkdirp(Path.join(destDir, dir));
      }

      await xaa.map(
        list.files,
        file => {
          const src = Path.join(info.contentPath, "package", file);
          const dest = Path.join(destDir, file);
          // copy package.json because we modify it
          // TODO: don't modify it?
          if (file === "package.json") {
            return copyFile(src, dest);
          }
          return linkFile(src, dest);
        },
        { concurrency: 5 }
      );
    } catch (err) {
      const msg = `fyn-central can't replicate package at ${destDir} for integrity ${integrity}`;
      throw new AggregateError([err], msg);
    }
  }

  _untarStream(tarStream, targetDir) {
    // since we are using objects to store directory tree we have to
    // create objects without the normal prototypes to avoid name conflict
    // with file names
    const newDirObj = () => {
      const n = Object.create(null);
      n["/"] = Object.create(null);
      return n;
    };

    const dirTree = newDirObj();

    const strip = 1;

    const untarStream = Tar.x({
      strip,
      strict: true,
      C: targetDir,
      onentry: entry => {
        const parts = entry.path.split(/\/|\\/);
        const isDir = entry.type === "Directory";
        const dirs = parts.slice(strip, isDir ? parts.length : parts.length - 1);

        const wtree = dirs.reduce((wt, dir) => {
          return wt[dir] || (wt[dir] = newDirObj());
        }, dirTree);

        if (isDir) return;

        const fname = parts[parts.length - 1];
        if (fname) {
          const m = Math.round((entry.mtime ? entry.mtime.getTime() : Date.now()) / 1000);
          wtree["/"][fname] = {
            z: entry.size,
            m,
            $: entry.header.cksumValid && entry.header.cksum
          };
        }
      }
    });

    return missPipe(tarStream, untarStream).then(() => dirTree);
  }

  async _acquireTmpLock(info) {
    const tmpLock = `${info.contentPath}.lock`;

    try {
      await Fs.$.mkdirp(Path.dirname(info.contentPath));
      await Fs.$.acquireLock(tmpLock, {
        wait: 5 * 60 * 1000,
        pollPeriod: 500,
        stale: 5 * 60 * 1000
      });
    } catch (err) {
      logger.error("fyn-central - unable to acquire tmp lock", tmpLock);
      const msg = err.message && err.message.replace(tmpLock, "<lockfile>");
      throw new Error(`Unable to acquire fyn-central tmp lock ${tmpLock} - ${msg}`);
    }

    return tmpLock;
  }

  async _storeTarStream(info, integrity, _stream) {
    let stream = _stream;
    const tmp = `${info.contentPath}.tmp`;

    await Fs.$.rimraf(tmp); // in case there was any remnant left from an interrupted install
    const targetDir = Path.join(tmp, "package");
    await Fs.$.mkdirp(targetDir);
    if (typeof stream === "function") {
      stream = stream();
    }
    if (stream.then) {
      stream = await stream;
    }
    // TODO: user could break during untar and cause corruptted module
    info.tree = await this._untarStream(stream, targetDir, info);
    info.shaSum = await this._calcContentShasum(info, targetDir);
    await this.saveInfoTree(info, tmp);

    await Fs.rename(tmp, info.contentPath);
    info.exist = true;
  }

  /**
   * Validate the central store package content by file size and timestamp
   *
   * @param {*} integrity - package integrity
   *
   * @returns true or false
   */
  async validate(integrity) {
    const info = this._map.get(integrity);
    if (info === undefined || !info.exist) {
      return false;
    }

    if (info.validated === undefined) {
      const sum = await this.getContentShasum(integrity);
      if (!info.shaSum) {
        info.shaSum = sum;
        await this.saveInfoTree(info);
      }
      info.validated = info.shaSum === sum;
    }

    return info.validated;
  }

  async storeTarStream(pkgId, integrity, stream) {
    let tmpLock = false;

    try {
      let info = await this._loadTree(integrity);

      if (info.exist) {
        logger.debug("fyn-central storeTarStream: already exist", info.contentPath);
        if (!info.tree) {
          logger.error(`fyn-central exist package missing tree.json`);
        }
      } else {
        tmpLock = await this._acquireTmpLock(info);
        info = await this._loadTree(integrity, info, true);

        if (info.exist) {
          logger.debug("fyn-central storeTarStream: found after lock acquired", info.contentPath);
          if (!info.tree) {
            const msg = `fyn-central content exist but no tree.json ${info.contentPath}`;
            logger.error(msg);
            throw new Error(msg);
          }
        } else {
          logger.debug("storing tar to central store", pkgId, integrity);
          await this._storeTarStream(info, integrity, stream);
          stream = undefined; // eslint-disable-line
          this._map.set(integrity, info);
          logger.debug("fyn-central storeTarStream: stored", pkgId, info.contentPath);
        }
      }
    } finally {
      if (stream && stream.destroy !== undefined) {
        stream.destroy();
      }

      if (tmpLock) {
        await Fs.$.releaseLock(tmpLock);
      }
    }
  }
}

module.exports = FynCentral;
