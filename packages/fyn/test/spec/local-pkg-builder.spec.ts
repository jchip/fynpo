"use strict";

const { expect } = require("chai");
const { LocalPkgBuilder } = require("../../lib/local-pkg-builder");

describe("LocalPkgBuilder", function() {
  it("reports local scan failures to item waiters without rejecting start", async () => {
    const error = new Error("scan failed");
    const item = { fullPath: "/missing/local-package" };
    const builder = new LocalPkgBuilder({
      localsByDepth: [[item]],
      fyn: {
        getLocalPkgInstall: async () => {
          throw error;
        }
      }
    });

    await builder.start();
    const result = await builder.waitForItem(item.fullPath);

    expect(result.error).to.equal(error);
  });
});
