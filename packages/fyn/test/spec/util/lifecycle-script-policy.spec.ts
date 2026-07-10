"use strict";

const { expect } = require("chai");
const { SEMVER, DEP_ITEM } = require("../../../lib/symbols");
const {
  getUrlType,
  isTrustedScriptSource,
  isTopLevelDep,
  makeAllowKeys,
  evaluateScriptPolicy,
  isScriptAllowed
} = require("../../../lib/util/lifecycle-script-policy");

/**
 * Build a fake resolved-package (depInfo) object.
 *
 * - `spec` is the original requested dependency spec (set on the SEMVER symbol).
 * - when `urlType` is provided it's attached via a fake DepItem on the
 *   DEP_ITEM symbol (primary detection path); otherwise the urlType is derived
 *   by analyzing `spec` (fallback path).
 *
 * @param {object} opts fields to build the fake depInfo from
 * @param {string} [opts.name] package name
 * @param {string} [opts.version] resolved version
 * @param {string} [opts.spec] original requested dependency spec
 * @param {string} [opts.urlType] explicit urlType for the fake DepItem
 * @param {boolean} [opts.depItem] whether to attach a DEP_ITEM symbol
 * @param {boolean} [opts.top] whether the dep was requested by the top-level
 *   package.json (sets `depInfo.top`, as the resolver does)
 * @param {object} [opts.parent] declaring dependency item
 * @returns {object} a fake depInfo carrying the SEMVER/DEP_ITEM symbols
 */
function mkDep({
  name = "foo",
  version = "1.0.0",
  spec,
  urlType,
  depItem = true,
  top,
  parent
} = {}) {
  const depInfo = { name, version };
  if (spec !== undefined) {
    depInfo[SEMVER] = spec;
  }
  if (top !== undefined) {
    depInfo.top = top;
  }
  if (depItem && (urlType !== undefined || spec !== undefined)) {
    depInfo[DEP_ITEM] = { urlType, semver: spec, parent };
  }
  return depInfo;
}

