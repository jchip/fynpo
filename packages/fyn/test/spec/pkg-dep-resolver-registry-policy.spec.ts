"use strict";

//
// Integration test for the fyn.enforceRegistryDeps chokepoint in the resolver
// (FPM-44). Drives the real `makePkgDepItems` with noPrefetch=true so the
// policy guard runs without any network / mock registry: the guard fires before
// prefetchMeta, so a violating transitive dep never needs to resolve.
//

const { expect } = require("chai");
const PkgDepResolver = require("../../lib/pkg-dep-resolver");
const DepItem = require("../../lib/dep-item");

/**
 * Build a minimal resolver carrying only what makePkgDepItems / the guard touch.
 *
 * @param {boolean} enforceRegistryDeps the policy flag
 * @returns {object} a PkgDepResolver with a stub `_fyn`
 */
function mkResolver(enforceRegistryDeps) {
  const resolver = Object.create(PkgDepResolver.prototype);
  resolver._fyn = { enforceRegistryDeps, fynlocal: false, isFynpo: false };
  resolver._options = {};
  return resolver;
}

/**
 * Build a parent dep item at a given depth (0 == the top-level package itself).
 *
 * @param {number} depth the dep depth
 * @returns {object} a DepItem
 */
function mkParent(depth) {
  return new DepItem(
    { name: "parent", version: "1.0.0", semver: "^1.0.0", src: "dep", dsrc: "dep", depth },
    null
  );
}

// a package that declares one transitive github dependency
const pkgWithGitDep = {
  name: "parent",
  version: "1.0.0",
  dependencies: { "evil-dep": "github:evil/repo" }
};

describe("pkg-dep-resolver fyn.enforceRegistryDeps", function() {
  it("throws on a transitive (depth>=1) non-registry dep when enabled", () => {
    const resolver = mkResolver(true);
    expect(() => resolver.makePkgDepItems(pkgWithGitDep, mkParent(1), false, true)).to.throw(
      /enforceRegistryDeps.*evil-dep.*non-registry source \(github\)/
    );
  });

  it("does NOT restrict the top-level package (depth 0) even when enabled", () => {
    const resolver = mkResolver(true);
    let result;
    expect(() => {
      result = resolver.makePkgDepItems(pkgWithGitDep, mkParent(0), false, true);
    }).to.not.throw();
    expect(result.dep.map(it => it.name)).to.include("evil-dep");
  });

  it("does not restrict transitive deps when explicitly disabled", () => {
    const resolver = mkResolver(false);
    let result;
    expect(() => {
      result = resolver.makePkgDepItems(pkgWithGitDep, mkParent(1), false, true);
    }).to.not.throw();
    expect(result.dep.map(it => it.name)).to.include("evil-dep");
  });

  it("allows transitive registry deps (valid semver) when enabled", () => {
    const resolver = mkResolver(true);
    const pkg = { name: "parent", version: "1.0.0", dependencies: { "good-dep": "^1.2.3" } };
    let result;
    expect(() => {
      result = resolver.makePkgDepItems(pkg, mkParent(1), false, true);
    }).to.not.throw();
    expect(result.dep.map(it => it.name)).to.include("good-dep");
  });

  it("throws on a transitive dep with unparseable semver when enabled", () => {
    const resolver = mkResolver(true);
    const pkg = { name: "parent", version: "1.0.0", dependencies: { "bad-sv": "@@@" } };
    expect(() => resolver.makePkgDepItems(pkg, mkParent(1), false, true)).to.throw(
      /enforceRegistryDeps.*bad-sv.*invalid\/unparseable/
    );
  });
});
