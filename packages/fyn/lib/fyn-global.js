"use strict";

const Path = require("path");
const Os = require("os");
const Fs = require("./util/file-ops");
const Fyn = require("./fyn");
const PkgInstaller = require("./pkg-installer");
const logger = require("./logger");
const fynTil = require("./util/fyntil");
const lockfile = require("lockfile");
const util = require("util");

const createLock = util.promisify(lockfile.lock);
const unlock = util.promisify(lockfile.unlock);

/**
 * FynGlobal - Global package installation manager for fyn
 * Uses composition pattern (not extending Fyn)
 */
class FynGlobal {
  /**
   * Create a FynGlobal instance
   * @param {Object} options - Configuration options
   * @param {string} [options.globalDir] - Root directory for global packages (default: ~/.fyn/global)
   * @param {string} [options.registry] - NPM registry URL (default: https://registry.npmjs.org)
   * @param {string} [options.nodeVersion] - Node.js major version (default: auto-detect)
   */
  constructor(options = {}) {
    this.options = options;
    this.nodeVersion = options.nodeVersion || process.version.match(/^v(\d+)/)[1];

    // Allow customizing the global root directory
    this.globalRoot = options.globalDir || Path.join(Os.homedir(), ".fyn", "global");

    this.versionDir = Path.join(this.globalRoot, `v${this.nodeVersion}`);
    this.packagesDir = Path.join(this.versionDir, "packages");
    this.globalBinDir = Path.join(this.versionDir, "bin");
    this.lockFile = Path.join(this.packagesDir, ".install.lock");
  }

  /**
   * Parse package spec to extract package name (async)
   */
  async parsePackageName(packageSpec) {
    // Handle file: or path specs
    if (
      packageSpec.startsWith("file:") ||
      packageSpec.startsWith("/") ||
      packageSpec.startsWith("./") ||
      packageSpec.startsWith("../")
    ) {
      const resolvedPath = Path.resolve(packageSpec.replace(/^file:/, ""));
      const pkgJsonPath = Path.join(resolvedPath, "package.json");
      try {
        const pkgJson = await fynTil.readJson(pkgJsonPath);
        return pkgJson.name;
      } catch (err) {
        throw new Error(`Cannot read package.json from ${resolvedPath}: ${err.message}`);
      }
    }

    // Handle npm: alias
    if (packageSpec.startsWith("npm:")) {
      packageSpec = packageSpec.substring(4);
    }

    // Handle @scope/name@version or name@version
    const atIndex = packageSpec.lastIndexOf("@");
    if (atIndex > 0) {
      return packageSpec.substring(0, atIndex);
    }

    return packageSpec;
  }

  /**
   * Acquire lock for concurrent install protection
   */
  async acquireLock() {
    await Fs.$.mkdirp(Path.dirname(this.lockFile));
    return createLock(this.lockFile, { wait: 10000, stale: 60000 });
  }

  /**
   * Release install lock
   */
  async releaseLock() {
    try {
      await unlock(this.lockFile);
    } catch (err) {
      // Ignore unlock errors
    }
  }

  /**
   * Get next global package ID by reading directory
   */
  async getNextGlobalId() {
    try {
      const dirs = await Fs.readdir(this.packagesDir);

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
      return "g1";
    }
  }

