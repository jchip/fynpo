"use strict";

const assert = require("assert").strict;
const Fs = require("fs");
const Path = require("path");

const projectedFile = Path.join(
  __dirname,
  "_fyn",
  "@scope",
  "local-export-producer",
  "src",
  "value.js"
);

assert.equal(Fs.readFileSync(projectedFile, "utf8"), "module.exports = \"local source\";\n");
