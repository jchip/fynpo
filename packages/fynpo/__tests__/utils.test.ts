import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";

// Mock logger before importing utils
vi.mock("../src/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import * as utils from "../src/utils";
import { logger } from "../src/logger";
import path from "path";
import fs from "fs";
import shcmd from "shcmd";

describe("fynpo utils", () => {
  const dir = path.join(__dirname, "../test/sample");

  afterAll(() => {
    try {
      require("fs").unlinkSync(path.join(dir, "fynpo.json"));
    } catch {}
    try {
      require("fs").unlinkSync(path.join(dir, "fynpo.config.js"));
    } catch {}
  });

  const makeConfigFile = (fileName, data) => {
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data));
  };

  describe("loadConfig", () => {
    it("should load lerna config", () => {
      makeConfigFile("lerna.json", { fynpo: true });

      const config: any = utils.loadConfig(dir);
      expect(config.fynpoRc).toHaveProperty("fynpo");
      expect(config.fynpoRc.fynpo).toEqual(true);
    });

    it("should load lerna config without fynpo", () => {
      makeConfigFile("lerna.json", { version: "1.0.0" });

      const config: any = utils.loadConfig(dir);
      expect(config.fynpoRc).toHaveProperty("fynpo");
      expect(config.fynpoRc.fynpo).toEqual(true);
      expect(config.fynpoRc.version).toEqual("1.0.0");
    });

    it("should load fynpo config", () => {
      makeConfigFile("fynpo.json", { test: "123" });

      const config: any = utils.loadConfig(dir);
      expect(config.fynpoRc).toHaveProperty("test");
      expect(config.fynpoRc.test).toEqual("123");
    });

    it("should create default config if none exists", () => {
      const tempDir = path.join(__dirname, "../test/temp-utils-test");
      const configPath = path.join(tempDir, "fynpo.json");
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      const config: any = utils.loadConfig(tempDir);
      expect(config.fynpoRc).toBeDefined();
      // The config may have different structure depending on what was loaded
      expect(config.dir).toBeDefined();
      
      // Cleanup
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    });

    it("should add patterns alias from packages", () => {
      makeConfigFile("fynpo.json", { packages: ["packages/*"] });

      const config: any = utils.loadConfig(dir);
      expect(config.fynpoRc.patterns).toEqual(["packages/*"]);
    });
  });

  describe("makePublishTag", () => {
    it("should create tag with default template", () => {
      const date = new Date("2023-12-25T10:30:45Z");
      const gitHash = "abc123def456";
      const tag = utils.makePublishTag(utils.defaultTagTemplate, { date: date as any, gitHash });

      expect(tag).toContain("2023");
      expect(tag).toContain("12");
      expect(tag).toContain("25");
      expect(tag).toContain("abc123de");
    });

    it("should create tag with custom template", () => {
      const date = new Date("2023-12-25T10:30:45Z");
      const gitHash = "abc123def456";
      const template = "v{YYYY}.{MM}.{DD}-{COMMIT}";
      const tag = utils.makePublishTag(template, { date: date as any, gitHash });

      expect(tag).toBe("v2023.12.25-abc123de");
    });

    it("should include time tokens", () => {
      const date = new Date("2023-12-25T10:30:45Z");
      const template = "{hh}:{mm}:{ss}";
      const tag = utils.makePublishTag(template, { date: date as any });

      expect(tag).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it("should throw error for unknown token", () => {
      const template = "tag-{UNKNOWN}";
      expect(() => {
        utils.makePublishTag(template);
      }).toThrow("unknown token");
    });

    it("should use current date if not provided", () => {
      const tag = utils.makePublishTag(utils.defaultTagTemplate, { gitHash: "abc123" });
      expect(tag).toBeDefined();
      expect(typeof tag).toBe("string");
    });
  });

  describe("makePublishTagSearchTerm", () => {
    it("should convert template to search term", () => {
      const template = "fynpo-rel-{YYYY}{MM}{DD}-{COMMIT}";
      const searchTerm = utils.makePublishTagSearchTerm(template);

      expect(searchTerm).toBe("fynpo-rel-*-*");
    });

    it("should handle multiple consecutive tokens", () => {
      const template = "{YYYY}{MM}{DD}";
      const searchTerm = utils.makePublishTagSearchTerm(template);

      expect(searchTerm).toBe("*");
    });

    it("should use default template if not provided", () => {
      const searchTerm = utils.makePublishTagSearchTerm("");
      expect(searchTerm).toBeDefined();
    });
  });

  describe("timer", () => {
    it("should return a function that measures elapsed time", async () => {
      const timer = utils.timer();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const elapsed = timer();

      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(200);
    });

    it("should return 0 immediately", () => {
      const timer = utils.timer();
      const elapsed = timer();

      expect(elapsed).toBeLessThan(10);
    });
  });

  describe("generateLintConfig", () => {
    it("should generate commitlint config", () => {
      const config = utils.generateLintConfig();

      expect(config.extends).toContain("@commitlint/config-conventional");
      expect(config.parserPreset).toBeDefined();
      expect(config.rules).toBeDefined();
      expect(config.ignores).toBeDefined();
      expect(config.defaultIgnores).toBe(true);
    });

    it("should have correct parser preset pattern", () => {
      const config = utils.generateLintConfig();

      expect(config.parserPreset.parserOpts.headerPattern).toBeInstanceOf(RegExp);
      expect(config.parserPreset.parserOpts.headerCorrespondence).toEqual(["type", "scope", "subject"]);
    });

    it("should have type-enum rule", () => {
      const config = utils.generateLintConfig();

      expect(config.rules["type-enum"]).toBeDefined();
      expect(config.rules["type-enum"][2]).toContain("patch");
      expect(config.rules["type-enum"][2]).toContain("minor");
      expect(config.rules["type-enum"][2]).toContain("major");
    });
  });

  describe("getRootScripts", () => {
    it("should get scripts from package.json", () => {
      const scripts = utils.getRootScripts(dir);
      expect(scripts).toBeDefined();
      expect(typeof scripts).toBe("object");
    });

    it("should return empty object if no scripts", () => {
      const tempDir = path.join(__dirname, "../test/temp-scripts-test");
      const pkgPath = path.join(tempDir, "package.json");
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      fs.writeFileSync(pkgPath, JSON.stringify({ name: "test", version: "1.0.0" }));
      
      const scripts = utils.getRootScripts(tempDir);
      expect(scripts).toEqual({});
      
      // Cleanup
      if (fs.existsSync(pkgPath)) {
        fs.unlinkSync(pkgPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    });
  });

  describe("lintParser", () => {
    it("should parse commit message with header pattern", () => {
      const commit = "[feat] [scope] Add new feature";
      const options = {
        headerPattern: /^\[([^\]]+)\] ?\[([^\]]+)\] +(.+)$/,
        headerCorrespondence: ["type", "scope", "subject"],
      };

      const parsed: any = utils.lintParser(commit, options);
      expect(parsed?.type).toBe("feat");
      expect(parsed?.scope).toBe("scope");
      expect(parsed?.subject).toBe("Add new feature");
    });

    it("should handle commit without scope", () => {
      const commit = "[fix] Fix bug";
      const options = {
        headerPattern: /^\[([^\]]+)\] ?(\[[^\]]+\])? +(.+)$/,
        headerCorrespondence: ["type", "scope", "subject"],
      };

      const parsed: any = utils.lintParser(commit, options);
      expect(parsed?.type).toBe("fix");
      expect(parsed?.subject).toBe("Fix bug");
    });

    it("should handle empty commit message", () => {
      const loggerErrorSpy = vi.spyOn(logger, "error");

      const parsed = utils.lintParser("", {});
      expect(parsed).toEqual({});
      expect(loggerErrorSpy).toHaveBeenCalledWith("Commit message empty");

      vi.restoreAllMocks();
    });

    it("should convert string pattern to RegExp", () => {
      const commit = "[feat] Test";
      const options = {
        headerPattern: "^\\[([^\\]]+)\\] +(.+)$",
        headerCorrespondence: "type,subject",
      };

      const parsed: any = utils.lintParser(commit, options);
      expect(parsed?.type).toBe("feat");
      expect(parsed?.subject).toBe("Test");
    });
  });
});
