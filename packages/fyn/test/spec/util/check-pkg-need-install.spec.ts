"use strict";

const { expect } = require("chai");
const os = require("os");
const path = require("path");
const logger = require("../../../lib/logger");
const { checkPkgNeedInstall } = require("../../../lib/util/check-pkg-need-install");

describe("check-pkg-need-install", function() {
  it("warns and rejects when a local dep can't be read", async () => {
    const origWarn = logger.warn;
    const warnings = [];
    logger.warn = (...args) => warnings.push(args.join(" "));

    try {
      const missingDir = path.join(os.tmpdir(), `fyn-no-such-pkg-${Date.now()}`);
      let error;
      try {
        await checkPkgNeedInstall(missingDir, 1);
      } catch (err) {
        error = err;
      }

      expect(error).to.exist;
      expect(warnings.some(w => w.includes(missingDir))).to.equal(true);
    } finally {
      logger.warn = origWarn;
    }
  });
});
