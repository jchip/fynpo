import { describe, it, expect, beforeAll } from "vitest";
import { Updated } from "../src/updated";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

describe.skip("fynpo Updated", () => {
  const dir = path.join(__dirname, "../test/sample");
  let graph: FynpoDepGraph;

  beforeAll(async () => {
    graph = new FynpoDepGraph({ cwd: path.join(__dirname, "../test/sample") });
    await graph.resolve();
  });

  it("should initialize Updated class", () => {
    const opts = { cwd: dir };
    const updated = new Updated(opts, graph);

    expect(updated.name).toBe("updated");
    expect(updated._cwd).toBe(dir);
    expect(updated._graph).toBe(graph);
    expect(updated._options).toBeDefined();
  });

  it("should handle version locks with wildcard", () => {
    const opts = { cwd: dir, versionLocks: ["*"] };
    const updated = new Updated(opts, graph);

    expect(updated._versionLockMap).toBeDefined();
  });

  it("should handle version locks with specific patterns", () => {
    const opts = { cwd: dir, versionLocks: [["name:/pkg1/"]] };
    const updated = new Updated(opts, graph);

    expect(updated._versionLockMap).toBeDefined();
  });

  it("should handle empty version locks", () => {
    const opts = { cwd: dir, versionLocks: [] };
    const updated = new Updated(opts, graph);

    expect(updated._versionLockMap).toBeDefined();
  });

  it("should merge command config overrides", () => {
    const opts = {
      cwd: dir,
      command: {
        updated: {
          someOption: "value",
        },
      },
    };
    const updated = new Updated(opts, graph);

    expect(updated._options.someOption).toBe("value");
  });

  it("should exec and handle no changed packages", () => {
    const opts = { cwd: dir };
    const updated = new Updated(opts, graph);

    // Mock getUpdatedPackages to return empty array
    const originalGetUpdatedPackages = require("../src/utils/get-updated-packages").getUpdatedPackages;
    jest.spyOn(require("../src/utils/get-updated-packages"), "getUpdatedPackages").mockReturnValue({
      pkgs: [],
    });

    const loggerSpy = jest.spyOn(require("../src/logger").logger, "info").mockImplementation();

    updated.exec();

    expect(loggerSpy).toHaveBeenCalledWith("No changed packages!");

    jest.restoreAllMocks();
  });
});

