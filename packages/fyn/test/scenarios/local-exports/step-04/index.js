"use strict";

const { assertRemoved } = require("../assertions");

module.exports = {
  title: "should remove projections when the local dependency is removed",
  verify(cwd) {
    assertRemoved(cwd);
  }
};
