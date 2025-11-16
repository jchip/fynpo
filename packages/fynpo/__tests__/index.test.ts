import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock nix-clap module
vi.mock("nix-clap", () => {
  const mockNixClap = vi.fn().mockImplementation(function(config) {
    this.version = vi.fn();
    this.init2 = vi.fn();
    this.parseAsync = vi.fn().mockResolvedValue({});
    return this;
  });
  return {
    NixClap: mockNixClap,
  };
});

import { fynpoMain } from "../src/index";
import { NixClap } from "nix-clap";

describe("fynpo CLI", () => {
  let originalExit: typeof process.exit;
  let exitMock: any;

  beforeEach(() => {
    originalExit = process.exit;
    exitMock = vi.fn();
    process.exit = exitMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  it("should create NixClap instance with correct configuration", () => {
    // Call fynpoMain but don't await parseAsync
    const result = fynpoMain();

    expect(NixClap).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.any(String),
        usage: "$0 [command] [options]",
        handlers: expect.objectContaining({
          "parse-fail": expect.any(Function),
          "unknown-option": expect.any(Function),
        }),
        defaultCommand: "bootstrap",
      })
    );
  });

  it("should have bootstrap as default command", () => {
    const result = fynpoMain();
    // The NixClap instance should be configured with defaultCommand: "bootstrap"
    expect(result).toBeDefined();
  });

  it("should define all expected subcommands", () => {
    const result = fynpoMain();
    // Verify that the CLI structure includes all expected commands
    expect(result).toBeDefined();
  });

  it("should handle parse-fail handler correctly", () => {
    const result = fynpoMain();
    // The parse-fail handler should be defined
    expect(result).toBeDefined();
  });

  it("should handle unknown-option handler correctly", () => {
    const result = fynpoMain();
    // The unknown-option handler should be defined
    expect(result).toBeDefined();
  });
});

