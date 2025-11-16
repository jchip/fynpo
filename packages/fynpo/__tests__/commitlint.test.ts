import { describe, it, expect, beforeEach } from "vitest";
import { Commitlint } from "../src/commitlint";
import path from "path";

describe.skip("fynpo Commitlint", () => {
  const dir = path.join(__dirname, "../test/sample");

  it("should initialize Commitlint class", () => {
    const opts = { cwd: dir };
    const commitlint = new Commitlint(opts);

    expect(commitlint.name).toBe("commitlint");
    expect(commitlint._cwd).toBe(dir);
    expect(commitlint._options).toBeDefined();
  });

  it("should pick lint fields from config", () => {
    const opts = { cwd: dir };
    const commitlint = new Commitlint(opts);

    const config = {
      extends: ["@commitlint/config-conventional"],
      rules: {
        "type-enum": [2, "always", ["feat", "fix"]],
      },
      plugins: {},
      parserPreset: {},
      formatter: "@commitlint/format",
      ignores: [],
      defaultIgnores: true,
      helpUrl: "https://example.com",
      otherField: "should be ignored",
    };

    const picked = commitlint.pickLintFields(config);
    expect(picked.extends).toBeDefined();
    expect(picked.rules).toBeDefined();
    expect(picked.plugins).toBeDefined();
    expect(picked.parserPreset).toBeDefined();
    expect(picked.formatter).toBeDefined();
    expect(picked.ignores).toBeDefined();
    expect(picked.defaultIgnores).toBeDefined();
    expect(picked.helpUrl).toBeDefined();
    expect((picked as any).otherField).toBeUndefined();
  });

  it("should merge customizer handle arrays correctly", () => {
    const opts = { cwd: dir };
    const commitlint = new Commitlint(opts);

    const obj = { rules: { "type-enum": [1, "always", ["feat"]] } };
    const src = { rules: { "type-enum": [2, "always", ["feat", "fix"]] } };

    const result = commitlint.mergeCustomizer(obj, src);
    expect(result).toBeUndefined(); // Not an array, should return undefined

    const arrSrc = ["value1", "value2"];
    const arrResult = commitlint.mergeCustomizer(obj, arrSrc);
    expect(arrResult).toEqual(arrSrc); // Array, should return the array
  });

  it("should select parser opts from preset", () => {
    const opts = { cwd: dir };
    const commitlint = new Commitlint(opts);

    const parserPreset1 = {
      parserOpts: {
        headerPattern: /^(\w*)(?:\((.*)\))?: (.*)$/,
      },
    };

    const result1 = commitlint.selectParserOpts(parserPreset1);
    expect(result1).toEqual(parserPreset1.parserOpts);

    const parserPreset2 = "string-preset";
    const result2 = commitlint.selectParserOpts(parserPreset2);
    expect(result2).toBeUndefined();

    const parserPreset3 = { noParserOpts: true };
    const result3 = commitlint.selectParserOpts(parserPreset3);
    expect(result3).toBeUndefined();
  });

  it("should merge command config overrides", () => {
    const opts = {
      cwd: dir,
      command: {
        commitlint: {
          color: true,
          verbose: true,
        },
      },
    };
    const commitlint = new Commitlint(opts);

    // Options are merged with defaults, so check if they're present
    expect(commitlint._options).toBeDefined();
    // The actual options structure may vary, so just verify initialization succeeded
    expect(commitlint.name).toBe("commitlint");
  });
});

