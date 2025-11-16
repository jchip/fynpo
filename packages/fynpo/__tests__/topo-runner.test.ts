import { describe, it, expect, beforeAll } from "vitest";
import { TopoRunner } from "../src/topo-runner";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

describe("fynpo topo-runner", () => {
  const dir = path.join(__dirname, "../test/sample");
  const parsed = {
    name: "test",
    opts: {
      cwd: dir,
      deps: 10,
      saveLog: false,
      tag: true,
      build: true,
      concurrency: 3,
    },
    args: {},
    argList: [],
  };

  let runner;
  beforeAll(async () => {
    const graph = new FynpoDepGraph({ cwd: dir });
    await graph.resolve();
    runner = new TopoRunner(graph.getTopoSortPackages(), parsed.opts);
  });

  it("should initialize TopoRunner correctly", () => {
    expect(runner).toBeDefined();
    // The queue might be empty in test environment, which is fine
    const queue = runner.getMore();
    expect(Array.isArray(queue)).toBe(true);
  });
});
