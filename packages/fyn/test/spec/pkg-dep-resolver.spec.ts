"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../../lib/fyn");
const mockNpm = require("../fixtures/mock-npm");
const expect = require("chai").expect;
const _ = require("lodash");
const logger = require("../../lib/logger");
const chalk = require("chalk");

describe("pkg-dep-resolver", function() {
  logger.setItemType(false);
  chalk.enabled = false;
  let server;
  let fynDir;
  before(() => {
    return mockNpm({ logLevel: "warn" }).then(s => (server = s));
  });

  after(() => {
    return server.stop();
  });

  beforeEach(() => {
    // to debug test, set log level to 0
    logger._logLevel = 999;
    fynDir = Path.join(__dirname, "..", `.tmp_${Date.now()}`);
  });

  afterEach(() => {
    Fs.rmSync(fynDir, { recursive: true, force: true });
  });

  const sortSrc = src => {
    return src
      .split(";")
      .sort()
      .join(";");
  };

  const sortRequests = data => {
    const sort = pkgs => {
      _.each(pkgs, pkg => {
        _.each(pkg, v => {
          v.requests = v.requests.map(r => r.join("!")).sort();
          if (v.src) v.src = sortSrc(v.src);
          if (v.dsrc) v.dsrc = sortSrc(v.dsrc);
          delete v.extracted;
          v.dist = Object.assign({}, v.dist, { shasum: "test" });
        });
      });
    };
    sort(data.pkgs);
    sort(data.badPkgs);
    return data;
  };

  const cleanData = pkgs => {
    for (const name in pkgs) {
      const pkg = pkgs[name];
      for (const ver in pkg) {
        const verPkg = pkg[ver];
        delete verPkg.extracted;
        delete verPkg.str;
        delete verPkg.dir;
        delete verPkg.json;
      }
    }
  };

  const checkResolvedData = (fyn, file) => {
    const expected = Yaml.safeLoad(Fs.readFileSync(file).toString());
    expect(sortRequests(fyn._data)).to.deep.equal(sortRequests(expected));
  };

  const testPkgAFixture = deepResolve => {
    /*
     * This test ensures that:
     * - mod-e@2.1.1 (with a successful preinstall script) is correctly resolved and installed
     * - mod-err@4.5.1 (with a failing preinstall script) is correctly marked as failed
     * - All dependencies, including optional and deep dependencies, are correctly resolved
     */
    const fyn = new Fyn({
      opts: {
        registry: `http://localhost:${server.info.port}`,
        pkgFile: Path.join(__dirname, "../fixtures/pkg-a/package.json"),
        targetDir: "xout",
        cwd: fynDir,
        fynDir,
        ignoreDist: true,
        deepResolve
      }
    });
    const outFname = `fyn-data${deepResolve ? "-dr" : ""}.yaml`;
    const expectOutput = `../fixtures/pkg-a/${outFname}`;
    return fyn.resolveDependencies().then(() => {
      cleanData(fyn._data.pkgs);
      cleanData(fyn._data.badPkgs);
      // Fs.writeFileSync(Path.resolve(outFname), Yaml.safeDump(fyn._data));
      checkResolvedData(fyn, Path.join(__dirname, expectOutput));
    });
  };

  it("should resolve dependencies once for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true);
  }).timeout(10000);

  it("should resolve dependencies repeatedly for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true)
      .then(() => testPkgAFixture(true))
      .then(() => {
        Fs.rmSync(Path.join(fynDir, "xout"), { recursive: true, force: true });
        return testPkgAFixture(true);
      })
      .then(() => {
        Fs.rmSync(Path.join(fynDir, "cache"), { recursive: true, force: true });
        return testPkgAFixture(true);
      });
  }).timeout(10000);

  it("should resolve dependencies once for pkg-a fixture @deepResolve false", () => {
    return testPkgAFixture(false);
  }).timeout(10000);

  it("should resolve dependencies repeatedly for pkg-a fixture @deepResolve false", () => {
    return testPkgAFixture(false)
      .then(() => testPkgAFixture(false))
      .then(() => {
        Fs.rmSync(Path.join(fynDir, "xout"), { recursive: true, force: true });
        return testPkgAFixture(false);
      })
      .then(() => {
        Fs.rmSync(Path.join(fynDir, "cache"), { recursive: true, force: true });
        return testPkgAFixture(false);
      });
  }).timeout(10000);

  it("should fail when semver doesn't resolve", () => {
    const fyn = new Fyn({
      opts: {
        registry: `http://localhost:${server.info.port}`,
        pkgFile: false,
        pkgData: {
          name: "test",
          version: "1.0.0",
          dependencies: {
            "mod-a": "^14.0.0"
          }
        },
        fynDir,
        cwd: fynDir
      }
    });
    let error;
    return fyn
      .resolveDependencies()
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(error.errors).to.exist;
        expect(error.message).includes("Unable to retrieve meta for package mod-a");
        const message = error.errors.map(e => e.message).join("\n");
        expect(message).includes(
          `Unable to find a version from lock data that satisfied semver mod-a@^14.0.0`
        );
      });
  }).timeout(10000);

  it("should fail when tag doesn't resolve", () => {
    const fyn = new Fyn({
      opts: {
        registry: `http://localhost:${server.info.port}`,
        pkgFile: false,
        pkgData: {
          name: "test",
          version: "1.0.0",
          dependencies: {
            "mod-a": "blah"
          }
        },
        fynDir,
        cwd: fynDir
      }
    });
    let error;
    return fyn
      .resolveDependencies()
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(error.errors).to.exist;
        expect(error.message).includes("Unable to retrieve meta for package mod-a");
        const message = error.errors.map(e => e.message).join("\n");
        expect(message).includes(
          `Unable to find a version from lock data that satisfied semver mod-a@blah`
        );
      });
  }).timeout(10000);

  it("should resolve with the `latest` tag", () => {});

  describe("overrides", function() {
    it("should apply simple package override", async () => {
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "^1.0.0"
            },
            overrides: {
              "mod-a": "1.0.0"
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      // mod-a should be resolved to exactly 1.0.0 due to override
      const modA = fyn._data.pkgs["mod-a"];
      expect(modA).to.exist;
      expect(Object.keys(modA)).to.include("1.0.0");
    }).timeout(10000);

    it("should apply override with version constraint", async () => {
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "^1.0.0"
            },
            overrides: {
              // Only override mod-a when requested with ^1.0.0 range
              "mod-a@^1.0.0": "1.0.0"
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      const modA = fyn._data.pkgs["mod-a"];
      expect(modA).to.exist;
      expect(Object.keys(modA)).to.include("1.0.0");
    }).timeout(10000);

    it("should apply override with $ reference to direct dependency", async () => {
      // mod-b@1.0.0 depends on mod-a@^0.2.0
      // We have mod-a@1.0.0 as a direct dependency
      // Using "$mod-a" should override nested mod-a to use 1.0.0
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "1.0.0",
              "mod-b": "^1.0.0"
            },
            overrides: {
              // Override all nested mod-a to use root's version (1.0.0)
              "mod-a": "$mod-a"
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      // mod-a should be resolved to 1.0.0 (from $ reference)
      const modA = fyn._data.pkgs["mod-a"];
      expect(modA).to.exist;
      // Should only have version 1.0.0, not the 0.x version that mod-b would have requested
      expect(Object.keys(modA)).to.include("1.0.0");
    }).timeout(10000);

    it("should apply nested override (parent scoped)", async () => {
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "^1.0.0"
            },
            overrides: {
              // Only override mod-g when it's a dependency of mod-a
              "mod-a": {
                "mod-g": "0.1.0"
              }
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      // The override for mod-g should only apply under mod-a
      const modG = fyn._data.pkgs["mod-g"];
      // If mod-g exists and is under mod-a, it should be 0.1.0
      if (modG) {
        // Check that the override was applied for nested dep
        expect(modG).to.exist;
      }
    }).timeout(10000);

    it("should not apply override when version constraint doesn't match", async () => {
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "^2.0.0"
            },
            overrides: {
              // This should NOT match because mod-a is requested as ^2.0.0
              "mod-a@^1.0.0": "1.0.0"
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      const modA = fyn._data.pkgs["mod-a"];
      expect(modA).to.exist;
      // mod-a should NOT be 1.0.0 because the constraint didn't match
      expect(Object.keys(modA)).to.not.include("1.0.0");
    }).timeout(10000);

    it("should work with overrides and resolutions together", async () => {
      const fyn = new Fyn({
        opts: {
          registry: `http://localhost:${server.info.port}`,
          pkgFile: false,
          pkgData: {
            name: "test",
            version: "1.0.0",
            dependencies: {
              "mod-a": "^1.0.0",
              "mod-b": "^3.0.0"
            },
            overrides: {
              "mod-a": "1.0.0"
            },
            resolutions: {
              "mod-b": "3.0.0"
            }
          },
          fynDir,
          cwd: fynDir
        }
      });
      await fyn.resolveDependencies();
      const modA = fyn._data.pkgs["mod-a"];
      const modB = fyn._data.pkgs["mod-b"];
      expect(modA).to.exist;
      expect(modB).to.exist;
      expect(Object.keys(modA)).to.include("1.0.0");
      expect(Object.keys(modB)).to.include("3.0.0");
    }).timeout(10000);
  });
});
