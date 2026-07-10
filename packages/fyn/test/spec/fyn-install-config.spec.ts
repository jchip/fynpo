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
