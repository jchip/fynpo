"use strict";

const { expect } = require("chai");
const EventEmitter = require("events");
const PkgDistExtractor = require("../../lib/pkg-dist-extractor");

describe("pkg-dist-extractor", function() {
  it("rejects the listener when extraction fails", async () => {
    const fyn = {
      ensureProperPkgDir: () => Promise.resolve(null),
      getInstalledPkgDir: () => "/no/such/out/dir",
      createPkgOutDir: () => Promise.resolve(),
      // string result -> hardlink path -> central.replicate
      central: { replicate: () => Promise.reject(new Error("replicate boom")) }
    };
    const extractor = new PkgDistExtractor({ fyn });
    const listener = new EventEmitter();

    const settled = new Promise((resolve, reject) => {
      listener.once("fail", err => resolve(err));
      listener.once("done", () => reject(new Error("unexpected done on failure")));
    });

    extractor.addPkgDist({
      pkg: { name: "foo", version: "1.0.0" },
      result: "/some/central/store/path",
      listener
    });

    const err = await settled;
    expect(err).to.be.an("error");
    expect(err.message).to.equal("replicate boom");
  });

  it("resolves the listener when the package is already extracted", async () => {
    const pkgJson = { name: "foo", version: "1.0.0" };
    const fyn = {
      // returns json => already extracted at fullOutDir => early return
      ensureProperPkgDir: () => Promise.resolve(pkgJson),
      getInstalledPkgDir: () => "/already/extracted/dir"
    };
    const extractor = new PkgDistExtractor({ fyn });
    const listener = new EventEmitter();

    const settled = new Promise((resolve, reject) => {
      listener.once("done", json => resolve(json));
      listener.once("fail", err => reject(err || new Error("unexpected fail")));
    });

    extractor.addPkgDist({
      pkg: { name: "foo", version: "1.0.0" },
      result: "/some/central/store/path",
      listener
    });

    const json = await settled;
    expect(json).to.equal(pkgJson);
  });
});
