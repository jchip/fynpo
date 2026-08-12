import { describe, it, expect, vi } from "vitest";

// Mock logger before importing utils
vi.mock("../src/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { makePublishFilter } from "../src/utils";

/** minimal shape PackageRef matches against */
const pkg = (name: string, path: string, version = "1.0.0") =>
  ({ name, path, version, id: `${name}@${version}` } as any);

const rc = (publish: any) => ({ command: { publish } });

const kernel = pkg("@fynmesh/kernel", "core/kernel");
const createFynapp = pkg("create-fynapp", "dev-tools/create-fynapp");
const wrapPlugin = pkg("rollup-wrap-plugin", "dev-tools/rollup-wrap-plugin");
const demoApp = pkg("fynapp-1", "demo/fynapp-1");
const esmReact = pkg("esm-react", "misc/esm-react-19", "19.2.8");
const sample = pkg("share-a", "rollup-federation/share-a-1.0");

describe("makePublishFilter", () => {
  it("allows everything when no config is set", () => {
    const filter = makePublishFilter({});
    expect(filter(kernel)).toBe(true);
    expect(filter(demoApp)).toBe(true);
  });

  it("allows everything when both lists are empty", () => {
    const filter = makePublishFilter(rc({ includePackages: [], excludePackages: [] }));
    expect(filter(demoApp)).toBe(true);
  });

  it("include list restricts to matching packages, by path glob", () => {
    const filter = makePublishFilter(
      rc({ includePackages: ["path:core/*", "path:dev-tools/*"] })
    );
    expect(filter(kernel)).toBe(true);
    expect(filter(createFynapp)).toBe(true);
    expect(filter(wrapPlugin)).toBe(true);
    expect(filter(demoApp)).toBe(false);
    expect(filter(esmReact)).toBe(false);
  });

  it("fails closed - a package under an unlisted path is not publishable", () => {
    const filter = makePublishFilter(rc({ includePackages: ["path:core/*"] }));
    expect(filter(pkg("fynapp-9", "demo/fynapp-9"))).toBe(false);
    expect(filter(pkg("brand-new", "brand-new-dir/thing"))).toBe(false);
  });

  it("exclude list removes packages", () => {
    const filter = makePublishFilter(rc({ excludePackages: ["path:demo/**"] }));
    expect(filter(kernel)).toBe(true);
    expect(filter(demoApp)).toBe(false);
  });

  it("exclude wins over include for the same package", () => {
    const filter = makePublishFilter(
      rc({
        includePackages: ["path:rollup-federation/*"],
        excludePackages: ["path:rollup-federation/share-*"],
      })
    );
    expect(filter(pkg("federation-js", "rollup-federation/federation-js"))).toBe(true);
    expect(filter(sample)).toBe(false);
  });

  it("matches by bare name and by explicit name: ref", () => {
    const filter = makePublishFilter(
      rc({ includePackages: ["@fynmesh/kernel", "name:create-fynapp"] })
    );
    expect(filter(kernel)).toBe(true);
    expect(filter(createFynapp)).toBe(true);
    expect(filter(demoApp)).toBe(false);
  });

  it("matches by id: ref", () => {
    const filter = makePublishFilter(rc({ includePackages: ["id:esm-react@19.2.8"] }));
    expect(filter(esmReact)).toBe(true);
    expect(filter(kernel)).toBe(false);
  });

  it("supports regex refs on path", () => {
    const filter = makePublishFilter(rc({ excludePackages: ["path:/^demo\\//"] }));
    expect(filter(demoApp)).toBe(false);
    expect(filter(kernel)).toBe(true);
  });

  it("tolerates a single string instead of an array", () => {
    const filter = makePublishFilter(rc({ includePackages: "path:core/*" }));
    expect(filter(kernel)).toBe(true);
    expect(filter(demoApp)).toBe(false);
  });

  it("ignores empty and non-string entries", () => {
    const filter = makePublishFilter(
      rc({ includePackages: ["path:core/*", "", "   ", null, undefined] as any })
    );
    expect(filter(kernel)).toBe(true);
    expect(filter(demoApp)).toBe(false);
  });

  it("returns false for a missing package", () => {
    const filter = makePublishFilter(rc({ includePackages: ["path:core/*"] }));
    expect(filter(undefined as any)).toBe(false);
  });

  it("the fynmesh config publishes exactly its five packages", () => {
    const filter = makePublishFilter(
      rc({
        includePackages: [
          "path:core/*",
          "path:dev-tools/*",
          "path:rollup-federation/federation-js",
          "path:rollup-federation/rollup-plugin-federation",
        ],
      })
    );
    const publishable = [
      kernel,
      createFynapp,
      wrapPlugin,
      pkg("federation-js", "rollup-federation/federation-js"),
      pkg("rollup-plugin-federation", "rollup-federation/rollup-plugin-federation"),
    ];
    const excluded = [
      demoApp,
      esmReact,
      sample,
      pkg("bundle-esm-share", "demo-rollup-externals/bundle-esm-share"),
      pkg("react-federation", "rollup-federation/sample-react-federation"),
    ];
    expect(publishable.filter(filter)).toHaveLength(5);
    expect(excluded.filter(filter)).toHaveLength(0);
  });
});