describe("lifecycle-script-policy", function() {
  describe("getUrlType / isTrustedScriptSource", function() {
    it("treats registry semver as trusted (no urlType)", () => {
      const dep = mkDep({ spec: "^1.2.3" });
      expect(getUrlType(dep)).to.equal(undefined);
      expect(isTrustedScriptSource(dep)).to.equal(true);
    });

    it("treats local file: deps as trusted", () => {
      const dep = mkDep({ spec: "file:../bar" });
      expect(getUrlType(dep)).to.equal(undefined);
      expect(isTrustedScriptSource(dep)).to.equal(true);
    });

    it("treats local link: deps as trusted", () => {
      const dep = mkDep({ spec: "link:../bar" });
      expect(isTrustedScriptSource(dep)).to.equal(true);
    });

    it("treats relative path deps as trusted", () => {
      const dep = mkDep({ spec: "../bar" });
      expect(isTrustedScriptSource(dep)).to.equal(true);
    });

    it("treats npm: aliases as trusted (resolves from registry)", () => {
      const dep = mkDep({ spec: "npm:bar@^1.0.0" });
      expect(getUrlType(dep)).to.equal("npm");
      expect(isTrustedScriptSource(dep)).to.equal(true);
    });

    it("treats github: deps as untrusted", () => {
      const dep = mkDep({ spec: "github:user/repo" });
      expect(getUrlType(dep)).to.equal("github");
      expect(isTrustedScriptSource(dep)).to.equal(false);
    });

    it("treats github shorthand (user/repo) as untrusted", () => {
      const dep = mkDep({ spec: "user/repo", depItem: false });
      expect(getUrlType(dep)).to.equal("github");
      expect(isTrustedScriptSource(dep)).to.equal(false);
    });

    it("treats git+https deps as untrusted", () => {
      const dep = mkDep({ urlType: "git+https", spec: "git+https://x.com/a/b.git" });
      expect(isTrustedScriptSource(dep)).to.equal(false);
    });

    it("treats http(s) tarball URLs as untrusted", () => {
      const dep = mkDep({ spec: "https://x.com/a/b-1.0.0.tgz" });
      expect(getUrlType(dep)).to.equal("https");
      expect(isTrustedScriptSource(dep)).to.equal(false);
    });

    it("derives urlType from spec when no DepItem is present", () => {
      const dep = mkDep({ spec: "github:user/repo", depItem: false });
      expect(getUrlType(dep)).to.equal("github");
    });
  });

  describe("makeAllowKeys", function() {
    it("includes both the spec and the resolved version keys", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo#v1" });
      expect(makeAllowKeys(dep)).to.deep.equal(["foo@github:user/foo#v1", "foo@2.3.0"]);
    });

    it("does not duplicate when spec equals version", () => {
      const dep = mkDep({ name: "foo", version: "1.0.0", spec: "1.0.0" });
      expect(makeAllowKeys(dep)).to.deep.equal(["foo@1.0.0"]);
    });
  });

  describe("evaluateScriptPolicy / isScriptAllowed", function() {
    it("allows all scripts for trusted (registry) packages", () => {
      const dep = mkDep({ spec: "^1.0.0" });
      const policy = evaluateScriptPolicy(dep, {});
      expect(policy.trusted).to.equal(true);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
    });

    it("blocks local deps declared by a non-registry parent", () => {
      const parent = { semver: "github:evil/parent", urlType: "github" };
      const dep = mkDep({ spec: "file:./payload", parent });
      const policy = evaluateScriptPolicy(dep, {});
      expect(policy.trusted).to.equal(false);
      expect(policy.urlType).to.equal("github");
      expect(isScriptAllowed(policy, "postinstall")).to.equal(false);
    });

    it("allows local deps declared by a registry parent", () => {
      const parent = { semver: "^1.0.0" };
      const dep = mkDep({ spec: "file:./sibling", parent });
      expect(evaluateScriptPolicy(dep, {}).trusted).to.equal(true);
    });

    it("blocks nested local deps under a non-registry ancestor", () => {
      const remote = { semver: "github:evil/parent", urlType: "github" };
      const local = { semver: "file:./middle", parent: remote };
      const dep = mkDep({ spec: "file:./payload", parent: local });
      expect(evaluateScriptPolicy(dep, {}).trusted).to.equal(false);
    });

    it("blocks all scripts for untrusted packages with no whitelist", () => {
      const dep = mkDep({ spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, {});
      expect(policy.trusted).to.equal(false);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(false);
      expect(isScriptAllowed(policy, "install")).to.equal(false);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(false);
    });

    it("allows whitelisted scripts matched by spec", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, {
        "foo@github:user/foo": ["install", "postinstall"]
      });
      expect(isScriptAllowed(policy, "install")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(false);
    });

    it("allows whitelisted scripts matched by resolved version", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, { "foo@2.3.0": ["install"] });
      expect(isScriptAllowed(policy, "install")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(false);
    });

    it("matches script names case-insensitively", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, { "foo@github:user/foo": ["postInstall"] });
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
    });

    it("supports the wildcard '*' to allow all scripts", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, { "foo@github:user/foo": ["*"] });
      expect(policy.allowAll).to.equal(true);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
    });

    it("supports boolean true to allow all scripts", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, { "foo@github:user/foo": true });
      expect(isScriptAllowed(policy, "install")).to.equal(true);
    });

    it("suggests the spec key for warnings when nothing matched", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo" });
      const policy = evaluateScriptPolicy(dep, {});
      expect(policy.key).to.equal("foo@github:user/foo");
    });

    it("ignores a whitelist for trusted packages (stays trusted)", () => {
      const dep = mkDep({ name: "foo", version: "1.0.0", spec: "^1.0.0" });
      const policy = evaluateScriptPolicy(dep, { "foo@^1.0.0": [] });
      expect(policy.trusted).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
    });
  });

  describe("isTopLevelDep", function() {
    it("is true when depInfo.top is set", () => {
      expect(isTopLevelDep(mkDep({ top: true }))).to.equal(true);
    });

    it("is false when depInfo.top is unset/falsy", () => {
      expect(isTopLevelDep(mkDep({}))).to.equal(false);
      expect(isTopLevelDep(mkDep({ top: false }))).to.equal(false);
      expect(isTopLevelDep(undefined)).to.equal(false);
    });
  });

  describe("evaluateScriptPolicy with allowTopLevelScripts (opt-in)", function() {
    it("reports topLevel on the policy result", () => {
      const top = mkDep({ spec: "github:user/foo", top: true });
      const transitive = mkDep({ spec: "github:user/foo" });
      expect(evaluateScriptPolicy(top, {}).topLevel).to.equal(true);
      expect(evaluateScriptPolicy(transitive, {}).topLevel).to.equal(false);
    });

    it("stays blocked by default (no option) even for top-level deps", () => {
      const dep = mkDep({ spec: "github:user/foo", top: true });
      const policy = evaluateScriptPolicy(dep, {});
      expect(isScriptAllowed(policy, "postinstall")).to.equal(false);
    });

    it("allows all scripts for a top-level dep when allowTopLevel is true", () => {
      const dep = mkDep({ spec: "github:user/foo", top: true });
      const policy = evaluateScriptPolicy(dep, {}, { allowTopLevel: true });
      expect(policy.allowAll).to.equal(true);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
    });

    it("supports the wildcard '*' for allowTopLevel", () => {
      const dep = mkDep({ spec: "github:user/foo", top: true });
      const policy = evaluateScriptPolicy(dep, {}, { allowTopLevel: "*" });
      expect(isScriptAllowed(policy, "install")).to.equal(true);
    });

    it("restricts to listed script names when allowTopLevel is an array", () => {
      const dep = mkDep({ spec: "github:user/foo", top: true });
      const policy = evaluateScriptPolicy(dep, {}, { allowTopLevel: ["postinstall"] });
      expect(policy.allowAll).to.equal(false);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "preinstall")).to.equal(false);
    });

    it("does NOT allow transitive (non-top-level) deps even when allowTopLevel is true", () => {
      const dep = mkDep({ spec: "github:user/foo", top: false });
      const policy = evaluateScriptPolicy(dep, {}, { allowTopLevel: true });
      expect(isScriptAllowed(policy, "postinstall")).to.equal(false);
    });

    it("treats allowTopLevel false/undefined as off", () => {
      const dep = mkDep({ spec: "github:user/foo", top: true });
      expect(isScriptAllowed(evaluateScriptPolicy(dep, {}, { allowTopLevel: false }), "install")).to.equal(false);
      expect(isScriptAllowed(evaluateScriptPolicy(dep, {}, {}), "install")).to.equal(false);
    });

    it("unions allowTopLevel with a per-package allowScripts entry", () => {
      const dep = mkDep({ name: "foo", version: "2.3.0", spec: "github:user/foo", top: true });
      const policy = evaluateScriptPolicy(
        dep,
        { "foo@github:user/foo": ["preinstall"] },
        { allowTopLevel: ["postinstall"] }
      );
      expect(isScriptAllowed(policy, "preinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "postinstall")).to.equal(true);
      expect(isScriptAllowed(policy, "install")).to.equal(false);
    });

    it("does not affect trusted (registry) top-level deps", () => {
      const dep = mkDep({ spec: "^1.0.0", top: true });
      const policy = evaluateScriptPolicy(dep, {}, { allowTopLevel: true });
      expect(policy.trusted).to.equal(true);
      expect(policy.topLevel).to.equal(true);
    });
  });
});
