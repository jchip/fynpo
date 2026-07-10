"use strict";

const { expect } = require("chai");
const PkgInstaller = require("../../lib/pkg-installer");

describe("pkg-installer", function() {
  describe("_removeFailedOptional", function() {
    it("does not mutate the shared request-path arrays", async () => {
      const fyn = {
        _data: {},
        getInstalledPkgDir: () => "/no/such/dir/for-fyn-test"
      };
      const installer = new PkgInstaller({ fyn });
      // avoid touching the dep graph / disk beyond the request-path handling
      installer._removeDepsOf = async () => {};

      const depInfo = {
        name: "foo",
        version: "1.0.0",
        top: false,
        // the failing pkg is itself the opt in its own request path, so the
        // loop short-circuits (id === failedId) without walking the graph
        requests: [["dep;^1.0.0;bar@2.0.0", "opt;^1.0.0;foo@1.0.0"]]
      };
      const before = depInfo.requests.map(r => r.slice());

      await installer._removeFailedOptional(depInfo);

      // request arrays must be left in their original order
      expect(depInfo.requests).to.deep.equal(before);
    });
  });
});
