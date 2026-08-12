import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../src/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { makeForeignRepoDetector } from "../src/utils";
import Fs from "fs";
import Path from "path";
import Os from "os";

describe("makeForeignRepoDetector", () => {
  let root: string;

  beforeAll(() => {
    root = Fs.mkdtempSync(Path.join(Os.tmpdir(), "fynpo-foreign-"));

    const mk = (...parts: string[]) => {
      const dir = Path.join(root, ...parts);
      Fs.mkdirSync(dir, { recursive: true });
      return dir;
    };

    // the monorepo root is itself a git repo - must NOT count as foreign
    Fs.mkdirSync(Path.join(root, ".git"));

    mk("core", "kernel");
    mk("dev-tools", "create-fynapp");

    // a nested clone: .git is a directory
    mk("nested-clone", "pkg-a");
    Fs.mkdirSync(Path.join(root, "nested-clone", ".git"));

    // a submodule / linked worktree: .git is a FILE
    mk("submod", "pkg-b");
    Fs.writeFileSync(Path.join(root, "submod", ".git"), "gitdir: ../.git/modules/submod\n");

    // deeply nested package inside a foreign repo
    mk("nested-clone", "group", "pkg-c");
  });

  afterAll(() => {
    Fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns undefined for packages owned by the monorepo", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("core/kernel")).toBeUndefined();
    expect(detect("dev-tools/create-fynapp")).toBeUndefined();
  });

  it("does not treat the monorepo root's own .git as foreign", () => {
    const detect = makeForeignRepoDetector(root);
    // walking up stops before the root, so a top level package is never foreign
    expect(detect("core")).toBeUndefined();
  });

  it("detects a nested clone where .git is a directory", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("nested-clone/pkg-a")).toBe("nested-clone");
  });

  it("detects a submodule/worktree where .git is a file", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("submod/pkg-b")).toBe("submod");
  });

  it("attributes a deeply nested package to the foreign repo root", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("nested-clone/group/pkg-c")).toBe("nested-clone");
  });

  it("reports the foreign repo dir itself", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("nested-clone")).toBe("nested-clone");
  });

  it("handles empty and dot paths", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("")).toBeUndefined();
    expect(detect(".")).toBeUndefined();
  });

  it("caches - repeated lookups agree", () => {
    const detect = makeForeignRepoDetector(root);
    expect(detect("nested-clone/pkg-a")).toBe("nested-clone");
    expect(detect("nested-clone/pkg-a")).toBe("nested-clone");
    expect(detect("core/kernel")).toBeUndefined();
    expect(detect("core/kernel")).toBeUndefined();
  });
});
