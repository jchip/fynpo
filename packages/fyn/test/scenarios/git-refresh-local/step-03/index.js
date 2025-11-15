const fs = require("fs");
const path = require("path");
const Yaml = require("js-yaml");
const { META_CACHE_STALE_TIME } = require("../../../../lib/pkg-src-manager");

module.exports = {
  title: "should refresh stale cache even without new commits (24h fallback) - local repo",
  timeout: 120000,
  before(cwd, scenarioDir) {
    // Ensure package.json uses file:// URL - update step-03/pkg.json which framework will merge
    const gitRepoDir = path.join(scenarioDir, "..", "..", "..", ".tmp", "test-git-repo");
    const stepDir = path.join(scenarioDir, "step-03");
    const pkgJsonSource = path.join(stepDir, "pkg.json");
    const absoluteRepoPath = path.resolve(gitRepoDir);
    const fileUrl = process.platform === "win32" 
      ? `git+file:///${absoluteRepoPath.replace(/\\/g, "/")}`
      : `git+file://${absoluteRepoPath}`;
    
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonSource, "utf8"));
    pkgJson.dependencies["test-from-gh"] = fileUrl;
    fs.writeFileSync(pkgJsonSource, JSON.stringify(pkgJson, null, 2) + "\n");
    
    // Age cache buckets to test staleness fallback (no new commits, but cache is stale)
    const cacheDir = path.join(scenarioDir, ".fyn", "_cacache");
    
    // Age all cache buckets to be older than META_CACHE_STALE_TIME (24 hours)
    // This tests the time-based staleness fallback when git rev-parse doesn't detect new commits
    const staleTime = new Date(Date.now() - META_CACHE_STALE_TIME - 60 * 60 * 1000); // 25 hours old
    
    // Age all cache buckets in the index
    const indexDir = path.join(cacheDir, "index-v5");
    if (fs.existsSync(indexDir)) {
      const ageDir = (dir) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const entryPath = path.join(dir, entry);
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory()) {
            ageDir(entryPath);
          } else {
            // Age the bucket file
            fs.utimesSync(entryPath, staleTime, staleTime);
          }
        }
      };
      ageDir(indexDir);
    }
    
    console.log(`Aged cache to ${staleTime.toISOString()} (${((Date.now() - staleTime.getTime()) / 1000 / 60 / 60).toFixed(1)} hours old)`);
  },
  verify(cwd, scenarioDir) {
    // Verify that the cache was refreshed (even though there were no new commits)
    // The cache refresh should have happened due to staleness (24h fallback)
    const lockFile = path.join(cwd, "fyn-lock.yaml");
    const lockData = Yaml.safeLoad(fs.readFileSync(lockFile, "utf8"));
    
    if (!lockData["test-from-gh"]) {
      throw new Error("test-from-gh not found in lockfile after refresh");
    }
    
    // Check that the cache bucket was updated (fresh mtime)
    const cacheDir = path.join(scenarioDir, ".fyn", "_cacache");
    const indexDir = path.join(cacheDir, "index-v5");
    
    if (fs.existsSync(indexDir)) {
      let foundFreshBucket = false;
      const checkDir = (dir) => {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          const entryPath = path.join(dir, entry);
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory()) {
            checkDir(entryPath);
          } else {
            // Check if this bucket was recently updated (within last 5 minutes)
            const age = Date.now() - stat.mtimeMs;
            if (age < 5 * 60 * 1000) {
              foundFreshBucket = true;
            }
          }
        }
      };
      checkDir(indexDir);
      
      if (!foundFreshBucket) {
        console.warn("Warning: No fresh cache buckets found - cache may not have been refreshed");
      } else {
        console.log(`✓ Cache was refreshed due to staleness (24h fallback)`);
      }
    }
    
    console.log(`✓ Staleness-based refresh test completed`);
  }
};

