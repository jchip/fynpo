"use strict";

//
// Unit test for the Fyn `enforceRegistryDeps` getter (FPM-44 default-on).
// Precedence: CLI option (when given) > package.json fyn flag > default (ON).
//

const { expect } = require("chai");
const Fyn = require("../../lib/fyn");

/**
 * Build a bare Fyn with just the fields the getter reads (avoids full construction).
 *
 * @param {object} options the `_options` (CLI-derived) object
 * @param {object} pkg the loaded `_pkg` (consumer package.json), or undefined
 * @returns {object} a Fyn instance
 */
function mkFyn(options, pkg) {
  const fyn = Object.create(Fyn.prototype);
  fyn._options = options || {};
  fyn._pkg = pkg;
  return fyn;
}

describe("Fyn.enforceRegistryDeps", function() {
  it("defaults to ON when neither CLI nor package.json set it", () => {
    expect(mkFyn({}, {}).enforceRegistryDeps).to.equal(true);
  });

  it("defaults to ON when package.json is not loaded yet", () => {
    expect(mkFyn({}, undefined).enforceRegistryDeps).to.equal(true);
  });

  it("is OFF when package.json sets fyn.enforceRegistryDeps:false", () => {
    expect(mkFyn({}, { fyn: { enforceRegistryDeps: false } }).enforceRegistryDeps).to.equal(false);
  });

  it("is ON when package.json sets fyn.enforceRegistryDeps:true", () => {
    expect(mkFyn({}, { fyn: { enforceRegistryDeps: true } }).enforceRegistryDeps).to.equal(true);
  });

  it("CLI option false overrides package.json true", () => {
    const fyn = mkFyn({ enforceRegistryDeps: false }, { fyn: { enforceRegistryDeps: true } });
    expect(fyn.enforceRegistryDeps).to.equal(false);
  });

  it("CLI option true overrides package.json false", () => {
    const fyn = mkFyn({ enforceRegistryDeps: true }, { fyn: { enforceRegistryDeps: false } });
    expect(fyn.enforceRegistryDeps).to.equal(true);
  });
});
