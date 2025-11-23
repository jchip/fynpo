# Fyn Global Package Installation Design

## Executive Summary

This document outlines the design for adding global package installation support to fyn, similar to `npm install -g` but with enhanced capabilities:
- Node.js version resilience (survives minor/patch updates)
- Support for installing from local repositories using fyn's hard linking
- Full isolation for every global package (no dependency conflicts)
- Efficient storage through central deduplication
- No registry files - self-contained package metadata

## Problem Statement

### Current Limitations
1. Fyn currently only supports project-local installations
2. No mechanism for globally available CLI tools
3. No support for Node.js version management

### Requirements
1. Install packages globally with `-g` flag
2. Survive Node.js version bumps (except major versions or NAPI changes)
3. Support local package installation with hard linking
4. Prevent dependency conflicts between global packages
5. Maintain fyn's efficiency advantages

## Proposed Solution: Full Isolation Architecture

### Core Concept
Every global package gets its own isolated directory with its own dependencies. No shared installations, no conflicts, no registry file needed. Each package.json is self-contained with all metadata.

### Directory Structure

```
~/.fyn/
  global/
    store/                            # Isolated central store for global packages only
      .f/_/                           # All global packages stored here once
        lodash/
          3.10.1/                     # Different versions can coexist
          4.17.21/
    v20/                              # Node.js major version directory
      packages/                       # Each package gets its own isolated directory
        g1/                           # First installed global package
          package.json                # Self-contained with metadata
            {
              "name": "_fyn_global_g1",
              "private": true,
              "_fyn": {
                "package": "eslint",
                "spec": "^8.0.0",
                "installedAt": "2024-01-15T10:30:00Z",
                "bins": ["eslint"]
              },
              "dependencies": {
                "eslint": "^8.0.0"
              }
            }
          fyn-lock.yaml
          node_modules/               # Isolated dependencies
            eslint/
            .f/                       # Hard links to global store
            .bin/
              eslint
        g2/                           # Second global package
          package.json
            {
              "name": "_fyn_global_g2",
              "private": true,
              "_fyn": {
                "package": "typescript",
                "spec": "^5.0.0",
                "installedAt": "2024-01-15T10:31:00Z",
                "bins": ["tsc", "tsserver"]
              },
              "dependencies": {
                "typescript": "^5.0.0"
              }
            }
          node_modules/
            typescript/
            .bin/
              tsc
              tsserver
        g3/                           # Local package example
          package.json
            {
              "name": "_fyn_global_g3",
              "private": true,
              "_fyn": {
                "package": "my-cli",
                "spec": "file:../../../projects/my-cli",
                "installedAt": "2024-01-15T10:32:00Z",
                "bins": ["my-cli"],
                "local": true
              },
              "dependencies": {
                "my-cli": "file:../../../projects/my-cli"
              }
            }
          node_modules/
            my-cli/
            .bin/
              my-cli
      bin/                            # Global bin directory (aggregated symlinks)
        eslint -> ../packages/g1/node_modules/.bin/eslint
        tsc -> ../packages/g2/node_modules/.bin/tsc
        tsserver -> ../packages/g2/node_modules/.bin/tsserver
        my-cli -> ../packages/g3/node_modules/.bin/my-cli
    current -> v20                    # Symlink to current Node version
```

