"use strict";

const expect = require("chai").expect;
const Semver = require("semver");

describe("overrides", function() {
  describe("_processOverrides", function() {
    // Mock the minimal Fyn interface needed to test _processOverrides
    const createMockFyn = (pkgData) => {
      const fyn = {
        _pkg: pkgData,
        _processOverrides: function(overrides, parentPath = "") {
          const matchers = [];

          for (const key of Object.keys(overrides)) {
            const value = overrides[key];

            // Parse the key which may be "package" or "package@version"
            let pkgName = key;
            let versionConstraint = null;

            const atIdx = key.lastIndexOf("@");
            // Handle scoped packages (@scope/pkg) - @ at position 0 is scope, not version
            if (atIdx > 0) {
              pkgName = key.substring(0, atIdx);
              versionConstraint = key.substring(atIdx + 1);
            }

            if (typeof value === "string") {
              // Simple override or reference ($)
              let resolvedValue = value;

              // Handle $ reference syntax
              if (value.startsWith("$")) {
                const refPkgName = value.substring(1);
                const directDepVersion = this._getDirectDependencyVersion(refPkgName);
                if (directDepVersion) {
                  resolvedValue = directDepVersion;
                }
              }

              matchers.push({
                pkgName,
                versionConstraint,
                parentPath,
                replacement: resolvedValue
              });
            } else if (typeof value === "object" && value !== null) {
              // Nested override
              const newParentPath = parentPath ? `${parentPath}/${pkgName}` : pkgName;
              const nestedMatchers = this._processOverrides(value, newParentPath);
              matchers.push(...nestedMatchers);
            }
          }

          return matchers;
        },
        _getDirectDependencyVersion: function(pkgName) {
          const sections = ["dependencies", "devDependencies", "optionalDependencies"];
          for (const section of sections) {
            const version = this._pkg[section] && this._pkg[section][pkgName];
            if (version) {
              return version;
            }
          }
          return null;
        }
      };
      return fyn;
    };

    it("should parse simple overrides", () => {
      const fyn = createMockFyn({
        dependencies: { lodash: "^4.0.0" },
        overrides: { lodash: "4.17.21" }
      });
      const matchers = fyn._processOverrides({ lodash: "4.17.21" });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("lodash");
      expect(matchers[0].replacement).to.equal("4.17.21");
      expect(matchers[0].versionConstraint).to.be.null;
      expect(matchers[0].parentPath).to.equal("");
    });

    it("should parse overrides with version constraints", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({ "lodash@^4.0.0": "4.17.21" });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("lodash");
      expect(matchers[0].replacement).to.equal("4.17.21");
      expect(matchers[0].versionConstraint).to.equal("^4.0.0");
    });

    it("should parse scoped package overrides", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({ "@scope/pkg": "1.0.0" });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("@scope/pkg");
      expect(matchers[0].replacement).to.equal("1.0.0");
      expect(matchers[0].versionConstraint).to.be.null;
    });

    it("should parse scoped package overrides with version constraints", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({ "@scope/pkg@^1.0.0": "1.2.3" });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("@scope/pkg");
      expect(matchers[0].replacement).to.equal("1.2.3");
      expect(matchers[0].versionConstraint).to.equal("^1.0.0");
    });

    it("should resolve $ references", () => {
      const fyn = createMockFyn({
        dependencies: { "base-pkg": "2.0.0" }
      });
      const matchers = fyn._processOverrides({ lodash: "$base-pkg" });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("lodash");
      expect(matchers[0].replacement).to.equal("2.0.0");
    });

    it("should parse nested overrides", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({
        "parent-pkg": {
          "child-pkg": "1.0.0"
        }
      });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("child-pkg");
      expect(matchers[0].replacement).to.equal("1.0.0");
      expect(matchers[0].parentPath).to.equal("parent-pkg");
    });

    it("should parse deeply nested overrides", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({
        "grandparent": {
          "parent": {
            "child": "1.0.0"
          }
        }
      });
      expect(matchers).to.have.length(1);
      expect(matchers[0].pkgName).to.equal("child");
      expect(matchers[0].replacement).to.equal("1.0.0");
      expect(matchers[0].parentPath).to.equal("grandparent/parent");
    });

    it("should parse multiple overrides at same level", () => {
      const fyn = createMockFyn({});
      const matchers = fyn._processOverrides({
        "pkg-a": "1.0.0",
        "pkg-b": "2.0.0",
        "pkg-c": "3.0.0"
      });
      expect(matchers).to.have.length(3);
      expect(matchers.map(m => m.pkgName)).to.deep.equal(["pkg-a", "pkg-b", "pkg-c"]);
    });
  });

  describe("_matchesVersionConstraint", function() {
    const matchesVersionConstraint = (itemSemver, constraint) => {
      // If the constraint is a specific version, check exact match
      if (Semver.valid(constraint)) {
        return Semver.satisfies(constraint, itemSemver);
      }

      // For range constraints, check intersection
      try {
        return Semver.intersects(itemSemver, constraint);
      } catch {
        return itemSemver === constraint;
      }
    };

    it("should match exact version constraints", () => {
      expect(matchesVersionConstraint("^4.0.0", "4.0.0")).to.be.true;
      expect(matchesVersionConstraint("^4.0.0", "4.17.0")).to.be.true;
      expect(matchesVersionConstraint("^4.0.0", "5.0.0")).to.be.false;
    });

    it("should match range constraints", () => {
      expect(matchesVersionConstraint("^4.17.0", "^4.0.0")).to.be.true;
      expect(matchesVersionConstraint("^5.0.0", "^4.0.0")).to.be.false;
    });

    it("should match tilde constraints", () => {
      expect(matchesVersionConstraint("~4.17.0", "~4.17.0")).to.be.true;
      expect(matchesVersionConstraint("~4.17.5", "~4.17.0")).to.be.true;
    });
  });

  describe("_matchesParentPath", function() {
    const createMockItem = (parentChain) => {
      if (parentChain.length === 0) {
        return { parent: { depth: 0 } };
      }

      // Build chain from first to last - the first element is the root parent
      // So ["grandparent", "parent"] means grandparent -> parent -> item
      // We iterate forward so that the chain ends with the last element
      let item = { parent: { depth: 0 } };
      for (let i = 0; i < parentChain.length; i++) {
        item = {
          name: parentChain[i],
          parent: item,
          depth: i + 1
        };
      }
      return { parent: item };
    };

    const matchesParentPath = (item, parentPath) => {
      if (!item.parent || item.parent.depth === 0) {
        return false;
      }

      const parentChain = [];
      let current = item.parent;
      while (current && current.depth > 0) {
        parentChain.unshift(current.name);
        current = current.parent;
      }

      const pathParts = parentPath.split("/").filter(p => p);

      // Handle scoped packages
      const normalizedParts = [];
      for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i].startsWith("@") && i + 1 < pathParts.length) {
          normalizedParts.push(`${pathParts[i]}/${pathParts[i + 1]}`);
          i++;
        } else {
          normalizedParts.push(pathParts[i]);
        }
      }

      if (normalizedParts.length > parentChain.length) {
        return false;
      }

      const startIdx = parentChain.length - normalizedParts.length;
      for (let i = 0; i < normalizedParts.length; i++) {
        if (parentChain[startIdx + i] !== normalizedParts[i]) {
          return false;
        }
      }

      return true;
    };

    it("should match single parent", () => {
      const item = createMockItem(["parent-pkg"]);
      expect(matchesParentPath(item, "parent-pkg")).to.be.true;
    });

    it("should not match when parent chain is empty", () => {
      const item = createMockItem([]);
      expect(matchesParentPath(item, "parent-pkg")).to.be.false;
    });

    it("should match nested parents", () => {
      const item = createMockItem(["grandparent", "parent"]);
      expect(matchesParentPath(item, "grandparent/parent")).to.be.true;
      expect(matchesParentPath(item, "parent")).to.be.true;
    });

    it("should handle scoped package parents", () => {
      const item = createMockItem(["@scope/parent-pkg"]);
      expect(matchesParentPath(item, "@scope/parent-pkg")).to.be.true;
    });

    it("should not match wrong parent", () => {
      const item = createMockItem(["different-pkg"]);
      expect(matchesParentPath(item, "parent-pkg")).to.be.false;
    });
  });
});
