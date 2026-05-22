"use strict";

const Fs = require("fs");
const Path = require("path");
const Fyn = require("../../lib/fyn");

describe("short-pkg-dir", function () {
  let saveEnv;
  beforeEach(() => {
    saveEnv = process.env.FYN_SHORT_PKG_DIR;
    delete process.env.FYN_SHORT_PKG_DIR;
  });
  afterEach(() => {
    if (saveEnv === undefined) {
      delete process.env.FYN_SHORT_PKG_DIR;
    } else {
      process.env.FYN_SHORT_PKG_DIR = saveEnv;
    }
  });

  describe("constructor flag", () => {
    it("defaults to long form when FYN_SHORT_PKG_DIR is unset", () => {
      const fyn = new Fyn({ opts: { cwd: "/tmp/x", targetDir: "node_modules" } });
      expect(fyn._shortPkgDir).to.equal(false);
    });

    it("opts into short form when FYN_SHORT_PKG_DIR is set", () => {
      process.env.FYN_SHORT_PKG_DIR = "1";
      const fyn = new Fyn({ opts: { cwd: "/tmp/x", targetDir: "node_modules" } });
      expect(fyn._shortPkgDir).to.equal(true);
    });
  });

  describe("getInstalledPkgDir", () => {
    const opts = { cwd: "/proj", targetDir: "node_modules" };

    it("produces long-form path by default", () => {
      const fyn = new Fyn({ opts });
      const dir = fyn.getInstalledPkgDir("pkg-a", "1.2.3");
      expect(dir).to.equal(
        Path.join("/proj", "node_modules", ".f", "_", "pkg-a", "1.2.3", "node_modules", "pkg-a")
      );
    });

    it("produces short-form path when flag is set", () => {
      process.env.FYN_SHORT_PKG_DIR = "1";
      const fyn = new Fyn({ opts });
      const dir = fyn.getInstalledPkgDir("pkg-a", "1.2.3");
      expect(dir).to.equal(
        Path.join("/proj", "node_modules", ".f", "_", "pkg-a", "1.2.3", "pkg-a")
      );
    });

    it("preserves scoped package name in both forms", () => {
      const long = new Fyn({ opts }).getInstalledPkgDir("@scope/pkg", "1.0.0");
      expect(long).to.equal(
        Path.join(
          "/proj",
          "node_modules",
          ".f",
          "_",
          "@scope/pkg",
          "1.0.0",
          "node_modules",
          "@scope/pkg"
        )
      );
      process.env.FYN_SHORT_PKG_DIR = "1";
      const short = new Fyn({ opts }).getInstalledPkgDir("@scope/pkg", "1.0.0");
      expect(short).to.equal(
        Path.join("/proj", "node_modules", ".f", "_", "@scope/pkg", "1.0.0", "@scope/pkg")
      );
    });

    it("falls back to top-level dir when version is omitted (unaffected by flag)", () => {
      const expected = Path.join("/proj", "node_modules", ".f", "_", "pkg-a");
      expect(new Fyn({ opts }).getInstalledPkgDir("pkg-a")).to.equal(expected);
      process.env.FYN_SHORT_PKG_DIR = "1";
      expect(new Fyn({ opts }).getInstalledPkgDir("pkg-a")).to.equal(expected);
    });
  });

  describe("saveInstallConfig persistence", () => {
    const tmpRoot = Path.join(__dirname, "..", "..", ".temp", "short-pkg-dir-spec");
    beforeEach(() => {
      Fs.rmSync(tmpRoot, { recursive: true, force: true });
      Fs.mkdirSync(Path.join(tmpRoot, "node_modules", ".f"), { recursive: true });
    });
    after(() => {
      Fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    const makeFyn = (envValue?: string) => {
      if (envValue === undefined) {
        delete process.env.FYN_SHORT_PKG_DIR;
      } else {
        process.env.FYN_SHORT_PKG_DIR = envValue;
      }
      return new Fyn({ opts: { cwd: tmpRoot, targetDir: "node_modules" } });
    };

    const fynJsonPath = () => Path.join(tmpRoot, "node_modules", ".f", ".fyn.json");

    it("writes shortPkgDir: false to .fyn.json by default", async () => {
      const fyn = makeFyn();
      await fyn.saveInstallConfig();
      const cfg = JSON.parse(Fs.readFileSync(fynJsonPath()).toString());
      expect(cfg.shortPkgDir).to.equal(false);
    });

    it("writes shortPkgDir: true to .fyn.json when env var is set", async () => {
      const fyn = makeFyn("1");
      await fyn.saveInstallConfig();
      const cfg = JSON.parse(Fs.readFileSync(fynJsonPath()).toString());
      expect(cfg.shortPkgDir).to.equal(true);
    });
  });
});
