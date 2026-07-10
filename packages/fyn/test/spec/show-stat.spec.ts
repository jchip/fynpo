"use strict";

const { expect } = require("chai");
const showStat = require("../../cli/show-stat");

describe("showStat", function() {
  it("propagates dependency resolution failures", async () => {
    const error = new Error("resolution failed");
    const fyn = {
      _options: {},
      resolveDependencies: async () => {
        throw error;
      }
    };

    let caught;
    try {
      await showStat(fyn, ["pkg"]);
    } catch (err) {
      caught = err;
    }

    expect(caught).to.equal(error);
  });
});
