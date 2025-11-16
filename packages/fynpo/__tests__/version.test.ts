import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock logger
vi.mock("../src/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Version } from "../src/version";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";
import { logger } from "../src/logger";

describe("fynpo Version", () => {
  const dir = path.join(__dirname, "../test/sample");
  let graph: FynpoDepGraph;

  beforeAll(async () => {
    graph = new FynpoDepGraph({ cwd: path.join(__dirname, "../test/sample") });
    await graph.resolve();
  });

  it("should initialize Version class", () => {
    const opts = { cwd: dir };
    const version = new Version(opts, graph);

    expect(version.name).toBe("version");
    expect(version._cwd).toBe(dir);
    expect(version._graph).toBe(graph);
    expect(version._options).toBeDefined();
    expect(version.relatedCommands).toEqual(["changelog", "updated", "prepare"]);
  });

  it("should handle changelog file that exists", () => {
    const opts = { cwd: dir };
    const version = new Version(opts, graph);

    // If CHANGELOG.md exists in test/sample, it should be loaded
    expect(version._changeLogFile).toBeDefined();
  });

  it("should handle missing changelog file", () => {
    const tempDir = path.join(__dirname, "../test/temp-version-test");
    const opts = { cwd: tempDir };
    const version = new Version(opts, graph);

    expect(version._changeLogFile).toBeDefined();
    expect(version._changeLog).toBe("");
  });

  it("should handle version locks with wildcard", () => {
    const opts = { cwd: dir, versionLocks: ["*"] };
    const version = new Version(opts, graph);

    expect(version._versionLockMap).toBeDefined();
  });

  it("should handle version locks with specific patterns", () => {
    const opts = { cwd: dir, versionLocks: [["name:/pkg1/"]] };
    const version = new Version(opts, graph);

    expect(version._versionLockMap).toBeDefined();
  });

  it("should merge command config overrides", () => {
    const opts = {
      cwd: dir,
      command: {
        version: {
          commit: false,
          tag: true,
        },
        changelog: {
          someOption: "value",
        },
      },
    };
    const version = new Version(opts, graph);

    expect(version._options.commit).toBe(false);
    expect(version._options.tag).toBe(true);
  });

  it("should check git clean status", async () => {
    const opts = { cwd: dir };
    const version = new Version(opts, graph);

    await version.checkGitClean();
    expect(typeof version._gitClean).toBe("boolean");
  });

  it("should skip commit when commit option is disabled", async () => {
    const opts = { cwd: dir, commit: false };
    const version = new Version(opts, graph);
    version._gitClean = true;

    await version.commitAndTagUpdates({ packages: [], tags: [] });

    expect(logger.warn).toHaveBeenCalledWith("commit option disabled, skip committing updates.");

    vi.restoreAllMocks();
  });

  it("should skip commit when git is not clean", async () => {
    const opts = { cwd: dir, commit: true };
    const version = new Version(opts, graph);
    version._gitClean = false;

    await version.commitAndTagUpdates({ packages: [], tags: [] });

    expect(logger.warn).toHaveBeenCalledWith("Your git branch is not clean, skip committing updates.");

    vi.restoreAllMocks();
  });

  it("should skip tagging when tag option is false", async () => {
    const opts = { cwd: dir, commit: true, tag: false };
    const version = new Version(opts, graph);
    version._gitClean = true;

    const shSpy = vi.spyOn(version, "_sh").mockResolvedValue("");

    await version.commitAndTagUpdates({ packages: ["package.json"], tags: ["pkg1@1.0.0"] });

    // Should call git add and git commit, but not git tag
    expect(shSpy).toHaveBeenCalledWith(expect.stringContaining("git add"));
    expect(shSpy).toHaveBeenCalledWith(expect.stringContaining("git commit"));
    expect(shSpy).not.toHaveBeenCalledWith(expect.stringContaining("git tag"));

    vi.restoreAllMocks();
  });
});