**Key Design Decisions:**
- **No registry.json** - Each package.json contains all metadata in `_fyn` field
- **Simple naming** - Use `g1`, `g2`, `g3` pattern (users don't look at these anyway)
- **No counter file** - Next ID determined by `readdir()` and finding max number + 1
- **Full isolation** - Every package has its own node_modules, no sharing complexities

## Implementation Details

### 1. Core Classes

#### FynGlobal Class
```javascript
const Fyn = require('./fyn');
const FynCli = require('../cli/fyn-cli');
const PkgInstaller = require('./pkg-installer');
const lockfile = require('lockfile');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class FynGlobal {  // NOT extending Fyn - uses composition instead
  constructor(options = {}) {
    this.options = options;
    this.nodeVersion = process.version.match(/^v(\d+)/)[1];
    this.globalRoot = path.join(os.homedir(), '.fyn', 'global');
    this.versionDir = path.join(this.globalRoot, `v${this.nodeVersion}`);
    this.packagesDir = path.join(this.versionDir, 'packages');
    this.globalBinDir = path.join(this.versionDir, 'bin');
    this.centralStore = path.join(this.globalRoot, 'store'); // Isolated global store
    this.lockFile = path.join(this.packagesDir, '.install.lock');
  }

  parsePackageName(packageSpec) {
    // Handle file: or path specs
    if (packageSpec.startsWith('file:') || packageSpec.startsWith('/') || packageSpec.startsWith('./')) {
      const resolvedPath = path.resolve(packageSpec.replace(/^file:/, ''));
      const pkgJsonPath = path.join(resolvedPath, 'package.json');
      try {
        const pkgJson = require(pkgJsonPath);
        return pkgJson.name;
      } catch (err) {
        throw new Error(`Cannot read package.json from ${resolvedPath}`);
      }
    }

    // Handle npm: alias
    if (packageSpec.startsWith('npm:')) {
      packageSpec = packageSpec.substring(4);
    }

    // Handle @scope/name@version or name@version
    const atIndex = packageSpec.lastIndexOf('@');
    if (atIndex > 0) {
      return packageSpec.substring(0, atIndex);
    }

    return packageSpec;
  }

  async installGlobalPackage(packageSpec) {
    // Acquire lock to prevent concurrent installs
    await this.acquireLock();

    try {
      const packageName = this.parsePackageName(packageSpec);

      // Check if already installed
      const existing = await this.findInstalledPackage(packageName);
      if (existing) {
        console.log(`${packageName} is already installed globally in ${existing.dir}`);
        console.log(`To reinstall: fyn global remove ${packageName} && fyn global add ${packageSpec}`);
        return;
      }

      // Get next ID by reading directory
      const gId = await this.getNextGlobalId();
      const pkgDir = path.join(this.packagesDir, gId);

      // Create package directory
      await fs.ensureDir(pkgDir);

      // Create package.json with embedded metadata
      const pkgJson = {
        name: `_fyn_global_${gId}`,
        private: true,
        description: `Global installation of ${packageName}`,
        _fyn: {
          package: packageName,
          spec: packageSpec,
          installedAt: new Date().toISOString(),
          bins: [],  // Will be updated after install
          local: packageSpec.startsWith('file:') || packageSpec.startsWith('/')
        },
        dependencies: {
          [packageName]: packageSpec
        }
      };

      await fs.writeJson(path.join(pkgDir, 'package.json'), pkgJson, { spaces: 2 });

      // Create Fyn instance for this package directory
      console.log(`Installing ${packageName} globally...`);
      const fyn = new Fyn({
        opts: {
          cwd: pkgDir,
          centralDir: this.centralStore,  // Use isolated global central store
          centralStore: true,
          targetDir: 'node_modules',      // Explicit target directory
          fynDir: this.globalRoot,         // Global fyn directory
          production: true                 // Install production deps only
        },
        _fynpo: false  // Disable fynpo detection for global packages
      });

      // Run installation using existing Fyn patterns
      await fyn.resolveDependencies();
      await fyn.fetchPackages();
      const installer = new PkgInstaller({ fyn });
      await installer.install();

      // Discover and link bins
      const bins = await this.discoverBins(pkgDir);
      await this.linkBins(gId, bins);

      // Update package.json with discovered bins
      pkgJson._fyn.bins = Object.keys(bins);
      await fs.writeJson(path.join(pkgDir, 'package.json'), pkgJson, { spaces: 2 });

      console.log(`✅ ${packageName} installed globally`);
      if (Object.keys(bins).length > 0) {
        console.log(`📦 Binaries available: ${Object.keys(bins).join(', ')}`);
      }
    } finally {
      await this.releaseLock();
    }
  }

  async acquireLock() {
    await fs.ensureDir(path.dirname(this.lockFile));
    return new Promise((resolve, reject) => {
      lockfile.lock(this.lockFile, { wait: 10000, stale: 60000 }, (err) => {
        if (err) reject(new Error(`Cannot acquire install lock: ${err.message}`));
        else resolve();
      });
    });
  }

  async releaseLock() {
    return new Promise((resolve) => {
      lockfile.unlock(this.lockFile, (err) => {
        // Ignore unlock errors
        resolve();
      });
    });
  }

  async getNextGlobalId() {
    try {
      const dirs = await fs.readdir(this.packagesDir);

      // Find all gN directories and extract numbers
      const numbers = dirs
        .filter(d => /^g\d+$/.test(d))
        .map(d => parseInt(d.substring(1), 10))
        .filter(n => !isNaN(n));

      // Get next number
      const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
      return `g${nextNum}`;

    } catch (err) {
      // Directory doesn't exist yet, start at g1
      return 'g1';
    }
  }

  async findInstalledPackage(packageName) {
    try {
      const dirs = await fs.readdir(this.packagesDir);

      for (const dir of dirs) {
        if (!/^g\d+$/.test(dir)) continue;

        const pkgJsonPath = path.join(this.packagesDir, dir, 'package.json');
        try {
          const pkgJson = await fs.readJson(pkgJsonPath);
          if (pkgJson._fyn && pkgJson._fyn.package === packageName) {
            return {
              dir: dir,
              meta: pkgJson._fyn
            };
          }
        } catch (err) {
          // Invalid package, skip
        }
      }
    } catch (err) {
      // packages directory doesn't exist
    }

    return null;
  }

  async getAllGlobalPackages() {
    const packages = [];

    try {
      const dirs = await fs.readdir(this.packagesDir);

      // Filter and process all gN directories
      for (const dir of dirs.filter(d => /^g\d+$/.test(d))) {
        const pkgJsonPath = path.join(this.packagesDir, dir, 'package.json');

        try {
          const pkgJson = await fs.readJson(pkgJsonPath);
          if (pkgJson._fyn) {
            packages.push({
              dir: dir,
              meta: pkgJson._fyn
            });
          }
        } catch (err) {
          // Skip invalid packages
        }
      }
    } catch (err) {
      // packages directory doesn't exist yet
    }

    return packages;
  }

  async discoverBins(pkgDir) {
    const bins = {};
    const binDir = path.join(pkgDir, 'node_modules', '.bin');

    if (await fs.exists(binDir)) {
      const binFiles = await fs.readdir(binDir);
      for (const binFile of binFiles) {
        bins[binFile] = path.join(binDir, binFile);
      }
    }

    return bins;
  }

  async linkBins(gId, bins) {
    await fs.ensureDir(this.globalBinDir);

    for (const [binName, binPath] of Object.entries(bins)) {
      const globalBinPath = path.join(this.globalBinDir, binName);

      // Check if bin already exists
      if (await fs.exists(globalBinPath)) {
        const owner = await this.findBinOwner(binName);
        console.warn(`⚠️  ${binName} already exists (from ${owner || 'unknown'})`);
        continue;
      }

      // Create relative symlink
      const relativePath = path.relative(this.globalBinDir, binPath);
      await fs.symlink(relativePath, globalBinPath);
    }
  }

  async findBinOwner(binName) {
    const packages = await this.getAllGlobalPackages();

    for (const pkg of packages) {
      if (pkg.meta.bins && pkg.meta.bins.includes(binName)) {
        return pkg.meta.package;
      }
    }

    return null;
  }

  async removeGlobalPackage(packageName) {
    const pkg = await this.findInstalledPackage(packageName);

    if (!pkg) {
      console.error(`${packageName} is not installed globally`);
      return;
    }

    const pkgDir = path.join(this.packagesDir, pkg.dir);

    // Remove bin symlinks
    for (const binName of pkg.meta.bins || []) {
      const binPath = path.join(this.globalBinDir, binName);
      try {
        // Check if symlink points to this package
        const linkTarget = await fs.readlink(binPath);
        if (linkTarget.includes(pkg.dir)) {
          await fs.unlink(binPath);
        }
      } catch (err) {
        // Symlink doesn't exist or error reading it
      }
    }

    // Remove package directory
    await fs.remove(pkgDir);

    console.log(`✅ ${packageName} removed`);
  }

  async listGlobalPackages() {
    const packages = await this.getAllGlobalPackages();

    if (packages.length === 0) {
      console.log('No global packages installed');
      return;
    }

    console.log('Global packages:');

    // Sort by install date or name
    packages.sort((a, b) => a.meta.package.localeCompare(b.meta.package));

    for (const pkg of packages) {
      const { meta, dir } = pkg;
      const local = meta.local ? ' (local)' : '';
      const bins = meta.bins?.length > 0 ? ` [${meta.bins.join(', ')}]` : '';

      console.log(`  ${meta.package}@${meta.spec}${local}${bins}`);
      console.log(`    📁 ${dir} • installed ${new Date(meta.installedAt).toLocaleDateString()}`);
    }
  }

  async updateGlobalPackage(packageName) {
    const pkg = await this.findInstalledPackage(packageName);

    if (!pkg) {
      console.error(`${packageName} is not installed globally`);
      return;
    }

    const pkgDir = path.join(this.packagesDir, pkg.dir);

    console.log(`Updating ${packageName}...`);

    // For local packages, validate path still exists
    if (pkg.meta.local) {
      const localPath = pkg.meta.spec.replace(/^file:/, '');
      if (!await fs.exists(localPath)) {
        console.error(`Local package path no longer exists: ${localPath}`);
        console.error(`Remove and reinstall: fyn global remove ${packageName}`);
        return;
      }
    } else {
      // For registry packages, update to latest
      const pkgJson = await fs.readJson(path.join(pkgDir, 'package.json'));
      pkgJson.dependencies[packageName] = 'latest';
      await fs.writeJson(path.join(pkgDir, 'package.json'), pkgJson, { spaces: 2 });
    }

    // Create Fyn instance and run installation
    const fyn = new Fyn({
      opts: {
        cwd: pkgDir,
        centralDir: this.centralStore,
        centralStore: true,
        targetDir: 'node_modules',
        fynDir: this.globalRoot,
        production: true
      },
      _fynpo: false
    });

    await fyn.resolveDependencies();
    await fyn.fetchPackages();
    const installer = new PkgInstaller({ fyn });
    await installer.install();

    console.log(`✅ ${packageName} updated${pkg.meta.local ? ' from local source' : ' to latest'}`);
  }
}
```

#### NodeVersionManager Class
```javascript
class NodeVersionManager {
  constructor(fynGlobal) {
    this.fynGlobal = fynGlobal;
  }

  async checkMigration() {
    const currentNodeVersion = process.version.match(/^v(\d+)/)[1];
    const currentNapiVersion = process.versions.napi;

    // Check if current version directory exists
    const currentVersionDir = path.join(os.homedir(), '.fyn', 'global', `v${currentNodeVersion}`);
    if (await fs.exists(currentVersionDir)) {
      return 'compatible';
    }

    // Check for other version directories
    const globalDir = path.join(os.homedir(), '.fyn', 'global');
    try {
      const dirs = await fs.readdir(globalDir);
      const versionDirs = dirs.filter(d => /^v\d+$/.test(d));

      if (versionDirs.length > 0) {
        const previousVersion = versionDirs[versionDirs.length - 1];
        console.log(`Node.js version changed from ${previousVersion} to v${currentNodeVersion}`);
        return 'major-change';
      }
    } catch (err) {
      // No global directory yet
    }

    return 'no-migration-needed';
  }

  async migrate(fromVersion, toVersion) {
    const oldDir = path.join(os.homedir(), '.fyn', 'global', fromVersion);
    const newVersion = `v${toVersion}`;

    // Get all packages from old version
    const oldFynGlobal = new FynGlobal();
    oldFynGlobal.versionDir = oldDir;
    oldFynGlobal.packagesDir = path.join(oldDir, 'packages');

    const packages = await oldFynGlobal.getAllGlobalPackages();

    console.log(`Migrating ${packages.length} global packages from ${fromVersion} to v${toVersion}...`);

    // Install each package in new version
    const newFynGlobal = new FynGlobal();
    for (const pkg of packages) {
      console.log(`  Reinstalling ${pkg.meta.package}@${pkg.meta.spec}`);
      await newFynGlobal.installGlobalPackage(pkg.meta.spec);
    }

    // Update current symlink
    const currentLink = path.join(os.homedir(), '.fyn', 'global', 'current');
    await fs.unlink(currentLink).catch(() => {});
    await fs.symlink(newVersion, currentLink);

    console.log(`✅ Migration complete`);
  }
}
```

### 2. CLI Integration

#### CLI Commands (Following Yarn Pattern)
```javascript
// In cli/main.js - add global command with subcommands
{
  global: {
    desc: "manage global packages",
    commands: {
      add: {
        desc: "add packages globally",
        args: "<packages...>",
        exec: async (args) => {
          const fynGlobal = new FynGlobal();
          for (const pkg of args.packages) {
            try {
              await fynGlobal.installGlobalPackage(pkg);
            } catch (err) {
              console.error(`Failed to install ${pkg}: ${err.message}`);
              process.exit(1); // Fail fast
            }
          }
        }
      },

      remove: {
        desc: "remove a global package",
        args: "<package>",
        exec: async (args) => {
          const fynGlobal = new FynGlobal();
          await fynGlobal.removeGlobalPackage(args.package);
        }
      },

      list: {
        desc: "list globally installed packages",
        exec: async () => {
          const fynGlobal = new FynGlobal();
          await fynGlobal.listGlobalPackages();
        }
      },

      update: {
        desc: "update global packages",
        args: "[package]",
        exec: async (args) => {
          const fynGlobal = new FynGlobal();
          if (args.package) {
            await fynGlobal.updateGlobalPackage(args.package);
          } else {
            // Update all packages
            const packages = await fynGlobal.getAllGlobalPackages();
            for (const pkg of packages) {
              await fynGlobal.updateGlobalPackage(pkg.meta.package);
            }
          }
        }
      },

      use: {
        desc: "switch to Node version's global packages",
        args: "[version]",
        exec: async (args) => {
          const fynGlobal = new FynGlobal();
          await fynGlobal.useNodeVersion(args.version);
        }
      }
    }
  }
}
```

#### FynGlobal.useNodeVersion Implementation
```javascript
async useNodeVersion(version) {
  const nodeVersion = version || process.version.match(/^v(\d+)/)[1];
  const versionDir = `v${nodeVersion}`;
  const currentLink = path.join(this.globalRoot, 'current');
  const targetDir = path.join(this.globalRoot, versionDir);

  // Check what current points to
  const currentTarget = await fs.readlink(currentLink).catch(() => null);

  if (currentTarget === versionDir) {
    console.log(`✅ Already using Node ${versionDir} global packages`);
    return;
  }

  if (!await fs.exists(targetDir)) {
    console.log(`⚠️  No global packages installed for Node ${versionDir}`);
    console.log(`Install packages with: fyn global add <package>`);
    // Create the directory structure for new version
    await fs.ensureDir(path.join(targetDir, 'packages'));
    await fs.ensureDir(path.join(targetDir, 'bin'));
  }

  // Update symlink
  await fs.unlink(currentLink).catch(() => {});
  await fs.symlink(versionDir, currentLink);
  console.log(`✅ Switched from ${currentTarget || 'none'} to ${versionDir}`);
}
```

### 3. Local Package Support

Local packages are automatically handled by the main `installGlobalPackage` method through the `file:` protocol. When a package spec starts with `file:`, a path (`/` or `./`), the `parsePackageName` method extracts the package name from the local package.json, and the installation proceeds normally with the `local` flag set in the metadata.

## Usage Examples

### Installing Packages Globally
```bash
# Install from registry
fyn global add eslint
fyn global add typescript@5.0.0

# Install from local directory
fyn global add file:../my-cli-tool
fyn global add /absolute/path/to/project

# Install multiple
fyn global add prettier eslint typescript
```

### Managing Global Packages
```bash
# List installed packages
fyn global list

# Update packages
fyn global update           # Update all
fyn global update eslint    # Update specific

# Remove packages
fyn global remove eslint

# Switch Node version
fyn global use              # Auto-detect and use current Node version
fyn global use 22           # Switch to Node v22's global packages
```

### PATH Setup
```bash
# One-time setup
fyn global setup-path

# Manual setup for Unix
echo 'export PATH="$HOME/.fyn/global/current/bin:$PATH"' >> ~/.bashrc

# Manual setup for Windows
# Add %USERPROFILE%\.fyn\global\current\bin to system PATH
```

## Advantages of This Design

1. **Dead Simple**: Full isolation means no complex conflict resolution needed
2. **No Registry File**: Each package.json is self-contained with all metadata
3. **Self-Healing**: Can reconstruct state by reading directories
4. **No Dependency Conflicts**: Every package has completely isolated dependencies
5. **Node.js Version Resilience**: Organized by major version with migration support
6. **Local Package Support**: Can globally install and update from local directories
7. **Space Efficient**: Central store with hard linking provides deduplication
8. **Clean Uninstalls**: Just remove directory and bin symlinks
9. **Easy Debugging**: Simple g1, g2, g3 directories with clear package.json files
10. **Atomic Operations**: No registry to get out of sync

## Migration from npm -g

```javascript
class NpmMigrator {
  async importFromNpm() {
    // Get npm's global packages
    const npmList = await exec('npm list -g --depth=0 --json');
    const packages = JSON.parse(npmList).dependencies;

    const fynGlobal = new FynGlobal();

    for (const [name, info] of Object.entries(packages)) {
      console.log(`Importing ${name}@${info.version}`);
      await fynGlobal.installGlobalPackage(`${name}@${info.version}`);
    }
  }
}
```

## Implementation Roadmap

### Phase 1: Foundation
- [ ] Create FynGlobal class using composition (lib/fyn-global.js)
- [ ] Implement directory structure (~/.fyn/global/v{major}/packages/g{N}/)
- [ ] Add parsePackageName() - extract name from various spec formats
- [ ] Add getNextGlobalId() - read dir and find next number
- [ ] Add findInstalledPackage() and getAllGlobalPackages()
- [ ] Add file locking (acquireLock/releaseLock) for concurrent safety

### Phase 2: CLI Integration
- [ ] Add global command with subcommands (add, remove, list, update, use) in cli/main.js
- [ ] Follow yarn's subcommand pattern (`fyn global add <package>`)
- [ ] Wire up FynGlobal instantiation for all global subcommands

### Phase 3: Core Installation
- [ ] Implement installGlobalPackage() with isolated g{N} directories
- [ ] Create package.json with _fyn metadata field
- [ ] Integrate with central store for deduplication
- [ ] Implement discoverBins() and linkBins()

### Phase 4: Package Management
- [ ] Implement removeGlobalPackage() - remove dir and clean bins
- [ ] Implement updateGlobalPackage() - handle registry and local packages
- [ ] Implement listGlobalPackages() - read all g* dirs
- [ ] Add bin conflict detection (first-wins with warning)

### Phase 5: Node Version Support
- [ ] Implement useNodeVersion() - manage current symlink
- [ ] Create version-specific directories (v20, v22, etc.)
- [ ] Handle PATH setup instructions

### Phase 6: Testing & Documentation
- [ ] Unit tests for FynGlobal class
- [ ] Integration tests for CLI commands
- [ ] Update README with global installation instructions
- [ ] Add examples and troubleshooting guide

## Design Decisions Made

1. **Full Isolation**: Every global package gets its own directory (no shared installations)
2. **No Registry File**: Each package.json contains all metadata in `_fyn` field
3. **Simple Naming**: Use `g1`, `g2`, `g3` pattern for directories
4. **No Counter File**: Next ID determined by reading directory and finding max + 1
5. **Bin Conflicts**: First-install-wins (following npm behavior)
6. **Update Strategy**: Manual only via `fyn global update` command
7. **Isolated Central Store**: Global packages use `~/.fyn/global/store/` separate from fyn's local project central store
8. **CLI Pattern**: Follow yarn's subcommand pattern (`fyn global add`) instead of npm's flag pattern (`npm install -g`)
9. **Fail Fast**: Multiple package installs fail immediately on first error (no partial installs)
10. **Composition Not Inheritance**: FynGlobal uses composition pattern, not extending Fyn class

## Open Questions

1. **Bin Conflict UI**: Should we add interactive resolution later?
   - Current: First-wins with warning
   - Future: Could add `--force` flag or interactive prompt

2. **Multiple Versions**: Should we support multiple versions of same package?
   - Current: One version per package name
   - Future: Could extend to support eslint@8 and eslint@9 simultaneously

3. **Auto-cleanup**: Should we clean up orphaned bins automatically?
   - Current: Manual cleanup only
   - Future: Could add `fyn global doctor --fix` command

## Conclusion

This design provides a robust global package installation system for fyn that surpasses npm's capabilities while maintaining fyn's core advantages of efficiency and reliability. The isolated package approach eliminates dependency conflicts while the central store ensures space efficiency through deduplication.