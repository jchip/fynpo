import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Init } from "../src/init";
import path from "path";
import fs from "fs";
import shcmd from "shcmd";

describe("fynpo Init", () => {
  const dir = path.join(__dirname, "../test/sample");
  const packageJsonPath = path.join(dir, "package.json");

  beforeEach(() => {
    // Ensure package.json exists
    if (!fs.existsSync(packageJsonPath)) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify({
          name: "test-repo",
          version: "1.0.0",
        })
      );
    }
  });

  afterEach(() => {
    // Clean up created files
    const fynpoConfigJs = path.join(dir, "fynpo.config.js");
    if (fs.existsSync(fynpoConfigJs)) {
      shcmd.rm("-f", fynpoConfigJs);
    }
  });

  it("should initialize Init class", () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    expect(init.name).toBe("init");
    // Init class loads config which may change the cwd
    expect(init._cwd).toBeDefined();
    expect(init._options).toBeDefined();
  });

  it("should check if git is initialized", async () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    const isGit = await init.isGitInitialized();
    expect(typeof isGit).toBe("boolean");
  });

  it("should add dependency to package.json", () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    const rootPkg = {
      name: "test-repo",
      version: "1.0.0",
      dependencies: {
        "test-dep": "0.9.0"
      },
    };

    init.addDependency(rootPkg, "test-dep", "1.0.0");
    expect(rootPkg.dependencies["test-dep"]).toBe("^1.0.0");
  });

  it("should add dependency to devDependencies if not in dependencies", () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    const rootPkg: any = {
      name: "test-repo",
      version: "1.0.0",
      dependencies: {},
    };

    init.addDependency(rootPkg, "test-dev-dep", "2.0.0");
    expect(rootPkg.devDependencies).toBeDefined();
    expect(rootPkg.devDependencies["test-dev-dep"]).toBe("^2.0.0");
  });

  it("should update existing dependency", () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    const rootPkg: any = {
      name: "test-repo",
      version: "1.0.0",
      dependencies: {
        "existing-dep": "1.0.0",
      },
    };

    init.addDependency(rootPkg, "existing-dep", "2.0.0");
    expect(rootPkg.dependencies["existing-dep"]).toBe("^2.0.0");
    expect(rootPkg.devDependencies).toBeUndefined();
  });

  it("should add packages directory", async () => {
    const opts = { cwd: dir };
    const init = new Init(opts);

    const packagesDir = path.join(init._cwd, "packages");
    
    await init.addPackagesDirs();
    expect(fs.existsSync(packagesDir)).toBe(true);
  });

  it("should update package.json with commitlint dependencies", () => {
    const opts = { cwd: dir, commitlint: true };
    const init = new Init(opts);

    const originalPkg = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    init.updatePackageJson();

    const updatedPkg = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    // Check that dependencies or devDependencies were updated
    const hasCommitlint = 
      updatedPkg.dependencies?.["@commitlint/config-conventional"] || 
      updatedPkg.devDependencies?.["@commitlint/config-conventional"];
    const hasHusky = 
      updatedPkg.dependencies?.husky || 
      updatedPkg.devDependencies?.husky;
    
    expect(hasCommitlint).toBeTruthy();
    expect(hasHusky).toBeTruthy();
    expect(updatedPkg.scripts.prepare).toContain("husky install");

    // Restore original
    fs.writeFileSync(packageJsonPath, JSON.stringify(originalPkg, null, 2) + "\n");
  });

  it("should not update package.json without commitlint option", () => {
    const opts = { cwd: dir, commitlint: false };
    const init = new Init(opts);

    const originalPkg = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    init.updatePackageJson();

    const updatedPkg = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    expect(updatedPkg).toEqual(originalPkg);
  });
});

