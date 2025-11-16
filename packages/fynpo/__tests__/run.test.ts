import { describe, it, expect, beforeAll, vi } from "vitest";
import { Run } from "../src/run";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

describe("fynpo Run", () => {
  const dir = path.join(__dirname, "../test/sample");
  let graph: FynpoDepGraph;

  beforeAll(async () => {
    graph = new FynpoDepGraph({ cwd: path.join(__dirname, "../test/sample") });
    await graph.resolve();
  });

  it("should initialize Run class with default concurrency", () => {
    const opts = { cwd: dir };
    const args = { script: "test" };
    const run = new Run(opts, args, graph);

    expect(run._script).toBe("test");
    expect(run._cwd).toBe(dir);
    expect(run._concurrency).toBe(3); // default
    expect(run._npmClient).toBe("npm");
    expect(run._args).toEqual([]);
  });

  it("should initialize Run class with custom concurrency", () => {
    const opts = { cwd: dir, concurrency: 5 };
    const args = { script: "build" };
    const run = new Run(opts, args, graph);

    expect(run._concurrency).toBe(5);
  });

  it("should clamp concurrency to valid range", () => {
    const opts1 = { cwd: dir, concurrency: 0 };
    const run1 = new Run(opts1, { script: "test" }, graph);
    expect(run1._concurrency).toBe(3); // default when invalid

    const opts2 = { cwd: dir, concurrency: 101 };
    const run2 = new Run(opts2, { script: "test" }, graph);
    expect(run2._concurrency).toBe(3); // default when invalid

    const opts3 = { cwd: dir, concurrency: 50 };
    const run3 = new Run(opts3, { script: "test" }, graph);
    expect(run3._concurrency).toBe(50); // valid
  });

  it("should handle non-integer concurrency", () => {
    const opts = { cwd: dir, concurrency: 5.5 };
    const run = new Run(opts, { script: "test" }, graph);
    expect(run._concurrency).toBe(3); // default when not integer
  });

  it("should extract script args from options", () => {
    const opts = { cwd: dir, "--": ["arg1", "arg2"] };
    const args = { script: "test" };
    const run = new Run(opts, args, graph);

    expect(run._args).toEqual(["arg1", "arg2"]);
  });

  it("should get runner function based on stream option", () => {
    const opts1 = { cwd: dir, stream: true };
    const run1 = new Run(opts1, { script: "test" }, graph);
    const runner1 = run1.getRunner();
    expect(typeof runner1).toBe("function");

    const opts2 = { cwd: dir, stream: false };
    const run2 = new Run(opts2, { script: "test" }, graph);
    const runner2 = run2.getRunner();
    expect(typeof runner2).toBe("function");
  });

  it("should get opts for package", () => {
    const opts = { cwd: dir, prefix: true, bail: true, "--": ["arg1"] };
    const run = new Run(opts, { script: "test" }, graph);
    const pkg = { name: "test-pkg", path: "packages/test-pkg" };

    const pkgOpts = run.getOpts(pkg);
    expect(pkgOpts).toEqual({
      args: ["arg1"],
      npmClient: "npm",
      prefix: true,
      reject: true,
      pkg,
    });
  });

  it("should have graph and script initialized", () => {
    const opts = { cwd: dir };
    const run = new Run(opts, { script: "test" }, graph);

    // Verify the class was initialized correctly
    expect(run._script).toBe("test");
    expect(run._cwd).toBe(dir);
  });
});

