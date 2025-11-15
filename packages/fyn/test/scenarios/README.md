# Scenario Testing Framework

The scenario testing framework provides a structured way to test `fyn`'s behavior through a series of sequential steps. Each scenario simulates real-world usage patterns and verifies that `fyn` produces the expected `node_modules` structure and lockfile.

## Overview

Scenarios are defined in `test/scenarios/` and executed by `test/spec/scenarios.spec.js`. Each scenario consists of one or more **steps** that are run sequentially, with each step building upon the previous one's state.

## Directory Structure

```
test/scenarios/
├── <scenario-name>/
│   ├── step-01/
│   │   ├── index.js          # Step configuration and hooks
│   │   ├── pkg.json          # Package.json changes for this step
│   │   ├── nm-tree.yaml      # Expected node_modules tree structure
│   │   └── lock.yaml         # Expected lockfile (optional)
│   ├── step-02/
│   │   └── ...
│   └── <fixtures>/           # Optional test fixtures (e.g., local packages)
└── README.md                 # This file
```

## How `scenarios.spec.js` Works

### Test Execution Flow

1. **Setup Phase**:
   - Starts a mock npm registry server
   - Disables CI mode to allow local testing
   - Sets up error handling hooks

2. **Scenario Discovery**:
   - Scans `test/scenarios/` for directories (excluding dot-prefixed ones)
   - Filters scenarios based on debug mode and filter configuration
   - Creates a `describe` block for each scenario

3. **Scenario Execution**:
   - Cleans up any existing test artifacts (`package.json`, `fyn-lock.yaml`, `.fyn`, `node_modules`)
   - Finds all `step-*` directories and sorts them alphabetically
   - Executes each step sequentially

4. **Step Execution**:
   - Loads step configuration from `step-XX/index.js`
   - Merges `pkg.json` changes into accumulated package.json
   - Runs `fyn install` with configured arguments
   - Verifies `node_modules` structure matches `nm-tree.yaml`
   - Optionally verifies lockfile matches `lock.yaml`
   - Runs custom verification hooks

### Key Functions

#### `executeScenario(scenarioDir, options)`

Main function that orchestrates scenario execution:

- **Parameters**:
  - `scenarioDir`: Path to the scenario directory
  - `options`: Configuration object with:
    - `stopStep`: Stop execution after this step (for debugging)
    - `debugStep`: Set breakpoint at this step (when `debug=true`)
    - `skip`: Skip this scenario entirely

- **Process**:
  1. Accumulates `package.json` changes across steps
  2. For each `step-XX` directory:
     - Calls `makeStep(step)` to create the test case
    3. Stops early if `stopStep` is reached

#### `makeStep(step)`

Creates a test case for a single step:

- **Step Configuration** (`step-XX/index.js`):
  ```javascript
  module.exports = {
    title: "descriptive title",
    before: (cwd, scenarioDir) => { /* setup */ },
    after: () => { /* cleanup */ },
    verify: (cwd, scenarioDir) => { /* custom verification */ },
    run: ({ registry, fynDir, cwd, baseArgs, pkgJson, pkgJsonFile, debug }) => { /* custom run */ },
    getArgs: ({ registry, fynDir, cwd, baseArgs, pkgJson, pkgJsonFile, debug }) => { /* custom args */ },
    extraArgs: ["--some-flag"],
    buildLocal: true,
    forceInstall: false,
    copyLock: true,
    expectFailure: (error) => { /* verify expected failure */ },
    skip: false,
    timeout: 5000,
    pkgDir: "subdirectory"  // Run from subdirectory instead of scenario root
  };
  ```

- **Default Arguments**:
  - `--pg=none`: No progress bar
  - `-q=none`: Quiet mode
  - `--no-rcfile`: Ignore rc files
  - `--reg=<mock-registry>`: Use mock npm registry
  - `--layout=detail`: Detailed layout
  - `--source-maps`: Generate source maps
  - `--sl <debug-log-file>`: Save logs to file
  - `--fyn-dir=<scenario>/.fyn`: Fyn cache directory
  - `--cwd=<cwd>`: Working directory
  - `install`: Command to run
  - `--fi`: Force install (unless `forceInstall: false`)

- **Verification**:
  1. Builds actual `node_modules` tree using `dirTree.make(cwd, "node_modules")`
  2. Loads expected tree from `nm-tree.yaml`
  3. Deep compares actual vs expected
  4. Optionally verifies lockfile if `lock.yaml` exists

#### `verifyLock(cwd, stepDir)`

