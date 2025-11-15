const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

module.exports = {
  title: "should install git dependency from local repo and create cache",
  before(cwd, scenarioDir) {
    console.log(`Step 1 before: cwd=${cwd}, scenarioDir=${scenarioDir}`);
    // Create a local git repository fixture in .tmp (gitignored)
    const gitRepoDir = path.join(scenarioDir, "..", "..", "..", ".tmp", "test-git-repo");
    console.log(`Git repo dir: ${gitRepoDir}`);
    console.log(`Resolved git repo dir: ${path.resolve(gitRepoDir)}`);
    
    // Initialize git repo if it doesn't exist
    if (!fs.existsSync(gitRepoDir)) {
      fs.mkdirSync(gitRepoDir, { recursive: true });
      
      // Create a basic package structure
      const pkgJson = {
        name: "test-from-gh",
        version: "1.0.0",
        main: "src/index.js"
      };
      fs.writeFileSync(
        path.join(gitRepoDir, "package.json"),
        JSON.stringify(pkgJson, null, 2) + "\n"
      );
      
      // Create src/index.js
      const srcDir = path.join(gitRepoDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "index.js"),
        "module.exports = { version: '1.0.0' };\n"
      );
      
      // Create README.md
      fs.writeFileSync(
        path.join(gitRepoDir, "README.md"),
        "# test-from-gh\n\nTest git repository\n"
      );
      
      // Create hello file
      fs.writeFileSync(
        path.join(gitRepoDir, "hello"),
        "world\n"
      );
      
      // Initialize git repo
      execSync("git init", { cwd: gitRepoDir, stdio: "pipe" });
      execSync("git config user.name 'Test User'", { cwd: gitRepoDir, stdio: "pipe" });
      execSync("git config user.email 'test@example.com'", { cwd: gitRepoDir, stdio: "pipe" });
      execSync("git add .", { cwd: gitRepoDir, stdio: "pipe" });
      execSync("git commit -m 'Initial commit'", { cwd: gitRepoDir, stdio: "pipe" });
      execSync("git branch -M main", { cwd: gitRepoDir, stdio: "pipe" });
    }
    
    // The framework merges pkg.json AFTER before hook runs
    // So we need to update step-01/pkg.json which will be merged into package.json
    const stepDir = path.join(scenarioDir, "step-01");
    const pkgJsonSource = path.join(stepDir, "pkg.json");

    if (!fs.existsSync(pkgJsonSource)) {
      throw new Error(`pkg.json not found at ${pkgJsonSource}`);
    }
    
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonSource, "utf8"));
    
    // Use file:// URL format - need absolute path
    const absoluteRepoPath = path.resolve(gitRepoDir);
    // On Windows, file:// URLs need forward slashes and 3 slashes for absolute paths
    const fileUrl = process.platform === "win32" 
      ? `git+file:///${absoluteRepoPath.replace(/\\/g, "/")}`
      : `git+file://${absoluteRepoPath}`;
    
    pkgJson.dependencies["test-from-gh"] = fileUrl;
    
    // Write to step-01/pkg.json - framework will merge this into package.json after before hook
    fs.writeFileSync(pkgJsonSource, JSON.stringify(pkgJson, null, 2) + "\n");

    console.log(`Using local git repo: ${fileUrl}`);
  }
};

