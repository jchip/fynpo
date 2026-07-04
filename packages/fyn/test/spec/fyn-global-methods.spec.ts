"use strict";

const fs = require("fs");
const path = require("path");
const mockRequire = require("mock-require");

/**
 * Exercises the registry, spec-parsing, and filesystem methods of FynGlobal that
 * do not require the network (install/update/fetch are covered elsewhere / need a
 * registry). Uses a throwaway global dir and mocks the bin linker + Fyn class.
 */
describe("fyn-global methods", function() {
  const globalDir = path.join(__dirname, "../.fyn-global-methods");
  const versionDir = path.join(globalDir, "v20");
  const packagesDir = path.join(versionDir, "packages");
  const fynGlobalPath = require.resolve("../../lib/fyn-global");
  const pkgBinLinkerPath = require.resolve("../../lib/pkg-bin-linker");
  const fynPath = require.resolve("../../lib/fyn");

  const cleanup = () => {
    fs.rmSync(globalDir, { recursive: true, force: true });
  };

  let calls;
  let FynGlobal;

  const makeGlobal = (options = {}) => new FynGlobal({ globalDir, nodeVersion: "20", ...options });

  beforeEach(() => {
    cleanup();
    calls = [];

    class FakePkgBinLinker {
      constructor(options) {
        calls.push({ type: "construct", options });
      }
      async hasBinLink(binName) {
        calls.push({ type: "has", binName });
        return false;
      }
      async linkBinPath(target, binName, options) {
        calls.push({ type: "link", target, binName, options });
      }
      async matchesBinPath(binName, target) {
        calls.push({ type: "match", binName, target });
        return true;
      }
      async removeBinLink(binName) {
        calls.push({ type: "remove", binName });
      }
    }

    class FakeFyn {
      constructor(config) {
        calls.push({ type: "fyn", opts: config.opts });
      }
    }

    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
    delete require.cache[fynPath];
    mockRequire(pkgBinLinkerPath, FakePkgBinLinker);
    mockRequire(fynPath, FakeFyn);
    FynGlobal = require(fynGlobalPath);
  });

  afterEach(() => {
    mockRequire.stopAll();
    delete require.cache[fynGlobalPath];
    delete require.cache[pkgBinLinkerPath];
    delete require.cache[fynPath];
    cleanup();
  });

  describe("constructor", () => {
    it("derives the version paths from globalDir + nodeVersion", () => {
      const g = makeGlobal();
      expect(g.globalRoot).to.equal(globalDir);
      expect(g.versionDir).to.equal(versionDir);
      expect(g.packagesDir).to.equal(packagesDir);
      expect(g.installedJsonPath).to.equal(path.join(versionDir, "installed.json"));
      expect(g.runtimePrefix).to.equal("v");
      expect(g.interactive).to.equal(true);
      expect(g.yes).to.equal(false);
      expect(g.tag).to.equal(null);
    });

    it("honors interactive:false, yes:true and tag options", () => {
      const g = makeGlobal({ interactive: false, yes: true, tag: "g3" });
      expect(g.interactive).to.equal(false);
      expect(g.yes).to.equal(true);
      expect(g.tag).to.equal("g3");
    });
  });

  describe("_getVersionBinTargets", () => {
    it("maps declared bins to paths under the package .bin dir", () => {
      const g = makeGlobal();
      const bins = g._getVersionBinTargets({ dir: "g1", bins: ["foo", "bar"] });
      expect(bins.foo).to.equal(path.join(packagesDir, "g1", "node_modules", ".bin", "foo"));
      expect(bins.bar).to.equal(path.join(packagesDir, "g1", "node_modules", ".bin", "bar"));
    });

    it("returns an empty map when there are no bins", () => {
      const g = makeGlobal();
      expect(g._getVersionBinTargets({ dir: "g1" })).to.deep.equal({});
    });
  });

  describe("isLocalSpec", () => {
    it("detects local specs", () => {
      const g = makeGlobal();
      expect(g.isLocalSpec("file:../foo")).to.equal(true);
      expect(g.isLocalSpec("/abs/path")).to.equal(true);
      expect(g.isLocalSpec("./rel")).to.equal(true);
      expect(g.isLocalSpec("../rel")).to.equal(true);
      expect(g.isLocalSpec("some/dir")).to.equal(true);
    });

    it("treats registry names (incl. scoped) as non-local", () => {
      const g = makeGlobal();
      expect(g.isLocalSpec("lodash")).to.equal(false);
      expect(g.isLocalSpec("lodash@4.0.0")).to.equal(false);
      expect(g.isLocalSpec("@scope/name")).to.equal(false);
    });
  });

  describe("parsePackageName", () => {
    it("strips version and npm: alias for registry specs", async () => {
      const g = makeGlobal();
      expect(await g.parsePackageName("lodash@4.17.21")).to.equal("lodash");
      expect(await g.parsePackageName("lodash")).to.equal("lodash");
      expect(await g.parsePackageName("@scope/name@1.0.0")).to.equal("@scope/name");
      expect(await g.parsePackageName("npm:lodash@4.0.0")).to.equal("lodash");
    });

    it("reads name from package.json for a local spec", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(globalDir, "localpkg");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "my-local" }));
      expect(await g.parsePackageName(`file:${pkgDir}`)).to.equal("my-local");
    });

    it("throws a helpful error when a local package.json is missing", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(globalDir, "no-pkg-here");
      let error;
      try {
        await g.parsePackageName(`file:${pkgDir}`);
      } catch (err) {
        error = err;
      }
      expect(error).to.exist;
      expect(error.message).to.contain("Cannot read package.json");
    });
  });

  describe("installed.json registry", () => {
    it("readInstalledJson returns an empty registry when the file is absent", async () => {
      const g = makeGlobal();
      expect(await g.readInstalledJson()).to.deep.equal({ packages: {} });
    });

    it("writeInstalledJson creates the version dir and round-trips", async () => {
      const g = makeGlobal();
      const registry = { packages: { foo: { versions: [{ version: "1.0.0", dir: "g1" }] } } };
      await g.writeInstalledJson(registry);
      expect(fs.existsSync(g.installedJsonPath)).to.equal(true);
      expect(await g.readInstalledJson()).to.deep.equal(registry);
    });

    it("getPackageVersions returns [] for unknown and the versions for known", async () => {
      const g = makeGlobal();
      expect(await g.getPackageVersions("nope")).to.deep.equal([]);
      await g.writeInstalledJson({ packages: { foo: { versions: [{ version: "1.0.0", dir: "g1" }] } } });
      expect(await g.getPackageVersions("foo")).to.have.length(1);
    });

    it("getLinkedVersion returns the linked version or null", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", linked: false },
              { version: "2.0.0", dir: "g2", linked: true }
            ]
          }
        }
      });
      expect((await g.getLinkedVersion("foo")).version).to.equal("2.0.0");
      await g.writeInstalledJson({ packages: { bar: { versions: [{ version: "1.0.0", dir: "g3" }] } } });
      expect(await g.getLinkedVersion("bar")).to.equal(null);
    });

    it("findByTag / validateTag locate an installation by its dir", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({ packages: { foo: { versions: [{ version: "1.0.0", dir: "g1" }] } } });
      const found = await g.findByTag("g1");
      expect(found.packageName).to.equal("foo");
      expect(found.versionInfo.version).to.equal("1.0.0");
      expect(await g.findByTag("nope")).to.equal(null);

      const gt = makeGlobal({ tag: "g1" });
      await gt.writeInstalledJson({ packages: { foo: { versions: [{ version: "1.0.0", dir: "g1" }] } } });
      expect((await gt.validateTag()).packageName).to.equal("foo");
    });

    it("validateTag returns null when no tag and throws for a missing tag", async () => {
      const g = makeGlobal();
      expect(await g.validateTag()).to.equal(null);

      const gt = makeGlobal({ tag: "gX" });
      let error;
      try {
        await gt.validateTag();
      } catch (err) {
        error = err;
      }
      expect(error).to.exist;
      expect(error.message).to.contain("not found");
    });

    it("addToRegistry appends new versions and replaces same-dir entries", async () => {
      const g = makeGlobal();
      await g.addToRegistry("foo", { version: "1.0.0", dir: "g1" });
      await g.addToRegistry("foo", { version: "2.0.0", dir: "g2" });
      expect(await g.getPackageVersions("foo")).to.have.length(2);
      // same dir -> replace
      await g.addToRegistry("foo", { version: "1.0.1", dir: "g1" });
      const versions = await g.getPackageVersions("foo");
      expect(versions).to.have.length(2);
      expect(versions.find(v => v.dir === "g1").version).to.equal("1.0.1");
    });

    it("removeFromRegistry drops a version and prunes empty packages", async () => {
      const g = makeGlobal();
      await g.addToRegistry("foo", { version: "1.0.0", dir: "g1" });
      await g.addToRegistry("foo", { version: "2.0.0", dir: "g2" });
      await g.removeFromRegistry("foo", "1.0.0");
      expect(await g.getPackageVersions("foo")).to.have.length(1);
      await g.removeFromRegistry("foo", "2.0.0");
      const registry = await g.readInstalledJson();
      expect(registry.packages.foo).to.equal(undefined);
      // no-op for unknown package
      await g.removeFromRegistry("ghost", "1.0.0");
    });

    it("updateLinkedInRegistry links one version and unlinks the rest", async () => {
      const g = makeGlobal();
      await g.addToRegistry("foo", { version: "1.0.0", dir: "g1", linked: true });
      await g.addToRegistry("foo", { version: "2.0.0", dir: "g2", linked: false });
      await g.updateLinkedInRegistry("foo", "2.0.0", true);
      const versions = await g.getPackageVersions("foo");
      expect(versions.find(v => v.version === "1.0.0").linked).to.equal(false);
      expect(versions.find(v => v.version === "2.0.0").linked).to.equal(true);
      // no-op for unknown package
      await g.updateLinkedInRegistry("ghost", "1.0.0", true);
    });

    it("findInstalledPackage prefers the linked version", async () => {
      const g = makeGlobal();
      expect(await g.findInstalledPackage("foo")).to.equal(null);
      await g.writeInstalledJson({
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", linked: false },
              { version: "2.0.0", dir: "g2", linked: true }
            ]
          }
        }
      });
      expect((await g.findInstalledPackage("foo")).dir).to.equal("g2");
    });

    it("getAllGlobalPackages flattens the registry", async () => {
      const g = makeGlobal();
      await g.addToRegistry("foo", { version: "1.0.0", dir: "g1" });
      await g.addToRegistry("bar", { version: "2.0.0", dir: "g2" });
      const all = await g.getAllGlobalPackages();
      expect(all).to.have.length(2);
      expect(all.map(p => p.meta.package).sort()).to.deep.equal(["bar", "foo"]);
    });

    it("findBinOwner returns the linked owner of a bin", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: {
          foo: { versions: [{ version: "1.0.0", dir: "g1", bins: ["foo"], linked: true }] },
          bar: { versions: [{ version: "2.0.0", dir: "g2", bins: ["bar"], linked: false }] }
        }
      });
      expect(await g.findBinOwner("foo")).to.equal("foo@1.0.0");
      expect(await g.findBinOwner("bar")).to.equal(null); // present but not linked
      expect(await g.findBinOwner("baz")).to.equal(null);
    });

    it("findPackageByLocalPath matches local installs by resolved spec", async () => {
      const g = makeGlobal();
      const localDir = path.join(globalDir, "src", "widget");
      const searchSpec = `file:${path.resolve(localDir)}`;
      await g.writeInstalledJson({
        packages: {
          widget: { versions: [{ version: "1.0.0", dir: "g1", local: true, semver: searchSpec }] }
        }
      });
      const found = await g.findPackageByLocalPath(localDir);
      expect(found.packageName).to.equal("widget");
      expect(found.versions).to.have.length(1);
      expect(await g.findPackageByLocalPath(path.join(globalDir, "src", "other"))).to.equal(null);
    });
  });

  describe("getNextGlobalId", () => {
    it("returns g1 when packages dir is empty/absent", async () => {
      const g = makeGlobal();
      expect(await g.getNextGlobalId()).to.equal("g1");
    });

    it("returns the next id past the highest existing gN", async () => {
      const g = makeGlobal();
      fs.mkdirSync(path.join(packagesDir, "g1"), { recursive: true });
      fs.mkdirSync(path.join(packagesDir, "g5"), { recursive: true });
      fs.mkdirSync(path.join(packagesDir, "not-a-pkg"), { recursive: true });
      expect(await g.getNextGlobalId()).to.equal("g6");
    });
  });

  describe("discoverBins / getInstalledVersion", () => {
    const seedPkg = (dir, pkgName, { json, bins = [] }) => {
      const nm = path.join(dir, "node_modules");
      fs.mkdirSync(path.join(nm, pkgName), { recursive: true });
      fs.writeFileSync(path.join(nm, pkgName, "package.json"), JSON.stringify(json));
      const binDir = path.join(nm, ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      for (const b of bins) {
        fs.writeFileSync(path.join(binDir, b), "#!/usr/bin/env node\n");
      }
    };

    it("discovers object-form bins that exist in .bin", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(packagesDir, "g1");
      seedPkg(pkgDir, "foo", {
        json: { name: "foo", bin: { foo: "./bin/foo.js", extra: "./bin/extra.js" } },
        bins: ["foo"]
      });
      const bins = await g.discoverBins(pkgDir, "foo");
      expect(bins.foo).to.equal(path.join(pkgDir, "node_modules", ".bin", "foo"));
      // "extra" declared but no file in .bin -> not included
      expect(bins.extra).to.equal(undefined);
    });

    it("discovers string-form bin using the package name", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(packagesDir, "g2");
      seedPkg(pkgDir, "bar", { json: { name: "bar", bin: "./cli.js" }, bins: ["bar"] });
      const bins = await g.discoverBins(pkgDir, "bar");
      expect(bins.bar).to.equal(path.join(pkgDir, "node_modules", ".bin", "bar"));
    });

    it("returns {} when the package.json cannot be read", async () => {
      const g = makeGlobal();
      expect(await g.discoverBins(path.join(packagesDir, "ghost"), "ghost")).to.deep.equal({});
    });

    it("getInstalledVersion reads the version or returns null", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(packagesDir, "g1");
      seedPkg(pkgDir, "foo", { json: { name: "foo", version: "3.2.1" } });
      expect(await g.getInstalledVersion(pkgDir, "foo")).to.equal("3.2.1");
      expect(await g.getInstalledVersion(path.join(packagesDir, "ghost"), "ghost")).to.equal(null);
    });
  });

  describe("ensureBinSymlink", () => {
    it("creates the current-version bin symlink and is idempotent", async () => {
      const g = makeGlobal();
      fs.mkdirSync(versionDir, { recursive: true });
      await g.ensureBinSymlink();
      const link = path.join(globalDir, "bin");
      expect(fs.readlinkSync(link)).to.equal("v20/bin");
      // second call: already correct, should not throw
      await g.ensureBinSymlink();
      expect(fs.readlinkSync(link)).to.equal("v20/bin");
    });
  });

  describe("promptYesNo", () => {
    it("auto-confirms when yes is set", async () => {
      const g = makeGlobal({ yes: true });
      expect(await g.promptYesNo("ok?")).to.equal(true);
    });

    it("returns false in non-interactive mode", async () => {
      const g = makeGlobal({ interactive: false });
      expect(await g.promptYesNo("ok?")).to.equal(false);
    });
  });

  describe("removeVersion / unlinkBinsForVersion", () => {
    it("removeVersion removes the dir, unlinks bins, and updates the registry", async () => {
      const g = makeGlobal();
      const pkgDir = path.join(packagesDir, "g1");
      fs.mkdirSync(pkgDir, { recursive: true });
      await g.writeInstalledJson({
        packages: { foo: { versions: [{ version: "1.0.0", dir: "g1", bins: ["foo"], linked: true }] } }
      });
      expect(await g.removeVersion("foo", "1.0.0")).to.equal(true);
      expect(fs.existsSync(pkgDir)).to.equal(false);
      expect(await g.getPackageVersions("foo")).to.deep.equal([]);
      // unlink went through the fake linker
      expect(calls.some(c => c.type === "remove" && c.binName === "foo")).to.equal(true);
    });

    it("removeVersion returns false for an unknown version", async () => {
      const g = makeGlobal();
      expect(await g.removeVersion("foo", "9.9.9")).to.equal(false);
    });

    it("unlinkBinsForVersion is a no-op for an unknown version", async () => {
      const g = makeGlobal();
      await g.unlinkBinsForVersion("foo", "1.0.0");
      expect(calls.some(c => c.type === "remove")).to.equal(false);
    });
  });

  describe("removeGlobalPackage", () => {
    const seed = async g => {
      const registry = {
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", linked: false },
              { version: "2.0.0", dir: "g2", linked: true }
            ]
          }
        }
      };
      await g.writeInstalledJson(registry);
      fs.mkdirSync(path.join(packagesDir, "g1"), { recursive: true });
      fs.mkdirSync(path.join(packagesDir, "g2"), { recursive: true });
    };

    it("reports when the package is not installed", async () => {
      const g = makeGlobal();
      expect(await g.removeGlobalPackage("ghost")).to.equal(false);
    });

    it("removes an exact version", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.removeGlobalPackage("foo@1.0.0")).to.equal(true);
      expect((await g.getPackageVersions("foo")).map(v => v.version)).to.deep.equal(["2.0.0"]);
    });

    it("errors on an exact version that is not installed", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.removeGlobalPackage("foo@9.9.9")).to.equal(false);
    });

    it("removes versions matching a semver range but skips the linked one", async () => {
      const g = makeGlobal();
      await seed(g);
      // ">=1.0.0" matches both; linked 2.0.0 should be skipped, only g1 removed
      expect(await g.removeGlobalPackage("foo@>=1.0.0")).to.equal(true);
      expect((await g.getPackageVersions("foo")).map(v => v.version)).to.deep.equal(["2.0.0"]);
    });

    it("errors when no version matches a semver range", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.removeGlobalPackage("foo@^5.0.0")).to.equal(false);
    });

    it("removes all versions when confirmed (yes)", async () => {
      const g = makeGlobal({ yes: true });
      await seed(g);
      expect(await g.removeGlobalPackage("foo")).to.equal(true);
      const registry = await g.readInstalledJson();
      expect(registry.packages.foo).to.equal(undefined);
    });

    it("aborts removing all versions when not confirmed", async () => {
      const g = makeGlobal({ interactive: false }); // promptYesNo -> false
      await seed(g);
      expect(await g.removeGlobalPackage("foo")).to.equal(false);
      expect(await g.getPackageVersions("foo")).to.have.length(2);
    });

    it("removes a single-version package without prompting", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({ packages: { solo: { versions: [{ version: "1.0.0", dir: "g9" }] } } });
      fs.mkdirSync(path.join(packagesDir, "g9"), { recursive: true });
      expect(await g.removeGlobalPackage("solo")).to.equal(true);
      expect((await g.readInstalledJson()).packages.solo).to.equal(undefined);
    });

    it("removes by tag when --tag is set", async () => {
      const g = makeGlobal({ tag: "g1" });
      await seed(g);
      expect(await g.removeGlobalPackage("ignored")).to.equal(true);
      expect((await g.getPackageVersions("foo")).map(v => v.version)).to.deep.equal(["2.0.0"]);
    });
  });

  describe("listGlobalPackages", () => {
    it("returns [] when nothing is installed", async () => {
      const g = makeGlobal();
      expect(await g.listGlobalPackages()).to.deep.equal([]);
    });

    it("lists all installed versions", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", installedAt: Date.now(), linked: true, bins: ["foo"] },
              { version: "2.0.0", dir: "g2", installedAt: Date.now(), linked: false, local: true, semver: "file:/x" }
            ]
          }
        }
      });
      const result = await g.listGlobalPackages();
      expect(result).to.have.length(2);
      expect(result.map(r => r.package)).to.deep.equal(["foo", "foo"]);
    });

    it("filters by name", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: {
          foo: { versions: [{ version: "1.0.0", dir: "g1", installedAt: Date.now() }] },
          bar: { versions: [{ version: "2.0.0", dir: "g2", installedAt: Date.now() }] }
        }
      });
      const result = await g.listGlobalPackages("foo");
      expect(result.every(r => r.package === "foo")).to.equal(true);
    });
  });

  describe("linkPackageVersion", () => {
    const seed = async g => {
      await g.writeInstalledJson({
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", bins: ["foo"], linked: true },
              { version: "2.0.0", dir: "g2", bins: ["foo"], linked: false }
            ]
          }
        }
      });
      // seed g2 package.json so discoverBins works
      const nm = path.join(packagesDir, "g2", "node_modules");
      fs.mkdirSync(path.join(nm, "foo"), { recursive: true });
      fs.writeFileSync(path.join(nm, "foo", "package.json"), JSON.stringify({ name: "foo", bin: { foo: "./f.js" } }));
      fs.mkdirSync(path.join(nm, ".bin"), { recursive: true });
      fs.writeFileSync(path.join(nm, ".bin", "foo"), "#!/usr/bin/env node\n");
    };

    it("errors when the package is not installed", async () => {
      const g = makeGlobal();
      expect(await g.linkPackageVersion("ghost@1.0.0")).to.equal(false);
    });

    it("lists versions when none is specified", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.linkPackageVersion("foo")).to.equal(false);
    });

    it("errors when the requested version is not installed", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.linkPackageVersion("foo@9.9.9")).to.equal(false);
    });

    it("returns true immediately when the version is already linked", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.linkPackageVersion("foo@1.0.0")).to.equal(true);
    });

    it("links a new version and updates the registry", async () => {
      const g = makeGlobal();
      await seed(g);
      expect(await g.linkPackageVersion("foo@2.0.0")).to.equal(true);
      const versions = await g.getPackageVersions("foo");
      expect(versions.find(v => v.version === "2.0.0").linked).to.equal(true);
      expect(versions.find(v => v.version === "1.0.0").linked).to.equal(false);
    });
  });

  describe("cleanupPackage", () => {
    it("removes non-linked versions but keeps the linked one", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: {
          foo: {
            versions: [
              { version: "1.0.0", dir: "g1", linked: false },
              { version: "2.0.0", dir: "g2", linked: true },
              { version: "0.9.0", dir: "g3", linked: false }
            ]
          }
        }
      });
      fs.mkdirSync(path.join(packagesDir, "g1"), { recursive: true });
      fs.mkdirSync(path.join(packagesDir, "g3"), { recursive: true });
      const removed = await g.cleanupPackage("foo");
      expect(removed).to.equal(2);
      expect((await g.getPackageVersions("foo")).map(v => v.version)).to.deep.equal(["2.0.0"]);
    });

    it("skips cleanup when there is no linked version", async () => {
      const g = makeGlobal();
      await g.writeInstalledJson({
        packages: { foo: { versions: [{ version: "1.0.0", dir: "g1", linked: false }] } }
      });
      expect(await g.cleanupPackage("foo")).to.equal(0);
      expect(await g.getPackageVersions("foo")).to.have.length(1);
    });

    it("reports when the package is not installed", async () => {
      const g = makeGlobal();
      expect(await g.cleanupPackage("ghost")).to.equal(0);
    });
  });

  describe("showPathSetup", () => {
    it("runs without throwing", () => {
      makeGlobal().showPathSetup();
    });
  });
});
