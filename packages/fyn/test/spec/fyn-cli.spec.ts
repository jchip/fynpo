"use strict";

const { expect } = require("chai");
const FynCli = require("../../cli/fyn-cli");
const fyntil = require("../../lib/util/fyntil");

describe("FynCli", function() {
  describe("run --list", function() {
    it("does not exit successfully when loading the package fails", async () => {
      const error = new Error("load failed");
      const cli = Object.create(FynCli.prototype);
      cli._config = { _fynpo: {} };
      cli._fyn = {
        loadPkg: async () => {
          throw error;
        }
      };

      const savedExit = fyntil.exit;
      const exits = [];
      fyntil.exit = code => exits.push(code);

      try {
        let caught;
        try {
          await cli.run({ opts: { list: true }, args: {} });
        } catch (err) {
          caught = err;
        }

        expect(caught).to.equal(error);
        expect(exits).to.deep.equal([]);
      } finally {
        fyntil.exit = savedExit;
      }
    });
  });
});
