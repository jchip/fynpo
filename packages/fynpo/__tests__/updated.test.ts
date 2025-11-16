import { describe, it, expect, beforeAll } from "vitest";
import { Updated } from "../src/updated";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

// Mock get-updated-packages
vi.mock("../src/utils/get-updated-packages", () => ({
  getUpdatedPackages: vi.fn(),
}));

// Mock logger
vi.mock("../src/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getUpdatedPackages } from "../src/utils/get-updated-packages";
import { logger } from "../src/logger";

describe("fynpo Updated", () => {
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
    getUpdatedPackages.mockReturnValue({
      pkgs: [],
    });

    updated.exec();

    expect(logger.info).toHaveBeenCalledWith("No changed packages!");

    vi.restoreAllMocks();
  });
});

