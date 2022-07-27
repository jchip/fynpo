import { describe, it, expect } from "@jest/globals";
import { processInput, processOutput } from "../src/caching";
import npmPacklist from "npm-packlist";
import _ from "lodash";

describe("caching", function () {
  const getInput = async () => {
    return await processInput({
      cwd: process.cwd(),
      input: {
        npmScripts: ["prepare", "prepublish", "build:release", "build"],
        include: ["**/src/**", "package.json", "**/*test*/**"],
        exclude: [
          "**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore|docs|docusaurus|packages|tmp|.etmp|samples|dist|dist-*|build)",
          "**/*.?(log|md)",
          "**/*test*/*",
          "**/*.?(test|spec).*",
        ],
        includeEnv: ["NODE_ENV"],
      },
    });
  };

  it("should create input data", async () => {
    const b = Date.now();
    const input = await getInput();
    const e = Date.now();

    const r = _.uniq(input.files.map((f) => f.split("/")[0])).sort();
    expect(r).toStrictEqual(["package.json", "src"]);

    const expectInput = {
      files: [
        "package.json",
        "src/caching.ts",
        "src/fynpo-config.ts",
        "src/fynpo-dep-graph.ts",
        "src/index.ts",
        "src/minimatch-group.ts",
        "src/test-read-fynpo-packages.ts",
        "src/util.ts",
      ],
      data: {
        env: { NODE_ENV: "test" },
        versions: {},
        npmScripts: { build: "rm -rf dist && tsc" },
        fileHashes: {
          "package.json": "VQo4UChJPO2XGkjGlGWMAZdWYzt2NzlW15t_7dH0tHE",
          "src/caching.ts": "Zu-Zjp9SAClM72XTfjITTFNMCDAjpxXENZCfyqU3jIw",
          "src/fynpo-config.ts": "mAsUoflw0MnDPE8iDc46lBAcdqsfPJuYhT6EgI0uP4A",
          "src/fynpo-dep-graph.ts": "MmlybPveo3T6uSDJj0LLgYFRtG2TjSY-d9oNhgLUNDU",
          "src/index.ts": "yoHkq_p4cev5WqsvL4Vazlv7d8InZPOwZmLSoyEqYdQ",
          "src/minimatch-group.ts": "UN5STAONMz_Qq-PwRfS8W7ujtgTyYSXVq5OrXvuURPY",
          "src/test-read-fynpo-packages.ts": "8O1tCcx4uVPR211o07W65DBdhfdFLCrvSuESIN-hY1k",
          "src/util.ts": "SAhJA0TTd9faCp_fcFKmna6eoTBOMrj3ZQGtMX0Ux0M",
        },
        extra: {},
      },
      hash: "cR7Y3vRLFOdq2vfKgxSCiWMLHyYpMAHqq6rnrR5J_kY",
    };
    expect(input).toEqual(expectInput);

    // console.log(res, "\n", e - b);
  });

  it("should create output files with result from npm pack list", async () => {
    const input = await getInput();
    const b = Date.now();
    const preFiles = await npmPacklist({
      path: process.cwd(),
    });
    const output = await processOutput({
      cwd: process.cwd(),
      inputHash: "deadbeef",
      output: {
        include: [],
        filesFromNpmPack: true,
        exclude: [
          "**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore|docs|docusaurus|packages|tmp|.etmp|samples)",
          "**/*.?(log|md)",
          "**/*test*/*",
          "**/*.?(test|spec).*",
        ],
      },
      preFiles,
    });
    const e = Date.now();
    const expectOutput = {
      files: [
        "LICENSE",
        "dist/caching.d.ts",
        "dist/caching.js",
        "dist/caching.js.map",
        "dist/fynpo-config.d.ts",
        "dist/fynpo-config.js",
        "dist/fynpo-config.js.map",
        "dist/fynpo-dep-graph.d.ts",
        "dist/fynpo-dep-graph.js",
        "dist/fynpo-dep-graph.js.map",
        "dist/index.d.ts",
        "dist/index.js",
        "dist/index.js.map",
        "dist/minimatch-group.d.ts",
        "dist/minimatch-group.js",
        "dist/minimatch-group.js.map",
        "dist/test-read-fynpo-packages.d.ts",
        "dist/test-read-fynpo-packages.js",
        "dist/test-read-fynpo-packages.js.map",
        "dist/util.d.ts",
        "dist/util.js",
        "dist/util.js.map",
        "package.json",
      ],
      data: { inputHash: "deadbeef", fileHashes: {} },
      hash: "",
      access: 0,
      create: 0,
    };
    // console.log("output", output, "\n", e - b);
    expect(output.access).toEqual(output.create);
    output.access = output.create = 0;
    expect(output).toEqual(expectOutput);
    const outputFiles = _.groupBy(output.files, (x: string) =>
      input.data.fileHashes[x] ? "both" : "output"
    );
    const expectOutFiles = {
      output: [
        "LICENSE",
        "dist/caching.d.ts",
        "dist/caching.js",
        "dist/caching.js.map",
        "dist/fynpo-config.d.ts",
        "dist/fynpo-config.js",
        "dist/fynpo-config.js.map",
        "dist/fynpo-dep-graph.d.ts",
        "dist/fynpo-dep-graph.js",
        "dist/fynpo-dep-graph.js.map",
        "dist/index.d.ts",
        "dist/index.js",
        "dist/index.js.map",
        "dist/minimatch-group.d.ts",
        "dist/minimatch-group.js",
        "dist/minimatch-group.js.map",
        "dist/test-read-fynpo-packages.d.ts",
        "dist/test-read-fynpo-packages.js",
        "dist/test-read-fynpo-packages.js.map",
        "dist/util.d.ts",
        "dist/util.js",
        "dist/util.js.map",
      ],
      both: ["package.json"],
    };
    expect(outputFiles).toEqual(expectOutFiles);
    // console.log("outputFiles", outputFiles);
  });
});
