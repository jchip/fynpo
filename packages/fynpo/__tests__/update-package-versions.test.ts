import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger
vi.mock("../src/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { updatePackageVersions } from "../src/utils/update-package-versions";
import { FynpoDepGraph } from "@fynpo/base";
import path from "path";
import fs from "fs";
import os from "os";

const writeJson = (file: string, obj: any) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf-8"));

describe("updatePackageVersions", () => {
  let cwd: string;

  const pkgAFile = () => path.join(cwd, "packages/pkg-a/package.json");
  const pkgBFile = () => path.join(cwd, "packages/pkg-b/package.json");

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "fynpo-upv-"));
    writeJson(path.join(cwd, "package.json"), { name: "root", version: "0.0.0", private: true });
    writeJson(pkgAFile(), { name: "pkg-a", version: "1.0.0" });
    writeJson(pkgBFile(), {
      name: "pkg-b",
      version: "1.0.0",
      dependencies: { "pkg-a": "^1.0.0" },
    });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const makeCollated = async () => {
    const graph = new FynpoDepGraph({ cwd, patterns: ["packages/*"] });
    await graph.resolve();
    return { opts: { graph, cwd, fynpoRc: {} } };
  };

  it("writes bumped versions to package.json files sourced from the dep graph", async () => {
    const collated = await makeCollated();
    const versions = { "pkg-a": "2.0.0", "pkg-b": "1.1.0" };
    const tags = ["pkg-a@2.0.0", "pkg-b@1.1.0"];

    const result: any = await updatePackageVersions({ versions, tags, collated });

    // regression: previously read the never-populated collated.opts.data and was a no-op
    expect(readJson(pkgAFile()).version).toBe("2.0.0");
    expect(readJson(pkgBFile()).version).toBe("1.1.0");
    // a dependent's semver range on a bumped dep is updated (preserving ^)
    expect(readJson(pkgBFile()).dependencies["pkg-a"]).toBe("^2.0.0");
    // returns the changed package.json paths + passes tags through
    expect(result.packages).toEqual(
      expect.arrayContaining([
        path.join("packages", "pkg-a", "package.json"),
        path.join("packages", "pkg-b", "package.json"),
      ])
    );
    expect(result.tags).toBe(tags);
  });

  it("skips a package whose new version equals its current version", async () => {
    const collated = await makeCollated();

    const result: any = await updatePackageVersions({
      versions: { "pkg-a": "1.0.0" },
      tags: [],
      collated,
    });

    expect(readJson(pkgAFile()).version).toBe("1.0.0");
    expect(result.packages).toEqual([]);
  });

  it("does not touch package.json for packages not in the versions map", async () => {
    const collated = await makeCollated();

    await updatePackageVersions({
      versions: { "pkg-a": "2.0.0" },
      tags: ["pkg-a@2.0.0"],
      collated,
    });

    expect(readJson(pkgAFile()).version).toBe("2.0.0");
    // pkg-b was not bumped - it keeps its original version and dep range
    expect(readJson(pkgBFile()).version).toBe("1.0.0");
    expect(readJson(pkgBFile()).dependencies["pkg-a"]).toBe("^1.0.0");
  });

  it("returns undefined when there are no versions", async () => {
    const collated = await makeCollated();
    const result = await updatePackageVersions({ versions: {}, tags: [], collated });
    expect(result).toBeUndefined();
  });
});
