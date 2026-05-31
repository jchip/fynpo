"use strict";

const Fs = require("fs");
const Os = require("os");
const Path = require("path");
const expect = require("chai").expect;
const PkgDepLocker = require("../../lib/pkg-dep-locker");

describe("pkg-dep-locker", function() {
  const item = { name: "@anthropic-ai/sdk" };
  const version = "0.52.0";

  const convertTarball = (registry, tarballUrl) => {
    const locker = new PkgDepLocker(false, true, {
      _pkgSrcMgr: {
        getRegistryUrl: () => registry
      }
    });

    locker._lockData = {
      [item.name]: {
        _: {
          "^0.52.0": version
        },
        [version]: {
          $: 0,
          _: tarballUrl
        }
      }
    };

    return locker.convert(item).versions[version].dist.tarball;
  };

  it("should keep a pathful registry tarball URL unchanged", () => {
    const tarballUrl =
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball("https://packages.idme.co/artifactory/api/npm/npm/", tarballUrl)).to.equal(
      tarballUrl
    );
  });

  it("should rewrite a pathful registry tarball URL without duplicating the registry path", () => {
    const currentRegistry = "https://packages.idme.co/artifactory/api/npm/npm/";
    const tarballUrl =
      "https://old-packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball(currentRegistry, tarballUrl)).to.equal(
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz"
    );
  });

  it("should rebuild the tarball URL when the registry base path changes", () => {
    const currentRegistry = "https://packages.idme.co/artifactory/api/npm/npm/";
    const tarballUrl =
      "https://packages.idme.co/repository/npm-private/@anthropic-ai/sdk/-/sdk-0.52.0.tgz";

    expect(convertTarball(currentRegistry, tarballUrl)).to.equal(
      "https://packages.idme.co/artifactory/api/npm/npm/@anthropic-ai/sdk/-/sdk-0.52.0.tgz"
    );
  });

  describe("corrupt lock detection", function() {
    const makeLocker = lockData => {
      const locker = new PkgDepLocker(false, true, {
        _pkgSrcMgr: { getRegistryUrl: () => "https://registry.npmjs.org/" }
      });
      locker._lockData = lockData;
      return locker;
    };

    // a self-contained, consistent lock: react@10.49.0 -> core@10.49.0, and core@10.49.0 exists
    const consistentLock = () => ({
      "@sentry/react": {
        _: { "^10.44.0": "10.49.0" },
        "10.49.0": { $: 0, _: "react.tgz", dependencies: { "@sentry/core": "10.49.0" } }
      },
      "@sentry/core": {
        _: { "10.49.0": "10.49.0" },
        "10.49.0": { $: 0, _: "core.tgz" }
      }
    });

    it("convert() accepts a self-consistent lock entry", () => {
      const locked = makeLocker(consistentLock()).convert({ name: "@sentry/react" });
      expect(locked).to.be.an("object");
      expect(locked.versions).to.have.property("10.49.0");
    });

    it("convert() rejects an entry whose dep pin is unsatisfiable within the lock", () => {
      // the rebase/merge corruption signature: react@10.49.0's deps point at core@10.55.0,
      // but the lock only has core@10.49.0 -> trusting it produces a broken install
      const lock = consistentLock();
      lock["@sentry/react"]["10.49.0"].dependencies["@sentry/core"] = "10.55.0";
      expect(makeLocker(lock).convert({ name: "@sentry/react" })).to.equal(false);
    });

    it("convert() rejects an entry with a non-semver version key", () => {
      const lock = {
        "@sentry/react": {
          _: { "^10.44.0": "[object Promise]" },
          "[object Promise]": { $: 0, _: "react.tgz" }
        }
      };
      expect(makeLocker(lock).convert({ name: "@sentry/react" })).to.equal(false);
    });

    it("read() ignores a lockfile with git conflict markers", async () => {
      const file = Path.join(Os.tmpdir(), `fyn-lock-conflict-${Date.now()}.yaml`);
      Fs.writeFileSync(
        file,
        ["'@sentry/react':", "<<<<<<< HEAD", "  _latest: 10.49.0", "=======", "  _latest: 10.55.0", ">>>>>>> branch", ""].join(
          "\n"
        )
      );
      const locker = new PkgDepLocker(false, true, { _shownMissingFiles: new Set() });
      const ok = await locker.read(file);
      Fs.unlinkSync(file);
      expect(ok).to.equal(false);
      expect(locker._lockData).to.deep.equal({});
    });
  });
});
