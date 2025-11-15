const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Yaml = require("js-yaml");

module.exports = {
  title: "should install GitHub package after repo changes (ls-remote detection)",
  timeout: 120000,
  before(cwd, scenarioDir) {
    // Read git semver from lockfile
    const lockFile = path.join(cwd, "fyn-lock.yaml");
    const lockData = Yaml.safeLoad(fs.readFileSync(lockFile, "utf8"));
    const gitSemver = Object.keys(lockData["test-from-gh"]._)[0]; // e.g., "jchip/test-from-gh"
    
    // Extract repo URL from git semver (use SSH format for push)
    const repoUrl = `git@github.com:${gitSemver}.git`;
    
    // Clone repo, checkout the commit that matches installed version, then bump
    const tempRepoDir = path.join(scenarioDir, ".temp-repo");
    if (fs.existsSync(tempRepoDir)) {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
    }
    
    execSync(`git clone ${repoUrl} ${tempRepoDir}`, { stdio: "pipe" });
    
    // Get branch name
    let branchName = "main";
    try {
      const branchInfo = execSync("git ls-remote --symref origin HEAD", {
        cwd: tempRepoDir,
        stdio: "pipe",
        encoding: "utf8"
      });
      branchName = branchInfo.match(/refs\/heads\/(\S+)/)?.[1] || "main";
    } catch (e) {
      // Default to main
    }
    
    execSync(`git checkout ${branchName}`, { cwd: tempRepoDir, stdio: "pipe" });
    
    // Modify index.js instead of changing package.json version
    const indexPath = path.join(tempRepoDir, "src", "index.js");
    let indexContent = "";
    if (fs.existsSync(indexPath)) {
      indexContent = fs.readFileSync(indexPath, "utf8");
    }
    
    // Add a comment with timestamp to ensure the file changes
    const testMarker = `// git-refresh-test: ${Date.now()}\n`;
    const newContent = testMarker + indexContent;
    fs.writeFileSync(indexPath, newContent);
    
    execSync("git add src/index.js", { cwd: tempRepoDir, stdio: "pipe" });
    execSync(`git commit -m "test: update index.js for cache refresh test"`, { cwd: tempRepoDir, stdio: "pipe" });
    execSync(`git push origin ${branchName}`, { cwd: tempRepoDir, stdio: "pipe" });
    
    // No need to age the cache - git ls-remote will detect the new commit and trigger refresh
    fs.rmSync(tempRepoDir, { recursive: true, force: true });
  },
  verify(cwd, scenarioDir) {
    // Verify that the new commit was fetched by checking the installed file content
    const installedIndexPath = path.join(cwd, "node_modules", "test-from-gh", "src", "index.js");
    if (!fs.existsSync(installedIndexPath)) {
      throw new Error("index.js not found in installed package - cache refresh may have failed");
    }

    const installedContent = fs.readFileSync(installedIndexPath, "utf8");

    // Check if the file contains our specific test marker with timestamp
    if (!installedContent.startsWith("// git-refresh-test:")) {
      throw new Error(
        `Cache refresh failed: Installed index.js does not start with the expected test marker. ` +
        `The stale cache was not refreshed and the new commit was not fetched.`
      );
    }

    // Extract the timestamp from the installed file
    const timestampMatch = installedContent.match(/^\/\/ git-refresh-test: (\d+)\n/);
    if (!timestampMatch) {
      throw new Error("Could not extract timestamp from installed index.js");
    }

    const installedTimestamp = parseInt(timestampMatch[1]);
    const now = Date.now();
    const age = now - installedTimestamp;

    // The timestamp should be recent (within last 5 minutes)
    if (age > 5 * 60 * 1000) {
      throw new Error(
        `Cache refresh failed: Installed index.js has an old timestamp (${Math.floor(age / 1000)}s ago). ` +
        `The stale cache was not refreshed and the new commit was not fetched.`
      );
    }

    console.log(`✓ Cache refresh successful: Installed package has recent timestamp (${installedTimestamp})`);
  }
};
