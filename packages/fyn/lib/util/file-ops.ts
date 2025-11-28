// @ts-nocheck
"use strict";

const Promise = require("./aveazul");
const opfs = require("opfs");
const lockfile = require("lockfile");
const win32Opfs = require("./file-ops-win32");
const fs = require("fs");

opfs._opfsSetPromise(Promise);

opfs.$.acquireLock = Promise.promisify(lockfile.lock, { context: lockfile });
opfs.$.releaseLock = Promise.promisify(lockfile.unlock, { context: lockfile });

// Add rimraf implementation using fs.rm (Node.js 14.14+)
// Replace the opfs rimraf wrapper with native fs.rm
opfs.$.rimraf = async (path) => {
  return fs.promises.rm(path, { recursive: true, force: true });
};

// Add mkdirp implementation using fs.mkdirSync (Node.js 10.12+)
// Replace the opfs mkdirp wrapper with native fs.mkdirSync
opfs.$.mkdirp = (path) => {
  return fs.mkdirSync(path, { recursive: true });
};

module.exports = win32Opfs(opfs);