"use strict";

const { expect } = require("chai");
const { getRunExitCode, pickEnvOptions } = require("../../cli/main");

describe("cli/main", function() {
  describe("getRunExitCode", function() {
    it("prefers the child exit code over errno", () => {
      expect(getRunExitCode({ code: 5, errno: -2 })).to.equal(5);
    });
  });

  describe("pickEnvOptions", function() {
    let saved;

    beforeEach(() => {
      saved = process.env.NODE_ENV;
    });

    afterEach(() => {
      if (saved === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = saved;
      }
    });

    it("sets production true when NODE_ENV=production", () => {
      process.env.NODE_ENV = "production";
      expect(pickEnvOptions()).to.deep.equal({ production: true });
    });

    it("sets production false when NODE_ENV is another value", () => {
      process.env.NODE_ENV = "development";
      expect(pickEnvOptions()).to.deep.equal({ production: false });
    });

    it("returns empty object when NODE_ENV is not set", () => {
      delete process.env.NODE_ENV;
      expect(pickEnvOptions()).to.deep.equal({});
    });
  });
});
