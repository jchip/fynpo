"use strict";

const fs = require("fs");
const path = require("path");
const { expect } = require("chai");

const PkgBinLinkerWin32 = require("../../lib/pkg-bin-linker-win32");

describe("pkg-bin-linker-win32", function() {
  const testDir = path.join(__dirname, "../.pkg-bin-linker-win32");
  const binDir = path.join(testDir, "bin");
  const target = path.join(testDir, "packages/g1/node_modules/.bin/foo");

  const cleanup = () => {
    fs.rmSync(testDir, { recursive: true, force: true });
  };

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
  });

  after(() => {
    cleanup();
  });

  it("should create and remove both shim files for explicit bin dirs", async () => {
    const linker = new PkgBinLinkerWin32({ binDir });
    const relTarget = path.relative(binDir, target);

    await linker.linkBinPath(target, "foo");

    expect(fs.readFileSync(path.join(binDir, "foo"), "utf8")).to.include(relTarget);
    expect(fs.readFileSync(path.join(binDir, "foo.cmd"), "utf8")).to.include(relTarget);
    expect(await linker.matchesBinPath("foo", target)).to.equal(true);

    await linker.removeBinLink("foo");

    expect(fs.existsSync(path.join(binDir, "foo"))).to.equal(false);
    expect(fs.existsSync(path.join(binDir, "foo.cmd"))).to.equal(false);
  });

  it("_cleanLink keeps a live bin but removes one whose target is gone", async () => {
    const linker = new PkgBinLinkerWin32({ binDir });

    // live bin: target exists (created in beforeEach)
    await linker.linkBinPath(target, "foo");

    // stale bin: link it, then delete its target package
    const staleTarget = path.join(testDir, "packages/g2/node_modules/.bin/bar");
    fs.mkdirSync(path.dirname(staleTarget), { recursive: true });
    fs.writeFileSync(staleTarget, "");
    await linker.linkBinPath(staleTarget, "bar");
    fs.rmSync(path.join(testDir, "packages/g2"), { recursive: true, force: true });

    // live bin is kept
    expect(await linker._cleanLink("foo")).to.equal(false);
    expect(fs.existsSync(path.join(binDir, "foo.cmd"))).to.equal(true);

    // stale bin is removed (the base Fs.access check would wrongly keep the
    // regular-file wrapper because the wrapper itself still exists)
    expect(await linker._cleanLink("bar")).to.equal(true);
    expect(fs.existsSync(path.join(binDir, "bar"))).to.equal(false);
    expect(fs.existsSync(path.join(binDir, "bar.cmd"))).to.equal(false);
  });
});
