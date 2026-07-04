"use strict";

//
// Unit test for the lifecycle-script policy chokepoint in the optional-dep
// resolver (FPM-47). A non-registry (github/git/url) optional dep's preinstall
// must not run by default - the same deny-by-default policy the regular
// installer enforces (FPM-41). Drives the real `checkPreinstallPolicy` with a
// stub `_fyn`, so no network / extraction / script execution is needed.
//

const { expect } = require("chai");
const PkgOptResolver = require("../../lib/pkg-opt-resolver");
const DepItem = require("../../lib/dep-item");

/**
 * Build a minimal opt-resolver carrying only what checkPreinstallPolicy touches.
 *
 * @param {object} [fyn] stub fields for `this._fyn`
 * @param {object} [fyn.allowScripts] the fyn.allowScripts whitelist
 * @param {boolean} [fyn.allowTopLevelScripts] the fyn.allowTopLevelScripts flag
 * @returns {object} a PkgOptResolver with a stub `_fyn`
 */
function mkResolver({ allowScripts = {}, allowTopLevelScripts = false } = {}) {
  const resolver = Object.create(PkgOptResolver.prototype);
  resolver._fyn = { allowScripts, allowTopLevelScripts };
  return resolver;
}

/**
 * Build an optional dep item whose parent sits at `parentDepth`
 * (0 == requested by the top-level package.json).
 *
 * @param {string} spec the requested dependency spec
 * @param {number} parentDepth depth of the parent dep item
 * @returns {object} a DepItem
 */
function mkItem(spec, parentDepth) {
  const parent = new DepItem(
    { name: "parent", version: "1.0.0", semver: "^1.0.0", src: "dep", dsrc: "dep", depth: parentDepth },
    null
  );
  return new DepItem({ name: "opt-pkg", semver: spec, src: "opt", dsrc: "opt" }, parent);
}

describe("pkg-opt-resolver preinstall script policy", function() {
  it("blocks preinstall for a transitive non-registry (github) optional dep", () => {
    const resolver = mkResolver();
    const { allowed, policy } = resolver.checkPreinstallPolicy(
      mkItem("github:evil/repo", 1),
      "opt-pkg",
      "1.0.0"
    );
    expect(allowed).to.equal(false);
    expect(policy.trusted).to.equal(false);
    expect(policy.urlType).to.equal("github");
  });

  it("allows preinstall for a registry (semver) optional dep", () => {
    const resolver = mkResolver();
    const { allowed, policy } = resolver.checkPreinstallPolicy(
      mkItem("^1.2.3", 1),
      "opt-pkg",
      "1.0.0"
    );
    expect(allowed).to.equal(true);
    expect(policy.trusted).to.equal(true);
  });

  it("allows a non-registry optional dep explicitly whitelisted in fyn.allowScripts", () => {
    const resolver = mkResolver({ allowScripts: { "opt-pkg@1.0.0": ["preinstall"] } });
    const { allowed } = resolver.checkPreinstallPolicy(
      mkItem("github:evil/repo", 1),
      "opt-pkg",
      "1.0.0"
    );
    expect(allowed).to.equal(true);
  });

  it("allows a top-level non-registry optional dep when fyn.allowTopLevelScripts is on", () => {
    const resolver = mkResolver({ allowTopLevelScripts: true });
    const { allowed } = resolver.checkPreinstallPolicy(
      mkItem("github:evil/repo", 0),
      "opt-pkg",
      "1.0.0"
    );
    expect(allowed).to.equal(true);
  });

  it("still blocks a transitive non-registry optional dep when allowTopLevelScripts is on", () => {
    const resolver = mkResolver({ allowTopLevelScripts: true });
    const { allowed } = resolver.checkPreinstallPolicy(
      mkItem("github:evil/repo", 1),
      "opt-pkg",
      "1.0.0"
    );
    expect(allowed).to.equal(false);
  });
});
