"use strict";

/* eslint-disable max-statements, no-magic-numbers */

const Fs = require("fs");
const Os = require("os");
const Path = require("path");
const { expect } = require("chai");
const DepItem = require("../../lib/dep-item");
const { DEP_ITEM } = require("../../lib/symbols");
const { scanFileStats } = require("../../lib/util/stat-dir");
const {
  makeLocalExportsManifest,
  reconcileLocalExports,
  syncLocalExports,
  localExportsNeedInstall
} = require("../../lib/local-exports");

const makeDepItem = (name, dir, ancestorSpec) => {
  const parent = ancestorSpec
    ? new DepItem({ name: "ancestor", semver: ancestorSpec, src: "dep", dsrc: "dep" })
    : null;
  return new DepItem({ name, semver: `file:${dir}`, src: "dep", dsrc: "dep" }, parent);
};

const expectFailure = async (fn, match) => {
  let error;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  expect(error, "expected operation to fail").to.exist;
  expect(error.message).to.match(match);
  return error;
};

const makeDirLink = (target, link) => {
  Fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
};

describe("local exports", function() {
  let cwd;
  let root;
  let producerCount;

  beforeEach(() => {
    root = Fs.mkdtempSync(Path.join(Os.tmpdir(), "fyn-local-exports-"));
    cwd = Path.join(root, "consumer");
    Fs.mkdirSync(cwd);
    producerCount = 0;
  });

  afterEach(() => {
    Fs.rmSync(root, { recursive: true, force: true });
  });

  const makeProducer = ({ name = "local-pkg", version = "1.0.0", directories = ["src"] } = {}) => {
    const dir = Path.join(root, `producer-${producerCount++}`);
    Fs.mkdirSync(dir);
    directories.forEach(directory => {
      const sourceDir = Path.join(dir, directory);
      Fs.mkdirSync(sourceDir, { recursive: true });
      Fs.writeFileSync(Path.join(sourceDir, "value.js"), `module.exports = ${producerCount};\n`);
    });
    return { name, version, dir };
  };

  const makeDepInfo = options => {
    const { producer, localExports = { src: "src" }, ancestorSpec } = options;
    const local = Object.prototype.hasOwnProperty.call(options, "local") ? options.local : "hard";
    return {
      name: producer.name,
      version: producer.version,
      local,
      dir: producer.dir,
      dist: { fullPath: producer.dir },
      json: {
        name: producer.name,
        version: producer.version,
        fyn: { localExports }
      },
      [DEP_ITEM]: makeDepItem(producer.name, producer.dir, ancestorSpec)
    };
  };

  it("creates live unscoped and scoped directory projections", async () => {
    const plain = makeProducer({ name: "plain-pkg", directories: ["src"] });
    const scoped = makeProducer({ name: "@scope/ui", directories: ["themes"] });
    const depInfos = [
      makeDepInfo({ producer: plain, localExports: { src: "src" } }),
      makeDepInfo({ producer: scoped, localExports: { themes: "themes" } })
    ];

    const manifest = await makeLocalExportsManifest({ cwd, depInfos });
    await reconcileLocalExports({ cwd, manifest });

    const plainTarget = Path.join(cwd, "_fyn/plain-pkg/src");
    const scopedTarget = Path.join(cwd, "_fyn/@scope/ui/themes");
    expect(Fs.realpathSync(plainTarget)).to.equal(Fs.realpathSync(Path.join(plain.dir, "src")));
    expect(Fs.realpathSync(scopedTarget)).to.equal(
      Fs.realpathSync(Path.join(scoped.dir, "themes"))
    );
    expect(Fs.existsSync(Path.join(cwd, "_fyn/.fyn-local-exports.json"))).to.equal(true);

    Fs.writeFileSync(Path.join(plain.dir, "src/value.js"), "module.exports = 'changed';\n");
    expect(Fs.readFileSync(Path.join(plainTarget, "value.js"), "utf8")).to.equal(
      "module.exports = 'changed';\n"
    );
  });

  it("honors false tombstones in the merged producer configuration", async () => {
    const producer = makeProducer({ directories: ["src", "themes"] });
    const manifest = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer, localExports: { src: false, themes: "themes" } })]
    });

    await reconcileLocalExports({ cwd, manifest });

    expect(Fs.existsSync(Path.join(cwd, "_fyn/local-pkg/src"))).to.equal(false);
    expect(Fs.realpathSync(Path.join(cwd, "_fyn/local-pkg/themes"))).to.equal(
      Fs.realpathSync(Path.join(producer.dir, "themes"))
    );

    const disabled = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer, localExports: false })]
    });
    await reconcileLocalExports({ cwd, manifest: disabled });
    expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
  });

  it("ignores registry, Git, and URL-ancestry packages before parsing config", async () => {
    const registry = makeProducer({ name: "registry-pkg" });
    const git = makeProducer({ name: "git-pkg" });
    const inheritedUrl = makeProducer({ name: "url-child" });
    const failedOptional = makeProducer({ name: "failed-optional" });
    const gitDep = makeDepInfo({ producer: git, local: undefined, localExports: null });
    gitDep[DEP_ITEM] = new DepItem({
      name: git.name,
      semver: "git+https://example.test/repo.git",
      src: "dep",
      dsrc: "dep"
    });
    const failedOptionalDep = makeDepInfo({
      producer: failedOptional,
      localExports: "malformed"
    });
    failedOptionalDep.optFailed = 2;
    const depInfos = [
      makeDepInfo({ producer: registry, local: undefined, localExports: "malformed" }),
      gitDep,
      makeDepInfo({
        producer: inheritedUrl,
        localExports: ["malformed"],
        ancestorSpec: "github:example/parent"
      }),
      failedOptionalDep
    ];

    const manifest = await makeLocalExportsManifest({ cwd, depInfos });
    await reconcileLocalExports({ cwd, manifest });

    expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
  });

  it("rejects malformed configuration before writing", async () => {
    const producer = makeProducer();
    const makeManifest = localExports =>
      makeLocalExportsManifest({
        cwd,
        depInfos: [makeDepInfo({ producer, localExports })]
      });
    for (const localExports of ["src", ["src"], null, { src: true }, { src: {} }]) {
      await expectFailure(makeManifest.bind(null, localExports), /localExports|local-pkg/i);
      expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
    }
  });

  it("rejects unsafe, missing, and non-directory sources before writing", async () => {
    const producer = makeProducer();
    Fs.writeFileSync(Path.join(producer.dir, "file.js"), "module.exports = 1;\n");
    Fs.mkdirSync(Path.join(producer.dir, "node_modules"));
    const cases = [
      { exports: { "../bad": "src" }, match: /export|\.\.\/bad|safe/i },
      { exports: { src: "../outside" }, match: /source|outside|escape/i },
      { exports: { src: Path.join(producer.dir, "src") }, match: /absolute|source/i },
      { exports: { src: "missing" }, match: /missing|exist|source/i },
      { exports: { src: "file.js" }, match: /directory|file\.js/i },
      { exports: { src: "node_modules" }, match: /node_modules|source/i }
    ];
    const makeManifest = localExports =>
      makeLocalExportsManifest({
        cwd,
        depInfos: [makeDepInfo({ producer, localExports })]
      });

    for (const testCase of cases) {
      await expectFailure(makeManifest.bind(null, testCase.exports), testCase.match);
      expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
    }
  });

  it("rejects a source symlink that escapes the producer root", async () => {
    const producer = makeProducer();
    const outside = Path.join(root, "outside");
    Fs.mkdirSync(outside);
    makeDirLink(outside, Path.join(producer.dir, "escape"));

    await expectFailure(
      () =>
        makeLocalExportsManifest({
          cwd,
          depInfos: [makeDepInfo({ producer, localExports: { src: "escape" } })]
        }),
      /escape|outside|source|symlink/i
    );
    expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
  });

  it("rejects multiple local versions of an exporting package before writing", async () => {
    const first = makeProducer({ name: "duplicate-pkg", version: "1.0.0" });
    const second = makeProducer({ name: "duplicate-pkg", version: "2.0.0" });

    await expectFailure(
      () =>
        makeLocalExportsManifest({
          cwd,
          depInfos: [makeDepInfo({ producer: first }), makeDepInfo({ producer: second })]
        }),
      /duplicate-pkg|version|collision|destination/i
    );
    expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
  });

  it("removes stale projections and the managed root when none remain", async () => {
    const producer = makeProducer({ directories: ["src", "themes"] });
    const initial = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer, localExports: { src: "src", themes: "themes" } })]
    });
    await reconcileLocalExports({ cwd, manifest: initial });

    const reduced = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer, localExports: { src: "src", themes: false } })]
    });
    await reconcileLocalExports({ cwd, manifest: reduced });
    expect(Fs.existsSync(Path.join(cwd, "_fyn/local-pkg/src"))).to.equal(true);
    expect(Fs.existsSync(Path.join(cwd, "_fyn/local-pkg/themes"))).to.equal(false);

    const empty = await makeLocalExportsManifest({ cwd, depInfos: [] });
    await reconcileLocalExports({ cwd, manifest: empty });
    expect(Fs.existsSync(Path.join(cwd, "_fyn"))).to.equal(false);
  });

  it("refuses to modify an unowned _fyn tree", async () => {
    const producer = makeProducer();
    const manifest = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer })]
    });
    Fs.mkdirSync(Path.join(cwd, "_fyn"));
    Fs.writeFileSync(Path.join(cwd, "_fyn/user.txt"), "keep\n");

    await expectFailure(
      () => reconcileLocalExports({ cwd, manifest }),
      /_fyn|owned|manifest|refus/i
    );
    expect(Fs.readFileSync(Path.join(cwd, "_fyn/user.txt"), "utf8")).to.equal("keep\n");
  });

  it("sync repairs a missing projection", async () => {
    const producer = makeProducer();
    const manifest = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer })]
    });
    await reconcileLocalExports({ cwd, manifest });

    const target = Path.join(cwd, "_fyn/local-pkg/src");
    Fs.unlinkSync(target);
    expect(Fs.existsSync(target)).to.equal(false);

    await syncLocalExports({ cwd, manifest });
    expect(Fs.realpathSync(target)).to.equal(Fs.realpathSync(Path.join(producer.dir, "src")));
  });

  it("reports missing and misdirected projections as needing install", async () => {
    const producer = makeProducer();
    const manifest = await makeLocalExportsManifest({
      cwd,
      depInfos: [makeDepInfo({ producer })]
    });
    await reconcileLocalExports({ cwd, manifest });

    const target = Path.join(cwd, "_fyn/local-pkg/src");
    expect(await localExportsNeedInstall({ cwd, manifest })).to.equal(false);

    Fs.unlinkSync(target);
    expect(await localExportsNeedInstall({ cwd, manifest })).to.equal(true);
    await syncLocalExports({ cwd, manifest });

    const wrong = Path.join(root, "wrong");
    Fs.mkdirSync(wrong);
    Fs.unlinkSync(target);
    makeDirLink(wrong, target);
    expect(await localExportsNeedInstall({ cwd, manifest })).to.equal(true);
  });

  it("ignores the generated _fyn tree during consumer file scans", async () => {
    const generated = Path.join(cwd, "_fyn/local-pkg/src");
    Fs.mkdirSync(generated, { recursive: true });
    const generatedFile = Path.join(generated, "newest.js");
    Fs.writeFileSync(generatedFile, "module.exports = true;\n");

    const oldTime = new Date(1);
    const futureTime = new Date(Date.now() + 60000);
    Fs.utimesSync(cwd, oldTime, oldTime);
    Fs.utimesSync(generatedFile, futureTime, futureTime);

    const stats = await scanFileStats(cwd);
    expect(stats.latestFile).to.not.include(`${Path.sep}_fyn${Path.sep}`);
    expect(stats.latestMtimeMs).to.be.lessThan(futureTime.getTime());
  });
});