Verifies the lockfile matches expected content:

- Normalizes lockfile by:
  - Replacing tarball URLs with `"test"`
  - Removing port numbers from registry URLs
  - Cleaning up metadata fields

#### `cleanLock(lock)`

Normalizes lockfile for comparison by removing test-specific variations.

## Step Files

### `index.js` - Step Configuration

Each step directory can contain an `index.js` file that exports step configuration:

```javascript
module.exports = {
  // Optional descriptive title
  title: "should install package X",

  // Hook: Run before fyn install
  before(cwd, scenarioDir) {
    // Setup environment, create files, etc.
    process.env.SOME_VAR = "value";
  },

  // Hook: Run after verification (even on failure)
  after() {
    // Cleanup environment
    delete process.env.SOME_VAR;
  },

  // Hook: Custom verification after fyn install
  verify(cwd, scenarioDir) {
    // Additional checks beyond nm-tree.yaml comparison
    const fs = require("fs");
    const path = require("path");
    const someFile = path.join(cwd, "some-file");
    if (!fs.existsSync(someFile)) {
      throw new Error("Expected file not found");
    }
  },

  // Custom: Override default fyn run
  run({ registry, fynDir, cwd, baseArgs, pkgJson, pkgJsonFile, debug }) {
    // Return a Promise that runs fyn with custom logic
    const fynRun = require("../../cli/fyn");
    return fynRun([...baseArgs, "install", "--custom-flag"]);
  },

  // Custom: Override default fyn arguments
  getArgs({ registry, fynDir, cwd, baseArgs, pkgJson, pkgJsonFile, debug }) {
    // Return custom argument array
    return [...baseArgs, "--reg=" + registry, "install"];
  },

  // Additional fyn arguments to append
  extraArgs: ["--some-flag", "--another-flag"],

  // Enable build-local mode (default: false)
  buildLocal: true,

  // Disable force install (default: true)
  forceInstall: false,

  // Copy lock.yaml from previous step before running
  copyLock: true,

  // Expect fyn to fail and verify the error
  expectFailure(error) {
    if (!error.message.includes("expected error")) {
      throw new Error("Unexpected error: " + error.message);
    }
  },

  // Skip this step
  skip: false,

  // Custom timeout in milliseconds
  timeout: 10000,

  // Run from subdirectory instead of scenario root
  pkgDir: "subdirectory"
};
```

**Default Values**:
- `before`: `_.noop` (no-op)
- `after`: `_.noop` (no-op)
- `verify`: `_.noop` (no-op)
- `extraArgs`: `[]`
- `buildLocal`: `false`
- `forceInstall`: `true` (unless explicitly `false`)
- `copyLock`: `false`
- `skip`: `false`

### `pkg.json` - Package.json Changes

Each step can define incremental changes to `package.json`. The framework:

1. **Merges** `pkg.json` from all previous steps
2. **Sorts** dependency keys alphabetically
3. **Removes** null/undefined fields
4. **Writes** the merged result to `package.json` in the scenario directory (or `pkgDir` if specified)

Example `pkg.json`:
```json
{
  "name": "test-package",
  "version": "1.0.0",
  "dependencies": {
    "some-package": "^1.0.0"
  }
}
```

**Note**: Only include fields that change in this step. The framework accumulates changes across steps.

### `nm-tree.yaml` - Expected Node Modules Tree

Defines the expected structure of `node_modules` after the step completes. Generated by `test/dir-tree.js`:

**Format**:
- Directories are represented as nested objects
- Files are marked as `"file"`
- Symlinks are represented as `"-> target"`
- `package.json` files include an `id` field with `name@version`

**Example**:
```yaml
node_modules:
  .f:
    .fyn.json: file
    _:
      some-package:
        1.0.0:
          some-package:
            index.js: file
            package.json:
              id: some-package@1.0.0
  some-package: "-> .f/_/some-package/1.0.0/some-package"
```

**Generating Expected Trees**:

1. Run the scenario manually or let it fail
2. Use the `dir-tree.js` utility:
   ```bash
   cd test/scenarios/<scenario-name>
   node ../../dir-tree.js > step-XX/nm-tree.yaml
   ```

3. Or enable debug mode and copy the output from console

### `lock.yaml` - Expected Lockfile (Optional)

If present, the framework verifies `fyn-lock.yaml` matches this file after normalization.

**Normalization**:
- Tarball URLs (`$` field) are replaced with `"test"`
- Registry URLs have port numbers removed
- Metadata fields are cleaned

