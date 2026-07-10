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
 * @param {string} semver the parent's requested dependency spec
 * @returns {object} a DepItem
 */
function mkParent(depth, semver = "^1.0.0") {
  return new DepItem(
    { name: "parent", version: "1.0.0", semver, src: "dep", dsrc: "dep", depth },
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

  it("throws on a local dep declared by a non-registry parent", () => {
    const resolver = mkResolver(true);
    const pkg = { name: "parent", version: "1.0.0", dependencies: { payload: "file:./payload" } };
    expect(() =>
      resolver.makePkgDepItems(pkg, mkParent(1, "github:evil/parent"), false, true)
    ).to.throw(/enforceRegistryDeps.*payload.*local dependency.*non-registry source \(github\)/);
  });

  it("rechecks a registry-looking dep after it resolves to local metadata", async () => {
    const resolver = mkResolver(true);
    resolver._fyn.deepResolve = false;
    resolver._fyn.alwaysFetchDist = false;
    resolver._data = { getPkgsData: () => ({}) };
    resolver.addKnownRSemver = () => true;

    const remoteParent = mkParent(1, "github:evil/parent");
    const item = new DepItem(
      { name: "payload", semver: "^1.0.0", src: "dep", dsrc: "dep" },
      remoteParent
    );
    const meta = {
      local: "hard",
      versions: {
        "1.0.0": {
          name: "payload",
          version: "1.0.0",
          local: "hard",
          dist: { fullPath: "/local/payload" }
        }
      }
    };

    let error;
    try {
      await resolver.addPackageResolution(item, meta, "1.0.0");
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.message).to.match(
      /enforceRegistryDeps.*payload.*local dependency.*non-registry source \(github\)/
    );
  });

  it("rechecks local metadata before queueing optional package inspection", async () => {
    const resolver = mkResolver(true);
    resolver._fyn.deepResolve = false;
    resolver._fyn.alwaysFetchDist = false;
    resolver._data = { getPkgsData: () => ({}) };
    resolver.addKnownRSemver = () => true;
    let optionalQueued = false;
    resolver._optResolver = { add: () => (optionalQueued = true) };

    const remoteParent = mkParent(1, "github:evil/parent");
    const item = new DepItem(
      { name: "payload", semver: "^1.0.0", src: "opt", dsrc: "opt" },
      remoteParent
    );
    const meta = {
      local: "hard",
      versions: {
        "1.0.0": {
          name: "payload",
          version: "1.0.0",
          local: "hard",
          scripts: { preinstall: "node payload.js" },
          dist: { fullPath: "/local/payload" }
        }
      }
    };

    let error;
    try {
      await resolver.addPackageResolution(item, meta, "1.0.0");
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.message).to.match(/enforceRegistryDeps.*payload.*local dependency/);
    expect(optionalQueued).to.equal(false);
  });
});
