// @ts-nocheck
"use strict";

/*
 * Dependencies Data
 *
 * Class to contain the all the packages needed after
 * fetching meta data and resolve each package's
 * dependencies.
 *
 * fields:
 *
 * - pkgs - The dependency tree
 * - res - The dependency resolution for top level
 *
 */

const RESOLVED_PKGS = Symbol("resolved packages");

class DepData {
  constructor(_data) {
    const data = _data || {};
    this.pkgs = data.pkgs || {};
    this.badPkgs = {};
    this.res = data.res || {};
    this[RESOLVED_PKGS] = [];
  }

  get resolvedPackages() {
    return this[RESOLVED_PKGS];
  }

  addResolved(info) {
    this[RESOLVED_PKGS].push(info);
  }

  sortPackagesByKeys() {
    const pkgs = this.pkgs;
    this.pkgs = {};
    Object.keys(pkgs)
      .sort()
      .forEach(x => (this.pkgs[x] = pkgs[x]));
  }

  cleanLinked() {
    this.eachVersion(pkg => {
      pkg.linked = 0;
    });
  }

  getPkgsData(bad) {
    return bad ? this.badPkgs : this.pkgs;
  }

  getPkg(item) {
    return this.getPkgsData(item.optFailed)[item.name];
  }

  getPkgById(id) {
    // id is `name@version`; split at the LAST '@' so a scoped name's leading
    // '@' (e.g. "@scope/name@1.2.3") isn't mistaken for the version separator.
    const lastAt = id.lastIndexOf("@");
    const sep = lastAt > 0 ? lastAt : -1;
    const name = sep > 0 ? id.slice(0, sep) : id;
    const version = sep > 0 ? id.slice(sep + 1) : undefined;
    const x = this.getPkgsData()[name];
    return version ? x[version] : x;
  }

  eachVersion(cb) {
    const pkgs = this.pkgs;
    Object.keys(pkgs).forEach(x => {
      const pkg = pkgs[x];
      Object.keys(pkg).forEach(v => {
        cb(pkg[v], v, pkg);
      });
    });
  }
}

module.exports = DepData;
