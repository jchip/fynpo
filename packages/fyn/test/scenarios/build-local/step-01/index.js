"use strict";

const Path = require("path");
const Fs = require("opfs");
const nodeFs = require("fs");

module.exports = {
  title: "should run build on a local dep",
  buildLocal: true,
  async before() {
    const e1Dir = Path.join(__dirname, "../../../fixtures/e1");
    const fileName = Path.join(e1Dir, "package.json");
    const pkg = JSON.parse(await Fs.readFile(fileName));
    pkg.scripts.install = "node index.js hello.js";
    await Fs.writeFile(fileName, JSON.stringify(pkg, null, 2));
    nodeFs.rmSync(Path.join(e1Dir, "dist"), { recursive: true, force: true });
  }
};
