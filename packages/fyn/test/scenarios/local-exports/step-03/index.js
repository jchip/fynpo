"use strict";

const { assertProjected } = require("../assertions");

module.exports = {
  title: "should recreate projections when the declaration is restored",
  verify(cwd, scenarioDir) {
    assertProjected(cwd, scenarioDir);
  }
};
