"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../../lib/fyn");
const mockNpm = require("../fixtures/mock-npm");
const expect = require("chai").expect;
const _ = require("lodash");
const rimraf = require("rimraf");
const logger = require("../../lib/logger");
const chalk = require("chalk");
const pacote = require("pacote");

describe("pkg-dep-resolver", function() {
  logger.setItemType(false);
  chalk.enabled = false;
  let server;
  let fynDir;
  let registryUrl;

  before(() => {
    return mockNpm({ logLevel: "warn" }).then(s => {
      server = s;
      registryUrl = `http://localhost:${server.info.port}`;
    });
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
    rimraf.sync(fynDir);
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
    const actual = JSON.parse(JSON.stringify(fyn._data));
    expect(sortRequests(actual)).to.deep.equal(sortRequests(expected));
  };

  const testPkgFixture = opts => {
    const { pkgDir, deepResolve } = opts;
    const fyn = new Fyn({
      opts: {
        registry: registryUrl,
        pkgFile: Path.join(__dirname, `../fixtures/${pkgDir}/package.json`),
        targetDir: "xout",
        cwd: fynDir,
        fynDir,
        ignoreDist: true,
        deepResolve
      }
    });
    const outFname = `fyn-data${deepResolve ? "-dr" : ""}.yaml`;
    const expectOutput = `../fixtures/${pkgDir}/${outFname}`;
    return fyn.resolveDependencies().then(() => {
      cleanData(fyn._data.pkgs);
      cleanData(fyn._data.badPkgs);
      // Fs.writeFileSync(Path.resolve(outFname), Yaml.safeDump(fyn._data));
      checkResolvedData(fyn, Path.join(__dirname, expectOutput));
    });
  };

  const testPkgAFixture = deepResolve => testPkgFixture({ pkgDir: "pkg-a", deepResolve });

  it("should use pacote to retrieve packument", () => {
    return pacote
      .packument("mod-a", {
        registry: `http://localhost:${server.info.port}`
      })
      .then(x => {
        expect(x).to.exist;
        expect(x.name).to.equal("mod-a");
        expect(x.versions).to.exist;
        expect(x.versions["0.1.0"]).to.exist;
        expect(x.versions["0.1.0"].dist).to.exist;
        expect(x.versions["0.1.0"].dist.tarball).to.exist;
        expect(x.readme).to.exist;
        expect(x.readme).to.equal("#mod-a\n");
        expect(x._attachments).to.exist;
      });
  });

  it("should resolve optional dependencies for pkg-b fixture", () => {
    return testPkgFixture({ pkgDir: "pkg-b", deepResolve: false });
  });

  it("should resolve dependencies once for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true);
  });

  it("should resolve dependencies repeatedly for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true)
      .then(() => testPkgAFixture(true))
      .then(() => {
        rimraf.sync(Path.join(fynDir, "xout"));
        return testPkgAFixture(true);
      })
      .then(() => {
        rimraf.sync(Path.join(fynDir, "cache"));
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
        rimraf.sync(Path.join(fynDir, "xout"));
        return testPkgAFixture(false);
      })
      .then(() => {
        rimraf.sync(Path.join(fynDir, "cache"));
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
});
