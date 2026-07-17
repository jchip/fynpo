"use strict";

const Fs = require("fs");
const Path = require("path");
const { assertRemoved } = require("../assertions");

const packageFyn = Path.join(__dirname, "..", "producer", "package-fyn.json");

module.exports = {
  title: "should remove projections disabled by package-fyn.json",
  before() {
    Fs.writeFileSync(packageFyn, `{"fyn":{"localExports":false}}\n`);
  },
  verify(cwd) {
    assertRemoved(cwd);
  },
  after() {
    Fs.rmSync(packageFyn, { force: true });
  }
};