  /**
   * Find an installed global package by name
   */
  async findInstalledPackage(packageName) {
    try {
      const dirs = await Fs.readdir(this.packagesDir);

      for (const dir of dirs) {
        if (!/^g\d+$/.test(dir)) continue;

        const pkgJsonPath = Path.join(this.packagesDir, dir, "package.json");
        try {
          const pkgJson = JSON.parse(await Fs.readFile(pkgJsonPath));
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

  /**
   * Get all globally installed packages
   */
  async getAllGlobalPackages() {
    const packages = [];

    try {
      const dirs = await Fs.readdir(this.packagesDir);

      // Filter and process all gN directories
      for (const dir of dirs.filter(d => /^g\d+$/.test(d))) {
        const pkgJsonPath = Path.join(this.packagesDir, dir, "package.json");

        try {
          const pkgJson = JSON.parse(await Fs.readFile(pkgJsonPath));
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

  /**
   * Ensure global/bin symlink points to current version's bin directory
   */
  async ensureBinSymlink() {
    const binSymlink = Path.join(this.globalRoot, "bin");
    const targetDir = `v${this.nodeVersion}/bin`;

    try {
      const currentTarget = await Fs.readlink(binSymlink);
      if (currentTarget === targetDir) {
        return; // Already correct
      }
      await Fs.unlink(binSymlink);
    } catch (err) {
      // Symlink doesn't exist
    }

    await Fs.symlink(targetDir, binSymlink);
  }

  /**
   * Discover bin executables declared in a package's package.json
   * Only returns bins from the actual package, not transitive dependencies
   */
  async discoverBins(pkgDir, packageName) {
    const bins = {};
    const binDir = Path.join(pkgDir, "node_modules", ".bin");

    // Read the installed package's package.json to get declared bins
    const pkgJsonPath = Path.join(pkgDir, "node_modules", packageName, "package.json");
    try {
      const pkgJson = JSON.parse(await Fs.readFile(pkgJsonPath));
      const declaredBins = pkgJson.bin || {};

      // bin can be a string (single bin with package name) or object
      let binNames;
      if (typeof declaredBins === "string") {
        binNames = [packageName];
      } else {
        binNames = Object.keys(declaredBins);
      }

      // Map to actual paths in .bin directory
      for (const binName of binNames) {
        const binPath = Path.join(binDir, binName);
        if (await Fs.exists(binPath)) {
          bins[binName] = binPath;
        }
      }
    } catch (err) {
      // Fall back to empty if can't read package.json
    }

    return bins;
  }

  /**
   * Find which package owns a bin
   */
  async findBinOwner(binName) {
    const packages = await this.getAllGlobalPackages();

    for (const pkg of packages) {
      if (pkg.meta.bins && pkg.meta.bins.includes(binName)) {
        return pkg.meta.package;
      }
    }

    return null;
  }

  /**
   * Link bin executables to global bin directory
   */
  async linkBins(gId, bins) {
    await Fs.$.mkdirp(this.globalBinDir);

    for (const [binName, binPath] of Object.entries(bins)) {
      const globalBinPath = Path.join(this.globalBinDir, binName);

      // Check if bin already exists
      if (await Fs.exists(globalBinPath)) {
        const owner = await this.findBinOwner(binName);
        logger.warn(`${binName} already exists (from ${owner || "unknown"}), skipping`);
        continue;
      }

      // Create relative symlink
      const relativePath = Path.relative(this.globalBinDir, binPath);
      await Fs.symlink(relativePath, globalBinPath);
    }
  }

  /**
   * Install a package globally
   */
  async installGlobalPackage(packageSpec) {
    await this.acquireLock();

    try {
      const packageName = await this.parsePackageName(packageSpec);

      // Check if already installed
      const existing = await this.findInstalledPackage(packageName);
      if (existing) {
        logger.info(`${packageName} is already installed globally in ${existing.dir}`);
        logger.info(`To reinstall: fyn global remove ${packageName} && fyn global add ${packageSpec}`);
        return false;
      }

      // Get next ID by reading directory
      const gId = await this.getNextGlobalId();
      const pkgDir = Path.join(this.packagesDir, gId);

      // Create package directory
      await Fs.$.mkdirp(pkgDir);

      // Determine if local package
      const isLocal =
        packageSpec.startsWith("file:") ||
        packageSpec.startsWith("/") ||
        packageSpec.startsWith("./") ||
        packageSpec.startsWith("../");

      // Determine the version spec for dependencies
      // If packageSpec is just a package name (no version), use "latest"
      // If it has a version (name@version), extract the version part
      let depVersion;
      if (isLocal) {
        depVersion = packageSpec;
      } else if (packageSpec === packageName) {
        // Just a package name, no version specified
        depVersion = "latest";
      } else if (packageSpec.includes("@") && !packageSpec.startsWith("@")) {
        // Has a version: pkg@version
        depVersion = packageSpec.substring(packageName.length + 1);
      } else if (packageSpec.startsWith("@") && packageSpec.lastIndexOf("@") > 0) {
        // Scoped package with version: @scope/pkg@version
        depVersion = packageSpec.substring(packageName.length + 1);
      } else {
        depVersion = "latest";
      }

      // Create package.json with embedded metadata
      const pkgJson = {
        name: `_fyn_global_${gId}`,
        private: true,
        description: `Global installation of ${packageName}`,
        _fyn: {
          package: packageName,
          spec: packageSpec,
          installedAt: new Date().toISOString(),
          bins: [],
          local: isLocal
        },
        dependencies: {
          [packageName]: depVersion
        }
      };

      await Fs.writeFile(Path.join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

      // Create Fyn instance for this package directory
      logger.info(`Installing ${packageName} globally...`);

      // Set FYN_CENTRAL_DIR env to put central store under global directory
      process.env.FYN_CENTRAL_DIR = Path.join(this.globalRoot, "_central-storage");

      const fyn = new Fyn({
        opts: {
          cwd: pkgDir,
          // Don't set fynDir - let fyn use default ~/.fyn for cacache
          targetDir: "node_modules",
          centralStore: true,  // Use fyn's central store for deduplication
          production: true,
          lockfile: true,
          fynlocal: isLocal,
          registry: this.options.registry || "https://registry.npmjs.org",
          layout: "normal",  // Use normal node_modules layout
          flattenTop: true
        },
        _fynpo: false
      });

      // Run installation
      await fyn.resolveDependencies();
      await fyn.fetchPackages();

      const installer = new PkgInstaller({ fyn });
      await installer.install();

      // Discover and link bins (only from the package's declared bin, not transitive deps)
      const bins = await this.discoverBins(pkgDir, packageName);
      await this.linkBins(gId, bins);

      // Update package.json with discovered bins
      pkgJson._fyn.bins = Object.keys(bins);
      await Fs.writeFile(Path.join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

      // Ensure global/bin symlink points to current version's bin
      await this.ensureBinSymlink();

      logger.info(`${packageName} installed globally`);
      if (Object.keys(bins).length > 0) {
        logger.info(`Binaries available: ${Object.keys(bins).join(", ")}`);
      }

      return true;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Remove a globally installed package
   */
  async removeGlobalPackage(packageName) {
    const pkg = await this.findInstalledPackage(packageName);

    if (!pkg) {
      logger.error(`${packageName} is not installed globally`);
      return false;
    }

    const pkgDir = Path.join(this.packagesDir, pkg.dir);

    // Remove bin symlinks
    for (const binName of pkg.meta.bins || []) {
      const binPath = Path.join(this.globalBinDir, binName);
      try {
        // Check if symlink points to this package
        const linkTarget = await Fs.readlink(binPath);
        if (linkTarget.includes(pkg.dir)) {
          await Fs.unlink(binPath);
        }
      } catch (err) {
        // Symlink doesn't exist or error reading it
      }
    }

    // Remove package directory
    await Fs.$.rimraf(pkgDir);

    logger.info(`${packageName} removed`);
    return true;
  }

  /**
   * List all globally installed packages
   */
  async listGlobalPackages() {
    const packages = await this.getAllGlobalPackages();

    if (packages.length === 0) {
      logger.info("No global packages installed");
      return packages;
    }

    logger.info("Global packages:");

    // Sort by name
    packages.sort((a, b) => a.meta.package.localeCompare(b.meta.package));

    for (const pkg of packages) {
      const { meta, dir } = pkg;
      const local = meta.local ? " (local)" : "";
      const bins = meta.bins?.length > 0 ? ` [${meta.bins.join(", ")}]` : "";

      console.log(`  ${meta.package}@${meta.spec}${local}${bins}`);
      console.log(`    ${dir} - installed ${new Date(meta.installedAt).toLocaleDateString()}`);
    }

    return packages;
  }

  /**
   * Update a globally installed package
   */
  async updateGlobalPackage(packageName) {
    const pkg = await this.findInstalledPackage(packageName);

    if (!pkg) {
      logger.error(`${packageName} is not installed globally`);
      return false;
    }

    const pkgDir = Path.join(this.packagesDir, pkg.dir);

    logger.info(`Updating ${packageName}...`);

    // For local packages, validate path still exists
    if (pkg.meta.local) {
      const localPath = pkg.meta.spec.replace(/^file:/, "");
      const resolvedPath = Path.resolve(localPath);
      if (!(await Fs.exists(resolvedPath))) {
        logger.error(`Local package path no longer exists: ${localPath}`);
        logger.error(`Remove and reinstall: fyn global remove ${packageName}`);
        return false;
      }
    } else {
      // For registry packages, update to latest by modifying package.json
      const pkgJsonPath = Path.join(pkgDir, "package.json");
      const pkgJson = JSON.parse(await Fs.readFile(pkgJsonPath));
      pkgJson.dependencies[packageName] = "latest";
      await Fs.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    }

    // Remove old fyn-lock to force fresh resolution
    const lockPath = Path.join(pkgDir, "fyn-lock.yaml");
    try {
      await Fs.unlink(lockPath);
    } catch (err) {
      // Lock file may not exist
    }

    // Set FYN_CENTRAL_DIR env to put central store under global directory
    process.env.FYN_CENTRAL_DIR = Path.join(this.globalRoot, "_central-storage");

    // Create Fyn instance and run installation
    const fyn = new Fyn({
      opts: {
        cwd: pkgDir,
        // Don't set fynDir - let fyn use default ~/.fyn for cacache
        targetDir: "node_modules",
        centralStore: true,  // Use fyn's central store for deduplication
        production: true,
        lockfile: true,
        fynlocal: pkg.meta.local,
        registry: this.options.registry || "https://registry.npmjs.org",
        layout: "normal",  // Use normal node_modules layout
        flattenTop: true
      },
      _fynpo: false
    });

    await fyn.resolveDependencies();
    await fyn.fetchPackages();

    const installer = new PkgInstaller({ fyn });
    await installer.install();

    // Re-discover and update bins (only from the package's declared bin)
    const bins = await this.discoverBins(pkgDir, packageName);

    // Update metadata
    const pkgJsonPath = Path.join(pkgDir, "package.json");
    const pkgJson = JSON.parse(await Fs.readFile(pkgJsonPath));
    pkgJson._fyn.bins = Object.keys(bins);
    pkgJson._fyn.updatedAt = new Date().toISOString();
    await Fs.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");

    // Re-link any new bins
    await this.linkBins(pkg.dir, bins);

    logger.info(`${packageName} updated${pkg.meta.local ? " from local source" : " to latest"}`);
    return true;
  }

  /**
   * Switch to a specific Node version's global packages
   */
  async useNodeVersion(version) {
    const nodeVersion = version || this.nodeVersion;
    const versionDir = `v${nodeVersion}`;
    const currentLink = Path.join(this.globalRoot, "current");
    const targetDir = Path.join(this.globalRoot, versionDir);

    // Check what current points to
    let currentTarget = null;
    try {
      currentTarget = await Fs.readlink(currentLink);
    } catch (err) {
      // No current symlink
    }

    if (currentTarget === versionDir) {
      logger.info(`Already using Node ${versionDir} global packages`);
      return true;
    }

    if (!(await Fs.exists(targetDir))) {
      logger.info(`No global packages installed for Node ${versionDir}`);
      logger.info(`Install packages with: fyn global add <package>`);
      // Create the directory structure for new version
      await Fs.$.mkdirp(Path.join(targetDir, "packages"));
      await Fs.$.mkdirp(Path.join(targetDir, "bin"));
    }

    // Update symlink
    try {
      await Fs.unlink(currentLink);
    } catch (err) {
      // Symlink may not exist
    }
    await Fs.symlink(versionDir, currentLink);

    logger.info(`Switched from ${currentTarget || "none"} to ${versionDir}`);
    return true;
  }

  /**
   * Show PATH setup instructions
   */
  showPathSetup() {
    const binPath = Path.join(this.globalRoot, "current", "bin");
    const isWindows = process.platform === "win32";

    console.log("\nTo use globally installed packages, add the bin directory to your PATH:\n");

    if (isWindows) {
      console.log("Windows (PowerShell):");
      console.log(`  $env:PATH = "${binPath};$env:PATH"`);
      console.log("\nTo make permanent, add to system PATH via System Properties.");
    } else {
      console.log("Bash/Zsh:");
      console.log(`  export PATH="${binPath}:$PATH"`);
      console.log("\nAdd to ~/.bashrc or ~/.zshrc for permanent setup:");
      console.log(`  echo 'export PATH="${binPath}:$PATH"' >> ~/.bashrc`);
    }

    console.log(`\nCurrent bin directory: ${this.globalBinDir}`);
  }
}

module.exports = FynGlobal;
