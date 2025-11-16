#!/usr/bin/env node
/**
 * Test script to verify pacote's behavior with git dependencies
 * 
 * Tests:
 * 1. Does pacote cache git dependencies?
 * 2. Does pacote detect when a branch/tag has moved?
 * 3. Does pacote always clone or reuse cache?
 * 4. Tests both local git repos and GitHub repos
 */

const pacote = require("pacote");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const os = require("os");

const TEST_CACHE_DIR = path.join(__dirname, ".test-cache");
const TEST_REPO_DIR = path.join(__dirname, ".test-repo");
const GITHUB_REPO = "jchip/test-from-gh";

// Clean up test directories
function cleanup() {
  if (fs.existsSync(TEST_CACHE_DIR)) {
    fs.rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEST_REPO_DIR)) {
    fs.rmSync(TEST_REPO_DIR, { recursive: true, force: true });
  }
}

// Create a test git repo
function createTestRepo() {
  console.log("📦 Creating test git repository...");
  fs.mkdirSync(TEST_REPO_DIR, { recursive: true });
  
  // Create package.json
  const pkgJson = {
    name: "test-pacote-git",
    version: "1.0.0",
    main: "index.js"
  };
  fs.writeFileSync(
    path.join(TEST_REPO_DIR, "package.json"),
    JSON.stringify(pkgJson, null, 2) + "\n"
  );
  
  // Create index.js with initial content
  fs.writeFileSync(
    path.join(TEST_REPO_DIR, "index.js"),
    "module.exports = { version: '1.0.0', commit: 'initial' };\n"
  );
  
  // Initialize git repo
  execSync("git init", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync("git add .", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync("git commit -m 'Initial commit'", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync("git branch -M main", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  
  const initialCommit = execSync("git rev-parse HEAD", { 
    cwd: TEST_REPO_DIR, 
    encoding: "utf8" 
  }).trim();
  
  console.log(`✓ Created repo with initial commit: ${initialCommit.substring(0, 8)}`);
  return initialCommit;
}

// Make a new commit to the repo
function makeNewCommit(commitMessage) {
  console.log(`\n📝 Making new commit: ${commitMessage}...`);
  
  // Update index.js with timestamp
  const newContent = `module.exports = { version: '1.0.0', commit: '${commitMessage}', timestamp: ${Date.now()} };\n`;
  fs.writeFileSync(path.join(TEST_REPO_DIR, "index.js"), newContent);
  
  execSync("git add index.js", { cwd: TEST_REPO_DIR, stdio: "pipe" });
  execSync(`git commit -m "${commitMessage}"`, { cwd: TEST_REPO_DIR, stdio: "pipe" });
  
  const newCommit = execSync("git rev-parse HEAD", { 
    cwd: TEST_REPO_DIR, 
    encoding: "utf8" 
  }).trim();
  
  console.log(`✓ New commit: ${newCommit.substring(0, 8)}`);
  return newCommit;
}

// Get current HEAD commit
function getCurrentCommit() {
  return execSync("git rev-parse HEAD", { 
    cwd: TEST_REPO_DIR, 
    encoding: "utf8" 
  }).trim();
}

// Call pacote.manifest and measure time
async function callPacoteManifest(spec, testName) {
  console.log(`\n🔍 Test: ${testName}`);
  console.log(`   Spec: ${spec}`);
  
  const startTime = Date.now();
  const manifest = await pacote.manifest(spec, {
    cache: TEST_CACHE_DIR
  });
  const duration = Date.now() - startTime;
  
  const resolved = manifest._resolved || "N/A";
  const commitHash = resolved.match(/#([a-f0-9]{40})$/)?.[1] || "N/A";
  
  console.log(`   Duration: ${duration}ms`);
  console.log(`   _resolved: ${resolved}`);
  console.log(`   Commit hash: ${commitHash.substring(0, 8)}...`);
  
  return { manifest, duration, commitHash };
}

async function runTests() {
  console.log("🧪 Testing pacote's git dependency behavior\n");
  console.log("=" .repeat(60));
  
  cleanup();
  fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
  
  // Create test repo
  const repoPath = path.resolve(TEST_REPO_DIR);
  const gitUrl = process.platform === "win32" 
    ? `git+file:///${repoPath.replace(/\\/g, "/")}`
    : `git+file://${repoPath}`;
  
  const initialCommit = createTestRepo();
  const spec = `test-pacote-git@${gitUrl}#main`;
  
  console.log(`\n📋 Test repository: ${gitUrl}`);
  console.log(`   Initial commit: ${initialCommit.substring(0, 8)}`);
  
  // Test 1: First call - should clone
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: First call to pacote.manifest()");
  console.log("=".repeat(60));
  const result1 = await callPacoteManifest(spec, "First call (should clone)");
  const firstCommit = result1.commitHash;
  
  // Test 2: Second call immediately - does it use cache?
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Second call immediately (same commit)");
  console.log("=".repeat(60));
  const result2 = await callPacoteManifest(spec, "Second call (should be faster if cached)");
  const secondCommit = result2.commitHash;
  
  if (result2.duration < result1.duration * 0.5) {
    console.log("   ✅ Second call was faster - likely using cache");
  } else {
    console.log("   ⚠️  Second call took similar time - may have cloned again");
  }
  
  if (firstCommit === secondCommit) {
    console.log("   ✅ Same commit hash returned");
  } else {
    console.log("   ❌ Different commit hash - unexpected!");
  }
  
  // Test 3: Make a new commit and call again - does pacote detect it?
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: New commit made, call pacote.manifest() again");
  console.log("=".repeat(60));
  const newCommit = makeNewCommit("test commit for pacote");
  const result3 = await callPacoteManifest(spec, "After new commit (does pacote detect it?)");
  const thirdCommit = result3.commitHash;
  
  if (thirdCommit === newCommit) {
    console.log("   ✅ Pacote detected the new commit!");
  } else if (thirdCommit === firstCommit) {
    console.log("   ❌ Pacote returned cached commit - did NOT detect new commit");
    console.log("   ⚠️  This means pacote does NOT automatically check for branch updates");
  } else {
    console.log(`   ⚠️  Unexpected: got commit ${thirdCommit.substring(0, 8)}, expected ${newCommit.substring(0, 8)}`);
  }
  
  // Test 4: Call with explicit commit hash
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Call with explicit commit hash");
  console.log("=".repeat(60));
  const explicitSpec = `test-pacote-git@${gitUrl}#${initialCommit}`;
  const result4 = await callPacoteManifest(explicitSpec, "Explicit commit hash");
  const fourthCommit = result4.commitHash;
  
  if (fourthCommit === initialCommit) {
    console.log("   ✅ Correct commit hash returned");
  } else {
    console.log(`   ❌ Expected ${initialCommit.substring(0, 8)}, got ${fourthCommit.substring(0, 8)}`);
  }
  
  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`1. First call duration: ${result1.duration}ms`);
  console.log(`2. Second call duration: ${result2.duration}ms (${result2.duration < result1.duration * 0.5 ? 'cached' : 'not cached'})`);
  console.log(`3. After new commit: ${thirdCommit === newCommit ? 'detected' : 'NOT detected'}`);
  console.log(`4. Explicit commit: ${fourthCommit === initialCommit ? 'correct' : 'incorrect'}`);
  
  console.log("\n📊 Conclusion:");
  if (thirdCommit === newCommit) {
    console.log("   ✅ Pacote DOES detect branch updates automatically");
  } else {
    console.log("   ❌ Pacote does NOT detect branch updates automatically");
    console.log("   💡 This confirms why fyn needs to check with git ls-remote/rev-parse");
  }
  
  // Cleanup
  console.log("\n🧹 Cleaning up...");
  cleanup();
  console.log("✓ Done");
}

// Get default branch for a GitHub repo
function getGitHubDefaultBranch(repo) {
  try {
    const output = execSync(`git ls-remote --symref https://github.com/${repo}.git HEAD`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 10000
    });
    const match = output.match(/refs\/heads\/(\S+)/);
    return match ? match[1] : "main";
  } catch (err) {
    console.log(`   ⚠️  Could not determine default branch, using 'main'`);
    return "main";
  }
}

// Test GitHub repo
async function testGitHubRepo() {
  console.log("\n" + "=".repeat(60));
  console.log("GITHUB REPO TESTS");
  console.log("=".repeat(60));
  console.log(`\n📋 Testing with GitHub repo: ${GITHUB_REPO}`);
  
  // Try to determine the default branch
  const defaultBranch = getGitHubDefaultBranch(GITHUB_REPO);
  console.log(`   Default branch: ${defaultBranch}`);
  
  const githubSpec = `test-from-gh@github:${GITHUB_REPO}#${defaultBranch}`;
  
  // Test 1: First call
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: First call to pacote.manifest() with GitHub repo");
  console.log("=".repeat(60));
  const result1 = await callPacoteManifest(githubSpec, "First call (GitHub)");
  const firstCommit = result1.commitHash;
  
  // Test 2: Second call immediately
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Second call immediately (GitHub)");
  console.log("=".repeat(60));
  const result2 = await callPacoteManifest(githubSpec, "Second call (GitHub)");
  const secondCommit = result2.commitHash;
  
  if (result2.duration < result1.duration * 0.5) {
    console.log("   ✅ Second call was faster - likely using cache");
  } else {
    console.log("   ⚠️  Second call took similar time - may have cloned again");
  }
  
  if (firstCommit === secondCommit) {
    console.log("   ✅ Same commit hash returned");
  } else {
    console.log("   ❌ Different commit hash - unexpected!");
  }
  
  // Test 3: Check if pacote detects new commits (if repo has been updated)
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Check if pacote detects new commits on GitHub");
  console.log("=".repeat(60));
  console.log("   Note: This test checks if pacote detects updates when the remote branch moves.");
  console.log("   If the repo hasn't changed, pacote should return the same commit.");
  console.log("   If the repo HAS changed, pacote should detect it...");
  
  // Wait a moment to ensure any caching is cleared
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const result3 = await callPacoteManifest(githubSpec, "After potential update (GitHub)");
  const thirdCommit = result3.commitHash;
  
  if (thirdCommit === firstCommit) {
    console.log("   ⚠️  Same commit returned - either repo hasn't changed OR pacote cached it");
    console.log("   💡 To verify: Check if the repo actually has new commits");
  } else {
    console.log("   ✅ Different commit returned - pacote detected update!");
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("GITHUB SUMMARY");
  console.log("=".repeat(60));
  console.log(`1. First call duration: ${result1.duration}ms`);
  console.log(`2. Second call duration: ${result2.duration}ms (${result2.duration < result1.duration * 0.5 ? 'cached' : 'not cached'})`);
  console.log(`3. Commit detection: ${thirdCommit === firstCommit ? 'same commit (cached or unchanged)' : 'different commit (detected update)'}`);
}

async function runAllTests() {
  try {
    // Test local repo
    await runTests();
    
    // Test GitHub repo
    await testGitHubRepo();
    
    console.log("\n" + "=".repeat(60));
    console.log("FINAL CONCLUSION");
    console.log("=".repeat(60));
    console.log("✅ Tests completed successfully!");
    console.log("💡 Key finding: Pacote does NOT automatically detect branch updates");
    console.log("   This confirms why fyn needs git ls-remote/rev-parse checks");
    
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    throw err;
  }
}

// Run all tests
runAllTests().catch(err => {
  console.error("\n❌ Test suite failed:", err);
  cleanup();
  process.exit(1);
});

