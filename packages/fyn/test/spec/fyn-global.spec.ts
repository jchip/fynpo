"use strict";

const fs = require("fs");
const path = require("path");
const mockRequire = require("mock-require");

describe("fyn-global", function() {
  const globalDir = path.join(__dirname, "../.fyn-global");
  const fynGlobalPath = require.resolve("../../lib/fyn-global");
  const pkgBinLinkerPath = require.resolve("../../lib/pkg-bin-linker");
  const fynPath = require.resolve("../../lib/fyn");
  const cleanup = () => {
    fs.rmSync(globalDir, { recursive: true, force: true });
  };

  let calls;
  let FynGlobal;

  beforeEach(() => {
    cleanup();
    calls = [];

    class FakePkgBinLinker {
      constructor(options) {
        calls.push({ type: "construct", options });
      }

      async hasBinLink(binName) {
        calls.push({ type: "has", binName });
        return false;
      }

      async linkBinPath(target, binName, options) {
        calls.push({ type: "link", target, binName, options });
      }

      async matchesBinPath(binName, target) {
        calls.push({ type: "match", binName, target });
        return true;
      }

      async removeBinLink(binName) {
        calls.push({ type: "remove", binName });
      }
    }

    class FakeFyn {
      constructor(config) {
        calls.push({ type: "fyn", opts: config.opts });
      }
    }

    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
    delete require.cache[fynPath];
    mockRequire(pkgBinLinkerPath, FakePkgBinLinker);
    mockRequire(fynPath, FakeFyn);
    FynGlobal = require(fynGlobalPath);
  });

  afterEach(() => {
    mockRequire.stopAll();
    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
    delete require.cache[fynPath];
    cleanup();
  });

  it("should link global bins through the shared linker", async () => {
    const fynGlobal = new FynGlobal({ globalDir, nodeVersion: "20" });
    const target = path.join(globalDir, "v20/packages/g1/node_modules/.bin/foo");

    await fynGlobal.linkBins("g1", { foo: target }, true);

    expect(calls).to.deep.include({
      type: "construct",
      options: { binDir: path.join(globalDir, "v20", "bin") }
    });
    expect(calls).to.deep.include({
      type: "link",
      target,
      binName: "foo",
      options: { overwrite: true }
    });
  });

  it("should unlink global bins through the shared linker", async () => {
    const fynGlobal = new FynGlobal({ globalDir, nodeVersion: "20" });

    await fynGlobal.writeInstalledJson({
      packages: {
        foo: {
          versions: [{ version: "1.0.0", dir: "g1", bins: ["foo"], linked: true }]
        }
      }
    });

    await fynGlobal.unlinkBinsForVersion("foo", "1.0.0");

    expect(calls).to.deep.include({
      type: "match",
      binName: "foo",
      target: path.join(globalDir, "v20/packages/g1/node_modules/.bin/foo")
    });
    expect(calls).to.deep.include({ type: "remove", binName: "foo" });
  });

  it("should propagate CLI fynOpts into the Fyn instance it creates", () => {
    const fynGlobal = new FynGlobal({
      globalDir,
      nodeVersion: "20",
      fynOpts: { refreshMeta: true, production: true }
    });

    fynGlobal._createFyn(globalDir, false);

    const fynCall = calls.find(c => c.type === "fyn");
    expect(fynCall).to.exist;
    expect(fynCall.opts.refreshMeta).to.equal(true);
    expect(fynCall.opts.production).to.equal(true);
  });

  it("should override global-install settings even if fynOpts sets them", () => {
    const fynGlobal = new FynGlobal({
      globalDir,
      nodeVersion: "20",
      fynOpts: { centralStore: false, lockfile: false, layout: "detail" }
    });

    fynGlobal._createFyn(globalDir, false);

    const fynCall = calls.find(c => c.type === "fyn");
    expect(fynCall.opts.centralStore).to.equal(true);
    expect(fynCall.opts.lockfile).to.equal(true);
    expect(fynCall.opts.layout).to.equal("normal");
  });
});
