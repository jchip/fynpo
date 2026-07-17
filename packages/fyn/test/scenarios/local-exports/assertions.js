"use strict";

const assert = require("assert").strict;
const Fs = require("fs");
const Path = require("path");

const PACKAGE_PATH = Path.join("@scope", "local-export-producer");

function projectionDir(cwd) {
  return Path.join(cwd, "_fyn", PACKAGE_PATH, "src");
}

function producerDir(scenarioDir) {
  return Path.join(scenarioDir, "producer", "src");
}

function assertProjected(cwd, scenarioDir) {
  const installedSrc = Path.join(cwd, "node_modules", PACKAGE_PATH, "src");
  const projectedSrc = projectionDir(cwd);

  assert.equal(Fs.existsSync(installedSrc), false, "normal install should exclude src");
  assert.equal(Fs.lstatSync(projectedSrc).isSymbolicLink(), true, "projection should be a link");
  assert.equal(
    Fs.realpathSync(projectedSrc),
    Fs.realpathSync(producerDir(scenarioDir)),
    "projection should target the producer source"
  );
  assert.equal(
    Fs.readFileSync(Path.join(projectedSrc, "value.js"), "utf8"),
    `module.exports = "local source";\n`
  );
}

function assertRemoved(cwd) {
  assert.equal(Fs.existsSync(Path.join(cwd, "_fyn")), false, "managed _fyn tree should be removed");
}

module.exports = { assertProjected, assertRemoved, projectionDir };
