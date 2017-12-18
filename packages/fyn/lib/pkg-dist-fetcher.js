"use strict";

/* eslint-disable no-magic-numbers */

const _ = require("lodash");
// const Fs = require("fs");
// const Promise = require("bluebird");
// const Path = require("path");
// const request = require("request");
const logger = require("./logger");
const assert = require("assert");
const PkgDistExtractor = require("./pkg-dist-extractor");
const PromiseQueue = require("./util/promise-queue");
const chalk = require("chalk");
const longPending = require("./long-pending");
const { FETCH_PACKAGE } = require("./log-items");

const WATCH_TIME = 2000;
const MAX_PENDING_SHOW = 10;

class PkgDistFetcher {
  constructor(options) {
    assert(options && options.data, "Must provide options and options.data");
    this._data = options.data;
    this._packages = {};
    this._pkgSrcMgr = options.pkgSrcMgr;
    this._grouping = {
      need: [],
      optional: [],
      byOptionalParent: []
    };
    this._distExtractor = new PkgDistExtractor({ fyn: options.fyn });
    this._fyn = options.fyn;
    this._promiseQ = new PromiseQueue({
      watchTime: WATCH_TIME,
      processItem: x => this.fetchItem(x)
    });
    this._promiseQ.on("watch", items => longPending.onWatch(items));
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("doneItem", x => this.handleItemDone(x));
  }

  wait() {
    return this._promiseQ.wait().then(() =>
      this._distExtractor.wait().then(() => {
        const time = chalk.magenta(`${(Date.now() - this._startTime) / 1000}`);
        logger.info(`${chalk.green("done loading packages")} ${time}secs`);
      })
    );
  }

  start() {
    this._startTime = Date.now();
    _.each(this._data.getPkgsData(), (pkg, name) => {
      _.each(pkg, (vpkg, version) => {
        const id = `${name}@${version}`;
        this._packages[id] = vpkg;
        if (vpkg.dsrc === "opt") {
          // only needed optionally
          return this._grouping.optional.push(id);
        } else if (vpkg.src === "opt") {
          // only needed by a parent that's needed optionally
          return this._grouping.byOptionalParent.push(id);
        } else {
          const byOptionalParent = !vpkg.requests.find(r => !_.last(r).startsWith("opt;"));
          if (byOptionalParent) {
            return this._grouping.byOptionalParent.push(id);
          }
        }
        return this._grouping.need.push(id);
      });
    });
    const itemQ = this._grouping.need // first fetch all the needed deps (dep/dev)
      .concat(this._grouping.optional) // then the optional deps
      .concat(this._grouping.byOptionalParent); // then deps pulled by an opt dep
    this._promiseQ.setItemQ(itemQ);
  }

  done(data) {
    logger.remove(FETCH_PACKAGE);
    const time = chalk.magenta(`${data.totalTime / 1000}`);
    logger.info(`${chalk.green("packages fetched")} (part of loading) ${time}secs`);
  }

  handleItemDone(data) {
    if (!data.error) {
      if (data.res && data.res.fullTgzFile) {
        this._distExtractor.addPkgDist({ pkg: data.res.pkg, fullTgzFile: data.res.fullTgzFile });
      }
    } else {
      logger.error("fetch item failed", data.error);
    }
  }

  fetchItem(item) {
    const pkg = this._packages[item];
    if (pkg.local) {
      return Promise.resolve();
    }

    const pkgName = `${pkg.name}@${pkg.version}`;

    return this._fyn.readPkgJson(pkg).catch(() => {
      return this._pkgSrcMgr
        .fetchTarball(pkg)
        .then(r => {
          return r ? { fullTgzFile: r.fullTgzFile, pkg } : {};
        })
        .catch(err => {
          logger.error(`fetch '${pkgName}' failed`, err);
          throw err;
        });
    });
  }
}

module.exports = PkgDistFetcher;