**Copying Lockfiles**:
- Set `copyLock: true` in `index.js` to copy `lock.yaml` from previous step before running
- Useful for scenarios that test lockfile updates

## Debug Mode

Enable debug mode by setting `debug = true` in `scenarios.spec.js`:

```javascript
const debug = true;
```

**Debug Mode Behavior**:
- Only scenarios listed in `filter` are run (using `describe.only`)
- Debug logs are saved to `fyn-debug-<step>.log`
- Console output shows full `node_modules` tree
- Can set breakpoints with `debugStep` option
- Can stop early with `stopStep` option
- Test timeouts are extended to 10 seconds

**Example Filter Configuration**:
```javascript
const filter = {
  "local-hard-linking": { 
    stopStep: "step-03",    // Stop after step-03
    debugStep: "step-02"    // Set breakpoint at step-02
  }
};
```

## Normal Mode

In normal mode (`debug = false`):

- All scenarios run (unless marked `skip: true`)
- Filter is used for configuration (skip, stopStep, etc.)
- Failures show debug log output automatically
- Test timeouts use default or step-specific timeout

**Example Filter Configuration**:
```javascript
const filter = {
  "remote-url-semver": { skip: true }  // Skip this scenario
};
```

## Creating a New Scenario

1. **Create Scenario Directory**:
   ```bash
   mkdir -p test/scenarios/my-scenario
   ```

2. **Create First Step**:
   ```bash
   mkdir -p test/scenarios/my-scenario/step-01
   ```

3. **Add Step Files**:
   - `index.js`: Step configuration
   - `pkg.json`: Initial package.json
   - `nm-tree.yaml`: Expected node_modules structure

4. **Add More Steps** (optional):
   - Each step builds on the previous
   - Accumulate `pkg.json` changes
   - Update `nm-tree.yaml` to reflect new state

5. **Test**:
   ```bash
   cd packages/fyn
   xrun test
   ```

6. **Debug** (if needed):
   - Set `debug = true` in `scenarios.spec.js`
   - Add scenario to filter
   - Run tests and inspect logs

## Example Scenario: `local-hard-linking`

This scenario tests hard linking of local packages:

- **step-01**: Install a local package via `file:` protocol
- **step-02**: Install another local package
- **step-03**: Remove a local package and verify cleanup
- **step-04**: Link local package under its own directory
- **step-05**: Test symlink exclusion (default behavior)
- **step-06**: Test symlink inclusion with `FYN_LOCAL_PACK_SYMLINKS=true`

**Key Features Demonstrated**:
- Local package installation
- Hard linking behavior
- Symlink handling
- Environment variable configuration
- Custom `before`/`after` hooks

## Tips and Best Practices

1. **Incremental Steps**: Each step should test one specific behavior
2. **Descriptive Titles**: Use clear titles in `index.js` to document what each step tests
3. **Minimal `pkg.json`**: Only include fields that change in each step
4. **Verify Trees**: Always verify `nm-tree.yaml` matches actual output
5. **Use Fixtures**: Create reusable test fixtures in scenario directory
6. **Clean Hooks**: Use `before`/`after` to manage environment state
7. **Custom Verification**: Use `verify` hook for checks beyond tree structure
8. **Debug Logs**: Check `fyn-debug-<step>.log` when tests fail
9. **Lockfile Testing**: Use `lock.yaml` to test lockfile generation/updates
10. **Skip Steps**: Use `skip: true` to temporarily disable problematic steps

## Troubleshooting

### Test Fails with Tree Mismatch

1. Check `fyn-debug-<step>.log` for detailed output
2. Run scenario manually and generate new `nm-tree.yaml`:
   ```bash
   cd test/scenarios/<scenario>/step-XX
   node ../../../dir-tree.js > nm-tree.yaml
   ```
3. Compare actual vs expected structure

### Lockfile Mismatch

1. Verify `lock.yaml` format matches actual lockfile
2. Check that normalization is working correctly
3. Ensure registry URLs are consistent

### Step Not Running

1. Check step directory name starts with `step-`
2. Verify step is not marked `skip: true`
3. Check if `stopStep` is set before this step
4. Ensure scenario is not skipped in filter

### Environment Issues

1. Use `before` hook to set environment variables
2. Use `after` hook to clean up
3. Check for test isolation issues (shared state)

## Related Files

- `test/spec/scenarios.spec.js`: Main test runner
- `test/dir-tree.js`: Utility for generating `nm-tree.yaml`
- `test/fixtures/`: Shared test fixtures
- `test/fixtures/mock-npm.js`: Mock npm registry server

