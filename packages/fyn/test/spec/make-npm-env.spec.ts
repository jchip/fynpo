"use strict";

const { initEnv, makeNpmEnv } = require("../../lib/util/make-npm-env");

describe("make-npm-env", function() {
  describe("initEnv", () => {
    it("should filter out npm_ variables from source env", () => {
      const fromEnv = {
        PATH: "/usr/bin",
        NORMAL: "value",
        npm_config_foo: "1",
        npm_package_name: "bar"
      };
      const env = initEnv(fromEnv, false);
      expect(env.PATH).to.equal("/usr/bin");
      expect(env.NORMAL).to.equal("value");
      expect(env).to.not.have.property("npm_config_foo");
      expect(env).to.not.have.property("npm_package_name");
    });

    it("should set NODE_ENV to production when production is truthy", () => {
      const env = initEnv({ FOO: "bar" }, true);
      expect(env.NODE_ENV).to.equal("production");
      expect(env.FOO).to.equal("bar");
    });

    it("should not set NODE_ENV to production when production is falsy", () => {
      const env = initEnv({ FOO: "bar" }, false);
      expect(env.NODE_ENV).to.equal(undefined);
      expect(env.FOO).to.equal("bar");
    });

    it("should not set NODE_ENV to production when production is undefined", () => {
      const env = initEnv({ FOO: "bar" });
      expect(env.NODE_ENV).to.equal(undefined);
      expect(env.FOO).to.equal("bar");
    });

    it("should default to process.env when fromEnv is omitted", () => {
      const env = initEnv();
      expect(env).to.be.an("object");
      const npmKeys = Object.keys(env).filter(k => k.match(/^npm_/));
      expect(npmKeys).to.deep.equal([]);
    });
  });

  describe("makeNpmEnv", () => {
    it("should build env with default opts and prefix", () => {
      const env = makeNpmEnv({ name: "pkg", version: "1.2.3" });
      expect(env).to.be.an("object");
      expect(env.npm_package_name).to.equal("pkg");
      expect(env.npm_package_version).to.equal("1.2.3");
      const npmKeys = Object.keys(env).filter(
        k => k.match(/^npm_/) && k !== "npm_package_name" && k !== "npm_package_version"
      );
      expect(npmKeys).to.deep.equal([]);
    });

    it("should use production from opts when creating base env", () => {
      const env = makeNpmEnv({ name: "pkg", version: "1.0.0" }, { production: true });
      expect(env.NODE_ENV).to.equal("production");
    });

    it("should honor an explicit prefix argument", () => {
      const env = makeNpmEnv({ name: "pkg", version: "1.0.0" }, {}, "custom_prefix_");
      expect(env.npm_package_name).to.equal("pkg");
    });

    it("should define non-enumerable _lifecycleEnv on data when env is passed", () => {
      const data = { name: "pkg", version: "2.0.0" };
      const baseEnv = { PATH: "/bin" };
      const env = makeNpmEnv(data, {}, "npm_package_", baseEnv);

      expect(env).to.equal(baseEnv);
      expect(env.npm_package_name).to.equal("pkg");
      expect(env.npm_package_version).to.equal("2.0.0");

      const desc = Object.getOwnPropertyDescriptor(data, "_lifecycleEnv");
      expect(desc).to.exist;
      expect(desc.enumerable).to.equal(false);
      expect(desc.value).to.equal(baseEnv);
      expect(Object.keys(data)).to.not.include("_lifecycleEnv");
    });

    it("should not redefine _lifecycleEnv when data already has it", () => {
      const data = { name: "pkg", version: "3.0.0" };
      const firstEnv = { PATH: "/bin" };
      makeNpmEnv(data, {}, "npm_package_", firstEnv);

      const secondEnv = { PATH: "/usr/bin" };
      const env = makeNpmEnv(data, {}, "npm_package_", secondEnv);

      expect(env).to.equal(secondEnv);
      expect(env.npm_package_name).to.equal("pkg");
      const desc = Object.getOwnPropertyDescriptor(data, "_lifecycleEnv");
      expect(desc.value).to.equal(firstEnv);
    });

    it("should set NODE_OPTIONS from opts.nodeOptions", () => {
      const env = makeNpmEnv({ name: "pkg", version: "1.0.0" }, { nodeOptions: "--max-old-space-size=512" });
      expect(env.NODE_OPTIONS).to.equal("--max-old-space-size=512");
    });

    it("should add npm_config_* vars from opts.config with camelCase and snake_case keys", () => {
      const config = {
        globalPrefix: "/usr/local",
        userAgent: "npm/11",
        cache: "/home/user/.npm",
        global_prefix: "/opt",
        randomKey: "ignored"
      };
      const env = makeNpmEnv({ name: "pkg", version: "1.0.0" }, { config });

      expect(env.npm_config_global_prefix).to.equal("/opt");
      expect(env.npm_config_user_agent).to.equal("npm/11");
      expect(env.npm_config_cache).to.equal("/home/user/.npm");
      expect(env).to.not.have.property("npm_config_random_key");
    });

    it("should coerce non-string config values to strings", () => {
      const env = makeNpmEnv(
        { name: "pkg", version: "1.0.0" },
        { config: { npmVersion: 11 } }
      );
      expect(env.npm_config_npm_version).to.equal("11");
    });

    it("should skip null, undefined and function config values", () => {
      const config = {
        cache: null,
        prefix: undefined,
        nodeGyp: () => "fn",
        userAgent: "npm/11"
      };
      const env = makeNpmEnv({ name: "pkg", version: "1.0.0" }, { config });

      expect(env).to.not.have.property("npm_config_cache");
      expect(env).to.not.have.property("npm_config_prefix");
      expect(env).to.not.have.property("npm_config_node_gyp");
      expect(env.npm_config_user_agent).to.equal("npm/11");
    });

    it("should set npm_package_name and npm_package_version from data", () => {
      const env = makeNpmEnv({ name: "my-pkg", version: "4.5.6" });
      expect(env.npm_package_name).to.equal("my-pkg");
      expect(env.npm_package_version).to.equal("4.5.6");
    });

    it("should not set npm_package_* when data lacks name and version", () => {
      const env = makeNpmEnv({});
      expect(env).to.not.have.property("npm_package_name");
      expect(env).to.not.have.property("npm_package_version");
    });
  });
});
