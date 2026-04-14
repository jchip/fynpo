"use strict";

const fs = require("fs");
const path = require("path");
const mockRequire = require("mock-require");

describe("fyn-global", function() {
  const globalDir = path.join(__dirname, "../.fyn-global");
  const fynGlobalPath = require.resolve("../../lib/fyn-global");
  const pkgBinLinkerPath = require.resolve("../../lib/pkg-bin-linker");
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

    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
    mockRequire(pkgBinLinkerPath, FakePkgBinLinker);
    FynGlobal = require(fynGlobalPath);
  });

  afterEach(() => {
    mockRequire.stopAll();
    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
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
});
