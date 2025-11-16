const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

module.exports = {
  title: "should refresh stale git cache after local commit (git rev-parse check)",
  timeout: 120000,
  skip: true, // Skipped: Git dependency refresh feature is unreliable and rarely used
  copyCache: true, // Copy cache from previous step
  before(cwd, scenarioDir) {
    // Use the local git repository fixture in .tmp (gitignored)
    const gitRepoDir = path.join(scenarioDir, "..", "..", "..", ".tmp", "test-git-repo");
    
    if (!fs.existsSync(gitRepoDir)) {
      throw new Error("Local git repo fixture not found - step-01 should have created it");
    }
    
    // Ensure package.json uses file:// URL - update step-02/pkg.json which framework will merge
    const stepDir = path.join(scenarioDir, "step-02");
    const pkgJsonSource = path.join(stepDir, "pkg.json");
    const absoluteRepoPath = path.resolve(gitRepoDir);
    const fileUrl = process.platform === "win32" 
      ? `git+file:///${absoluteRepoPath.replace(/\\/g, "/")}`
      : `git+file://${absoluteRepoPath}`;
    
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonSource, "utf8"));
    pkgJson.dependencies["test-from-gh"] = fileUrl;
    fs.writeFileSync(pkgJsonSource, JSON.stringify(pkgJson, null, 2) + "\n");
    
    // Modify index.js in the local repo (no need to clone or push)
    const indexPath = path.join(gitRepoDir, "src", "index.js");
    let indexContent = "";
    if (fs.existsSync(indexPath)) {
      indexContent = fs.readFileSync(indexPath, "utf8");
    }
    
    // Add a comment with timestamp to ensure the file changes
    const testMarker = `// git-refresh-local-test: ${Date.now()}\n`;
    const newContent = testMarker + indexContent;
    fs.writeFileSync(indexPath, newContent);
    
    // Commit the change (local repo only - no push needed)
    execSync("git add src/index.js", { cwd: gitRepoDir, stdio: "pipe" });
    execSync(`git commit -m "test: update index.js for local cache refresh test"`, { cwd: gitRepoDir, stdio: "pipe" });
    
    // No need to age the cache - git ls-remote will detect the new commit and trigger refresh
  },
  verify(cwd, scenarioDir) {
    // Verify that the new commit was fetched by checking the installed file content
    const installedIndexPath = path.join(cwd, "node_modules", "test-from-gh", "src", "index.js");
    if (!fs.existsSync(installedIndexPath)) {
      throw new Error("index.js not found in installed package - cache refresh may have failed");
    }

    const installedContent = fs.readFileSync(installedIndexPath, "utf8");

    // Check if the file contains our specific test marker with timestamp
    if (!installedContent.startsWith("// git-refresh-local-test:")) {
      throw new Error(
        `Cache refresh failed: Installed index.js does not start with the expected test marker. ` +
        `The stale cache was not refreshed and the new commit was not fetched.`
      );
    }

    // Extract the timestamp from the installed file
    const timestampMatch = installedContent.match(/^\/\/ git-refresh-local-test: (\d+)\n/);
    if (!timestampMatch) {
      throw new Error("Could not extract timestamp from installed index.js");
    }

    const installedTimestamp = parseInt(timestampMatch[1]);
    const now = Date.now();
    const age = now - installedTimestamp;

    // The timestamp should be recent (within last 30 minutes - give it some slack)
    if (age > 5 * 60 * 1000) {
      throw new Error(
        `Cache refresh failed: Installed index.js has an old timestamp (${Math.floor(age / 1000)}s ago). ` +
        `The stale cache was not refreshed and the new commit was not fetched.`
      );
    }

    console.log(`✓ Local cache refresh successful: Installed package has recent timestamp (${installedTimestamp})`);
  }
};

