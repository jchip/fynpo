"use strict";

/* eslint-disable */

const Fs = require("fs");
const Http = require("http");
const Yaml = require("js-yaml");
const Path = require("path");
const _ = require("lodash");
const xsh = require("xsh");
const cacache = require("cacache");
const expect = require("chai").expect;
const Fyn = require("../../lib/fyn");
const PkgSrcManager = require("../../lib/pkg-src-manager");
const mockNpm = require("../fixtures/mock-npm");
const { getBucketPath, refreshCacheEntry } = require("../../lib/cacache-util");

describe("pkg-src-manager", function() {
  let fynCacheDir;

  let server;
  before(() => {
    return mockNpm({ logLevel: "warn" }).then(s => (server = s));
  });

  after(() => {
    return server.stop();
  });

  beforeEach(() => {
    fynCacheDir = Path.join(__dirname, `../.tmp_${Date.now()}`);
  });

  afterEach(() => {
    xsh.$.rm("-rf", fynCacheDir);
  });

  it.skip("should save meta cache with etag", () => {
    const host = `localhost:${server.info.port}`;
    const mgr = new PkgSrcManager({
      registry: `http://${host}`,
      fynCacheDir,
      fyn: {}
    });
    return mgr
      .fetchMeta({
        name: "mod-a",
        semver: ""
      })
      .then(meta => {
        expect(meta.fynFo.etag).to.exist;
      });
  });

  it.skip("should handle 304 when fetching meta that's already in local cache", () => {
    const host = `localhost:${server.info.port}`;
    const options = {
      registry: `http://${host}`,
      fynCacheDir,
      fyn: {}
    };
    let etag;
    let mgr = new PkgSrcManager(options);
    return mgr
      .fetchMeta({
        name: "mod-a",
        semver: ""
      })
      .then(meta => {
        expect(meta.fynFo.etag).to.exist;
        etag = meta.fynFo.etag;
        return new PkgSrcManager(options).fetchMeta({
          name: "mod-a",
          semver: ""
        });
      })
      .then(meta => {
        expect(meta.fynFo.etag).to.exist;
        expect(meta.fynFo.etag).to.equal(etag);
      });
  });

  it("should load packument from the current make-fetch-happen cache key", async () => {
    const host = `localhost:${server.info.port}`;
    const registry = `http://${host}`;
    const fyn = {
      concurrency: 1,
      _fynCacheDir: fynCacheDir,
      _options: {},
      isFynpo: false,
      forceCache: false,
      remoteMetaDisabled: "offline",
      remoteTgzDisabled: false,
      copy: []
    };
    const mgr = new PkgSrcManager({
      registry,
      fynCacheDir,
      fyn
    });
    const packumentUrl = mgr.makePackumentUrl("mod-a");
    const cacheKey = `make-fetch-happen:request-cache:${packumentUrl}`;
    const packument = {
      name: "mod-a",
      versions: {
        "2.0.0": {
          name: "mod-a",
          version: "2.0.0"
        }
      },
      "dist-tags": {
        latest: "2.0.0"
      }
    };

    await cacache.put(fynCacheDir, cacheKey, JSON.stringify(packument));
    await refreshCacheEntry(fynCacheDir, cacheKey);

    const meta = await mgr.fetchMeta({
      name: "mod-a",
      semver: ""
    });

    expect(meta["dist-tags"].latest).to.equal("2.0.0");
  });

  it("should reread cache on meta-memoize hit before reusing packument", async () => {
    const host = `localhost:${server.info.port}`;
    const registry = `http://${host}`;
    const packumentVersions = {
      stale: {
        name: "mod-a",
        versions: {
          "1.0.0": {
            name: "mod-a",
            version: "1.0.0"
          }
        },
        "dist-tags": {
          latest: "1.0.0"
        }
      },
      fresh: {
        name: "mod-a",
        versions: {
          "2.0.0": {
            name: "mod-a",
            version: "2.0.0"
          }
        },
        "dist-tags": {
          latest: "2.0.0"
        }
      }
    };
    const fyn = {
      concurrency: 1,
      _fynCacheDir: fynCacheDir,
      _options: {},
      isFynpo: false,
      forceCache: false,
      remoteMetaDisabled: false,
      remoteTgzDisabled: false,
      copy: []
    };
    const mgr = new PkgSrcManager({
      registry,
      fynCacheDir,
      fyn
    });
    const packumentUrl = mgr.makePackumentUrl("mod-a");
    const cacheKey = `make-fetch-happen:request-cache:${packumentUrl}`;

    await cacache.put(fynCacheDir, cacheKey, JSON.stringify(packumentVersions.stale));

    const bucket = getBucketPath(fynCacheDir, cacheKey);
    const staleTime = new Date(Date.now() - 26 * 60 * 60 * 1000);
    Fs.utimesSync(bucket, staleTime, staleTime);

    const memoServer = await new Promise(resolve => {
      const server2 = Http.createServer(async (req, res) => {
        const { searchParams } = new URL(req.url, "http://localhost");
        const key = searchParams.get("key");

        if (key === cacheKey) {
          await cacache.put(fynCacheDir, cacheKey, JSON.stringify(packumentVersions.fresh));
          await refreshCacheEntry(fynCacheDir, cacheKey);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ time: Date.now() }));
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ err: "not found" }));
      });

      server2.listen(0, () => {
        server2.port = server2.address().port;
        resolve(server2);
      });
    });

    fyn._options.metaMemoize = `http://localhost:${memoServer.port}`;

    try {
      const meta = await mgr.fetchMeta({
        name: "mod-a",
        semver: ""
      });

      expect(meta["dist-tags"].latest).to.equal("2.0.0");
    } finally {
      await new Promise(resolve => memoServer.close(resolve));
    }
  });

  it("should prefer the freshest packument when both cache keys exist", async () => {
    const host = `localhost:${server.info.port}`;
    const registry = `http://${host}`;
    const fyn = {
      concurrency: 1,
      _fynCacheDir: fynCacheDir,
      _options: {},
      isFynpo: false,
      forceCache: false,
      remoteMetaDisabled: "offline",
      remoteTgzDisabled: false,
      copy: []
    };
    const mgr = new PkgSrcManager({
      registry,
      fynCacheDir,
      fyn
    });
    const packumentUrl = mgr.makePackumentUrl("mod-a");
    const cacheKey = `make-fetch-happen:request-cache:${packumentUrl}`;
    const legacyCacheKey = `make-fetch-happen:request-cache:full:${packumentUrl}`;
    const stalePackument = {
      name: "mod-a",
      versions: {
        "1.0.0": {
          name: "mod-a",
          version: "1.0.0"
        }
      },
      "dist-tags": {
        latest: "1.0.0"
      }
    };
    const freshPackument = {
      name: "mod-a",
      versions: {
        "2.0.0": {
          name: "mod-a",
          version: "2.0.0"
        }
      },
      "dist-tags": {
        latest: "2.0.0"
      }
    };

    await cacache.put(fynCacheDir, cacheKey, JSON.stringify(stalePackument));
    await cacache.put(fynCacheDir, legacyCacheKey, JSON.stringify(freshPackument));

    const staleTime = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const freshTime = new Date();

    Fs.utimesSync(getBucketPath(fynCacheDir, cacheKey), staleTime, staleTime);
    Fs.utimesSync(getBucketPath(fynCacheDir, legacyCacheKey), freshTime, freshTime);

    const meta = await mgr.fetchMeta({
      name: "mod-a",
      semver: ""
    });

    expect(meta["dist-tags"].latest).to.equal("2.0.0");
  });

  it("requests packument with camelCase pacote v21 options", async () => {
    const pacote = require("pacote");
    const origPackument = pacote.packument;
    let captured;
    pacote.packument = (name, opts) => {
      captured = opts;
      return Promise.resolve({
        name,
        versions: { "1.0.0": { name, version: "1.0.0" } },
        "dist-tags": { latest: "1.0.0" }
      });
    };

    const fyn = {
      concurrency: 1,
      _fynCacheDir: fynCacheDir,
      _options: {},
      isFynpo: false,
      forceCache: false,
      remoteMetaDisabled: false,
      remoteTgzDisabled: false,
      copy: []
    };
    const mgr = new PkgSrcManager({
      registry: "http://localhost/",
      fynCacheDir,
      fyn
    });

    try {
      const result = await new Promise((resolve, reject) => {
        mgr.netRetrieveMeta({
          item: { name: "mod-a" },
          packumentUrl: mgr.makePackumentUrl("mod-a"),
          cacheKey: "test-cache-key",
          defer: { resolve, reject }
        });
      });

      expect(result["dist-tags"].latest).to.equal("1.0.0");
      // the v21-correct camelCase options must reach pacote
      expect(captured.fullMetadata).to.equal(true);
      expect(captured.fetchRetries).to.equal(3);
      expect(captured.preferOnline).to.equal(true);
      // the old kebab-case / nonexistent names must be gone
      expect(captured).to.not.have.property("full-metadata");
      expect(captured).to.not.have.property("fetch-retries");
      expect(captured).to.not.have.property("cache-policy");
      expect(captured).to.not.have.property("cache-key");
    } finally {
      pacote.packument = origPackument;
    }
  });

  it("tarball-stream fallback requests full metadata with the correct camelCase option", () => {
    const pacote = require("pacote");
    const origStream = pacote.tarball.stream;
    let captured;
    pacote.tarball.stream = (_id, _cb, opts) => {
      captured = opts;
      return Promise.resolve();
    };

    const fyn = {
      concurrency: 1,
      _fynCacheDir: fynCacheDir,
      _options: {},
      isFynpo: false,
      forceCache: false,
      remoteMetaDisabled: false,
      remoteTgzDisabled: false,
      copy: []
    };
    const mgr = new PkgSrcManager({ registry: "http://localhost/", fynCacheDir, fyn });

    try {
      // no dist.tarball -> takes the pacote.tarball.stream fallback path
      mgr.pacoteTarballStream("mod-a@1.0.0", { name: "mod-a", version: "1.0.0" }, "sha512-x");
      expect(captured.fullMetadata).to.equal(true);
      expect(captured).to.not.have.property("fullMeta");
    } finally {
      pacote.tarball.stream = origStream;
    }
  });

  describe("isPinnedGitCommit", () => {
    const { isPinnedGitCommit } = PkgSrcManager;
    const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"; // 40 hex chars

    it("treats a 40-hex committish as a pinned commit", () => {
      expect(isPinnedGitCommit(`github:user/repo#${sha}`)).to.equal(true);
      expect(isPinnedGitCommit(`git+https://github.com/user/repo.git#${sha}`)).to.equal(true);
      // a bare sha spec (no '#') is also pinned
      expect(isPinnedGitCommit(sha)).to.equal(true);
    });

    it("treats branch/tag refs and plain specs as not pinned", () => {
      expect(isPinnedGitCommit("github:user/repo#main")).to.equal(false);
      expect(isPinnedGitCommit("github:user/repo#v1.2.3")).to.equal(false);
      expect(isPinnedGitCommit("github:user/repo")).to.equal(false);
      expect(isPinnedGitCommit(`github:user/repo#${sha.slice(0, 7)}`)).to.equal(false);
      expect(isPinnedGitCommit("")).to.equal(false);
      expect(isPinnedGitCommit(undefined)).to.equal(false);
    });
  });
});
