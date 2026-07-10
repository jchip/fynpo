"use strict";

const Path = require("path");
const fs = require("fs");
const os = require("os");
const hardLinkDir = require("../../../lib/util/hard-link-dir");
const Fs = require("opfs");

describe("hard-link-dir", function() {
  it("should hard link a package directory", () => {
    const destPath = Path.join(__dirname, "hard_link_mog_g");
    return Fs.mkdir(destPath)
      .catch(() => {})
      .then(() => {
        return hardLinkDir.link(Path.join(__dirname, "../../fixtures/mod-g"), destPath);
      })
      .finally(() => Fs.$.rimraf(destPath));
  });

  it("links non-JS source maps (.d.ts.map/.css.map) in non-CI mode", async () => {
    // the skip only applies in non-CI mode; force it so the test is deterministic
    const ci = require("ci-info");
    const origIsCI = ci.isCI;
    ci.isCI = false;

    const tmp = fs.mkdtempSync(Path.join(os.tmpdir(), "fyn-hld-"));
    const src = Path.join(tmp, "pkg");
    const dest = Path.join(tmp, "dest");
    const dist = Path.join(src, "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(
      Path.join(src, "package.json"),
      JSON.stringify({ name: "hld-fixture", version: "1.0.0", files: ["dist"] })
    );
    fs.writeFileSync(
      Path.join(dist, "index.js"),
      "module.exports = 1;\n//# sourceMappingURL=index.js.map\n"
    );
    fs.writeFileSync(
      Path.join(dist, "index.js.map"),
      JSON.stringify({ version: 3, file: "index.js", sources: ["../src/index.ts"], mappings: "" })
    );
    fs.writeFileSync(Path.join(dist, "types.d.ts"), "export declare const x: number;\n");
    fs.writeFileSync(
      Path.join(dist, "types.d.ts.map"),
      JSON.stringify({ version: 3, file: "types.d.ts", sources: ["../src/index.ts"], mappings: "" })
    );
    fs.writeFileSync(
      Path.join(dist, "styles.css.map"),
      JSON.stringify({ version: 3, file: "styles.css", sources: ["../src/styles.css"], mappings: "" })
    );

    try {
      await hardLinkDir.link(src, dest);
      // non-JS maps must be present in the linked copy (previously dropped)
      expect(fs.existsSync(Path.join(dest, "dist/types.d.ts.map"))).to.equal(true);
      expect(fs.existsSync(Path.join(dest, "dist/styles.css.map"))).to.equal(true);
      // the .d.ts itself is linked too
      expect(fs.existsSync(Path.join(dest, "dist/types.d.ts"))).to.equal(true);
    } finally {
      ci.isCI = origIsCI;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
