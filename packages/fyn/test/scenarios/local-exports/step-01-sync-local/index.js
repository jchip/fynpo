"use strict";

const Fs = require("fs");
const Path = require("path");
const { assertProjected } = require("../assertions");

module.exports = {
  title: "should repair a deleted projection with sync-local",
  before(cwd) {
    Fs.rmSync(Path.join(cwd, "_fyn"), { recursive: true, force: true });
  },
  getArgs({ baseArgs, cwd }) {
    return baseArgs.concat(`--cwd=${cwd}`, "sync-local");
  },
  verify(cwd, scenarioDir) {
    assertProjected(cwd, scenarioDir);
  }
};
