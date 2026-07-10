"use strict";

const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Fyn = require("../../lib/fyn");

describe("fyn install-config layout", function() {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fyn-layout-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("forces layout to the one an existing install's .fyn.json recorded", async () => {
    // simulate an existing install whose node_modules was built with "detail"
    const fvDir = path.join(cwd, "xout", ".f");
    fs.mkdirSync(fvDir, { recursive: true });
    fs.writeFileSync(path.join(fvDir, ".fyn.json"), JSON.stringify({ layout: "detail" }));

    const fyn = new Fyn({
      opts: {
        registry: "http://localhost/",
        pkgFile: false,
        pkgData: { name: "t", version: "1.0.0" },
        targetDir: "xout",
        cwd,
        fynDir: path.join(cwd, ".fyn"),
        layout: "normal"
      }
    });

    await fyn._initializePkg();

    // _options.layout is the source of truth read by isNormalLayout at runtime;
    // it must be forced to the existing install's layout (was a no-op before).
    expect(fyn._options.layout).to.equal("detail");
    expect(fyn.isNormalLayout).to.equal(false);
  });
});

describe("fyn createPkgOutDir", function() {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fyn-outdir-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("clears a pre-existing package dir (reinstall) but keeps it existing", async () => {
    const fyn = new Fyn({
      opts: {
        pkgFile: false,
        pkgData: { name: "t", version: "1.0.0" },
        targetDir: "node_modules",
        cwd,
        fynDir: path.join(cwd, ".fyn")
      }
    });

    const dir = path.join(cwd, "node_modules", ".f", "_", "foo", "1.0.0", "foo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "stale.js"), "old content");

    await fyn.createPkgOutDir(dir);

    // stale content from the previous install must be gone; the dir remains
    expect(fs.existsSync(path.join(dir, "stale.js"))).to.equal(false);
    expect(fs.existsSync(dir)).to.equal(true);
  });

  it("does not clear when keep is set", async () => {
    const fyn = new Fyn({
      opts: {
        pkgFile: false,
        pkgData: { name: "t", version: "1.0.0" },
        targetDir: "node_modules",
        cwd,
        fynDir: path.join(cwd, ".fyn")
      }
    });

    const dir = path.join(cwd, "node_modules", ".f", "_", "bar", "1.0.0", "bar");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "keep.js"), "keep me");

    await fyn.createPkgOutDir(dir, true);

    expect(fs.existsSync(path.join(dir, "keep.js"))).to.equal(true);
  });
});
