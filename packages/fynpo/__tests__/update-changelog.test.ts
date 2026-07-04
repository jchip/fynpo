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

import Changelog from "../src/update-changelog";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

describe("fynpo Changelog.commitChangeLogFile", () => {
  const dir = path.join(__dirname, "../test/sample");
  let graph: FynpoDepGraph;

  beforeAll(async () => {
    graph = new FynpoDepGraph({ cwd: dir });
    await graph.resolve();
  });

  it("returns a thenable resolving to false when commit is disabled (no crash)", async () => {
    const cl = new Changelog({ cwd: dir, commit: false }, graph);

    const result: any = cl.commitChangeLogFile();

    // regression: used to return undefined -> caller's .then() threw TypeError
    expect(typeof result.then).toBe("function");
    await expect(result).resolves.toBe(false);
  });

  it("returns a thenable resolving to false when the git tree is not clean", async () => {
    const cl = new Changelog({ cwd: dir, commit: true }, graph);
    cl._gitClean = false;

    const result: any = cl.commitChangeLogFile();

    expect(typeof result.then).toBe("function");
    await expect(result).resolves.toBe(false);
  });

  it("commits and resolves true when commit is enabled and the tree is clean", async () => {
    const cl = new Changelog({ cwd: dir, commit: true }, graph);
    cl._gitClean = true;
    const shSpy = vi.spyOn(cl as any, "_sh").mockResolvedValue("");

    await expect(cl.commitChangeLogFile()).resolves.toBe(true);
    expect(shSpy).toHaveBeenCalledWith(expect.stringContaining("git commit"));

    vi.restoreAllMocks();
  });
});
