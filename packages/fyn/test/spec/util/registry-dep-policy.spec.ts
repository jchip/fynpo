"use strict";

const { expect } = require("chai");
const DepItem = require("../../../lib/dep-item");
const {
  isNonRegistryUrlType,
  isValidRegistrySpec,
  violatesRegistryPolicy
} = require("../../../lib/util/registry-dep-policy");

/**
 * Build a real DepItem from a dependency spec - exercises the same
 * `semverUtil.analyze` path the resolver uses, so the policy's `urlType` /
 * `localType` / `semver` reads are validated end-to-end.
 *
 * @param {string} spec the dependency spec
 * @param {string} [name] package name
 * @returns {object} a DepItem
 */
function mkItem(spec, name = "foo") {
  return new DepItem({ name, semver: spec, src: "dep", dsrc: "dep" }, null);
}

describe("registry-dep-policy", function() {
  describe("isNonRegistryUrlType", function() {
    it("flags git/github/url types as non-registry", () => {
      ["github", "git", "git+ssh", "git+https", "git+http", "git+file", "http", "https"].forEach(
        t => {
          expect(isNonRegistryUrlType(t), t).to.equal(true);
        }
      );
    });

    it("treats the npm: alias as registry-backed", () => {
      expect(isNonRegistryUrlType("npm")).to.equal(false);
    });

    it("treats empty/undefined urlType (registry/local) as registry", () => {
      expect(isNonRegistryUrlType(undefined)).to.equal(false);
      expect(isNonRegistryUrlType("")).to.equal(false);
    });
  });

  describe("isValidRegistrySpec", function() {
    it("accepts semver ranges and exact versions", () => {
      ["^1.2.3", "~1.0.0", "1.x", ">=1 <2", "1.2.3", "1.2.3-beta.1"].forEach(s =>
        expect(isValidRegistrySpec(s), s).to.equal(true)
      );
    });

    it("accepts the wildcard and empty spec", () => {
      ["*", "x", "", "   "].forEach(s =>
        expect(isValidRegistrySpec(s), JSON.stringify(s)).to.equal(true)
      );
    });

    it("accepts npm dist-tags", () => {
      ["latest", "next", "beta", "canary-1.2"].forEach(s =>
        expect(isValidRegistrySpec(s), s).to.equal(true)
      );
    });

    it("rejects unparseable garbage", () => {
      ["@@@", "!!nope!!", "->"].forEach(s => expect(isValidRegistrySpec(s), s).to.equal(false));
      expect(isValidRegistrySpec(undefined)).to.equal(false);
      expect(isValidRegistrySpec(null)).to.equal(false);
    });
  });

  describe("violatesRegistryPolicy (plain objects)", function() {
    it("rejects non-registry url sources", () => {
      expect(
        violatesRegistryPolicy({ name: "foo", semver: "github:u/r", urlType: "github" })
      ).to.deep.equal({ kind: "url", urlType: "github" });
    });

    it("accepts the npm: alias", () => {
      expect(
        violatesRegistryPolicy({ name: "foo", semver: "npm:bar@^1", urlType: "npm" })
      ).to.equal(null);
    });

    it("accepts local file/link/sym deps", () => {
      expect(
        violatesRegistryPolicy({ name: "foo", semver: "file:../x", localType: "hard" })
      ).to.equal(null);
      expect(violatesRegistryPolicy({ name: "foo", semver: "../x", localType: "hard" })).to.equal(
        null
      );
      expect(violatesRegistryPolicy({ name: "foo", semver: "x", localType: "sym" })).to.equal(null);
    });

    it("accepts valid registry semver and dist-tags", () => {
      expect(violatesRegistryPolicy({ name: "foo", semver: "^1.0.0" })).to.equal(null);
      expect(violatesRegistryPolicy({ name: "foo", semver: "latest" })).to.equal(null);
    });

    it("rejects an unparseable registry semver", () => {
      expect(violatesRegistryPolicy({ name: "foo", semver: "@@@" })).to.deep.equal({
        kind: "semver",
        semver: "@@@"
      });
    });
  });

  describe("violatesRegistryPolicy (real DepItem instances)", function() {
    it("rejects github shorthand, github:/git/git+*/http(s)", () => {
      [
        "github:user/repo",
        "user/repo",
        "git+https://x.com/a/b.git",
        "git+ssh://git@x.com/a/b.git",
        "git://x.com/a/b.git",
        "https://x.com/a/b-1.0.0.tgz",
        "http://x.com/a/b-1.0.0.tgz"
      ].forEach(spec => {
        const v = violatesRegistryPolicy(mkItem(spec));
        expect(v, spec).to.be.an("object");
        expect(v.kind, spec).to.equal("url");
      });
    });

    it("accepts an npm: alias DepItem", () => {
      expect(violatesRegistryPolicy(mkItem("npm:bar@^1.0.0"))).to.equal(null);
    });

    it("accepts local DepItems (file:/link:/relative)", () => {
      ["file:../bar", "link:../bar", "../bar", "./bar"].forEach(spec =>
        expect(violatesRegistryPolicy(mkItem(spec)), spec).to.equal(null)
      );
    });

    it("accepts registry semver/range/tag DepItems", () => {
      ["^1.2.3", "1.x", "latest", "*"].forEach(spec =>
        expect(violatesRegistryPolicy(mkItem(spec)), spec).to.equal(null)
      );
    });
  });
});
