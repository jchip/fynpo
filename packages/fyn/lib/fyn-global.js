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
const semver = require("semver");
const readline = require("readline");

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
    this.installedJsonPath = Path.join(this.versionDir, "installed.json");
    this.lockFile = Path.join(this.packagesDir, ".install.lock");
    this.interactive = options.interactive !== false; // Default to interactive
    this.yes = options.yes || false; // Auto-confirm prompts
  }

  /**
   * Read the installed.json registry
   * @returns {Object} Registry object with packages info
   */
  async readInstalledJson() {
    try {
      const data = await Fs.readFile(this.installedJsonPath);
      return JSON.parse(data);
    } catch (err) {
      // Return empty registry if file doesn't exist
      return { packages: {} };
    }
  }

  /**
   * Write the installed.json registry
   */
  async writeInstalledJson(registry) {
    await Fs.$.mkdirp(this.versionDir);
    await Fs.writeFile(this.installedJsonPath, JSON.stringify(registry, null, 2) + "\n");
  }

  /**
   * Get all versions of a package from the registry
   * @param {string} packageName
   * @returns {Array} Array of version info objects
   */
  async getPackageVersions(packageName) {
    const registry = await this.readInstalledJson();
    return registry.packages[packageName]?.versions || [];
  }

  /**
   * Get the linked version of a package
   * @param {string} packageName
   * @returns {Object|null} Version info or null
   */
  async getLinkedVersion(packageName) {
    const versions = await this.getPackageVersions(packageName);
    return versions.find(v => v.linked) || null;
  }

  /**
   * Add or update a package version in the registry
   */
  async addToRegistry(packageName, versionInfo) {
    const registry = await this.readInstalledJson();

    if (!registry.packages[packageName]) {
      registry.packages[packageName] = { versions: [] };
    }

    // Check if version already exists
    const versions = registry.packages[packageName].versions;
    const existingIdx = versions.findIndex(v => v.version === versionInfo.version);

    if (existingIdx >= 0) {
      versions[existingIdx] = versionInfo;
    } else {
      versions.push(versionInfo);
    }

    await this.writeInstalledJson(registry);
  }

  /**
   * Remove a version from the registry
   */
  async removeFromRegistry(packageName, version) {
    const registry = await this.readInstalledJson();

    if (!registry.packages[packageName]) {
      return;
    }

    const versions = registry.packages[packageName].versions;
    const idx = versions.findIndex(v => v.version === version);

    if (idx >= 0) {
      versions.splice(idx, 1);

      // Remove package entry if no versions left
      if (versions.length === 0) {
        delete registry.packages[packageName];
      }

      await this.writeInstalledJson(registry);
    }
  }

  /**
   * Update linked status for a package version in registry
   */
  async updateLinkedInRegistry(packageName, version, linked) {
    const registry = await this.readInstalledJson();

    if (!registry.packages[packageName]) {
      return;
    }

    const versions = registry.packages[packageName].versions;

    // If setting linked=true, unlink all others first
    if (linked) {
      for (const v of versions) {
        v.linked = false;
      }
    }

    const target = versions.find(v => v.version === version);
    if (target) {
      target.linked = linked;
      await this.writeInstalledJson(registry);
    }
  }

  /**
   * Prompt user for yes/no confirmation
   */
  async promptYesNo(question) {
    // Auto-confirm if --yes flag is set
    if (this.yes) {
      return true;
    }

    if (!this.interactive || !process.stdin.isTTY) {
      return false; // Default to no in non-interactive mode
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise(resolve => {
      rl.question(`${question} [y/N] `, answer => {
        rl.close();
        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
      });
    });
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
   * Find an installed global package by name (returns linked version)
   * Uses the installed.json registry
   */
  async findInstalledPackage(packageName) {
    const versions = await this.getPackageVersions(packageName);
    if (versions.length === 0) return null;
    // Return linked version first, otherwise first found
    const linked = versions.find(v => v.linked);
    const v = linked || versions[0];
    return { dir: v.dir, meta: v };
  }

  /**
   * Fetch latest version info from npm registry
   */
  async fetchLatestVersion(packageName) {
    const registry = this.options.registry || "https://registry.npmjs.org";
    const url = `${registry}/${encodeURIComponent(packageName).replace("%40", "@")}`;

    try {
      const https = require("https");
      const http = require("http");
      const protocol = url.startsWith("https") ? https : http;

      return new Promise((resolve, reject) => {
        const req = protocol.get(url, { headers: { Accept: "application/json" } }, res => {
          let data = "";
          res.on("data", chunk => (data += chunk));
          res.on("end", () => {
            try {
              const pkg = JSON.parse(data);
              resolve({
                latest: pkg["dist-tags"]?.latest,
                versions: Object.keys(pkg.versions || {})
              });
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on("error", reject);
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Get all globally installed packages from registry
   */
  async getAllGlobalPackages() {
    const registry = await this.readInstalledJson();
    const packages = [];

    for (const [packageName, pkgInfo] of Object.entries(registry.packages)) {
      for (const v of pkgInfo.versions || []) {
        packages.push({
          dir: v.dir,
          meta: { package: packageName, ...v }
        });
      }
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
    const registry = await this.readInstalledJson();

    for (const [packageName, pkgInfo] of Object.entries(registry.packages)) {
      for (const v of pkgInfo.versions || []) {
        if (v.bins && v.bins.includes(binName) && v.linked) {
          return `${packageName}@${v.version}`;
        }
      }
    }

    return null;
  }

  /**
   * Link bin executables to global bin directory
   * @param {string} gId - Package directory ID (e.g., "g1")
   * @param {Object} bins - Map of binName -> binPath
   * @param {boolean} force - If true, overwrite existing bins
   */
  async linkBins(gId, bins, force = false) {
    await Fs.$.mkdirp(this.globalBinDir);

    for (const [binName, binPath] of Object.entries(bins)) {
      const globalBinPath = Path.join(this.globalBinDir, binName);

      // Check if bin already exists
      if (await Fs.exists(globalBinPath)) {
        if (force) {
          // Remove existing symlink
          await Fs.unlink(globalBinPath);
        } else {
          const owner = await this.findBinOwner(binName);
          logger.warn(`${binName} already exists (from ${owner || "unknown"}), skipping`);
          continue;
        }
      }

      // Create relative symlink
      const relativePath = Path.relative(this.globalBinDir, binPath);
      await Fs.symlink(relativePath, globalBinPath);
    }
  }

  /**
   * Read the actual installed version from node_modules
   */
  async getInstalledVersion(pkgDir, packageName) {
    const installedPkgJson = Path.join(pkgDir, "node_modules", packageName, "package.json");
    try {
      const pkgJson = JSON.parse(await Fs.readFile(installedPkgJson));
      return pkgJson.version;
    } catch (err) {
      return null;
    }
  }

  /**
   * Install a package globally
   * - Different versions go into their own directory
   * - Latest version wins (becomes linked)
   * - Prompts if newer version available when installing older
   * - Prompts to remove old versions after installing new
   */
  async installGlobalPackage(packageSpec) {
    await this.acquireLock();

    try {
      const packageName = await this.parsePackageName(packageSpec);

      // Determine if local package
      const isLocal =
        packageSpec.startsWith("file:") ||
        packageSpec.startsWith("/") ||
        packageSpec.startsWith("./") ||
        packageSpec.startsWith("../");

      // Determine the version spec for dependencies
      let depVersion;
      if (isLocal) {
        depVersion = packageSpec;
      } else if (packageSpec === packageName) {
        depVersion = "latest";
      } else if (packageSpec.includes("@") && !packageSpec.startsWith("@")) {
        depVersion = packageSpec.substring(packageName.length + 1);
      } else if (packageSpec.startsWith("@") && packageSpec.lastIndexOf("@") > 0) {
        depVersion = packageSpec.substring(packageName.length + 1);
      } else {
        depVersion = "latest";
      }

      // Check existing installations from registry
      const existingVersions = await this.getPackageVersions(packageName);

      // For non-local packages, check npm registry for latest version
      let latestVersion = null;

      if (!isLocal && depVersion !== "latest") {
        try {
          const registryInfo = await this.fetchLatestVersion(packageName);
          if (registryInfo) {
            latestVersion = registryInfo.latest;
            // If user requested a specific version, check if newer is available
            if (latestVersion && semver.valid(depVersion) && semver.gt(latestVersion, depVersion)) {
              logger.info(`A newer version is available: ${latestVersion} (you requested ${depVersion})`);
              const installNewer = await this.promptYesNo(`Install ${latestVersion} instead?`);
              if (installNewer) {
                depVersion = latestVersion;
              }
            }
          }
        } catch (err) {
          // Ignore registry errors, proceed with installation
        }
      }

      // Check if exact version already installed
      const existingExact = existingVersions.find(v =>
        v.version === depVersion || (depVersion === "latest" && v.version === latestVersion)
      );

      if (existingExact) {
        logger.info(`${packageName}@${existingExact.version} is already installed in ${existingExact.dir}`);
        if (!existingExact.linked) {
          const linkIt = await this.promptYesNo(`Link this version to make it active?`);
          if (linkIt) {
            await this.linkPackageVersion(packageName, existingExact.version);
          }
        }
        return false;
      }

      // Get next ID by reading directory
      const gId = await this.getNextGlobalId();
      const pkgDir = Path.join(this.packagesDir, gId);

      // Create package directory
      await Fs.$.mkdirp(pkgDir);

      // Create minimal package.json for fyn install
      const pkgJson = {
        name: `_fyn_global_${gId}`,
        private: true,
        description: `Global installation of ${packageName}`,
        dependencies: {
          [packageName]: depVersion
        }
      };

      await Fs.writeFile(Path.join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

      // Create Fyn instance for this package directory
      logger.info(`Installing ${packageName}${depVersion !== "latest" ? "@" + depVersion : ""} globally...`);

      // Set FYN_CENTRAL_DIR env to put central store under global directory
      process.env.FYN_CENTRAL_DIR = Path.join(this.globalRoot, "_central-storage");

      const fyn = new Fyn({
        opts: {
          cwd: pkgDir,
          targetDir: "node_modules",
          centralStore: true,
          production: true,
          lockfile: true,
          fynlocal: isLocal,
          registry: this.options.registry || "https://registry.npmjs.org",
          layout: "normal",
          flattenTop: true
        },
        _fynpo: false
      });

      // Run installation
      await fyn.resolveDependencies();
      await fyn.fetchPackages();

      const installer = new PkgInstaller({ fyn });
      await installer.install();

      // Get the actual installed version
      const installedVersion = await this.getInstalledVersion(pkgDir, packageName);

      // Discover bins
      const bins = await this.discoverBins(pkgDir, packageName);

      // Determine if this version should be linked (latest version wins)
      let shouldLink = true;
      if (existingVersions.length > 0 && installedVersion) {
        // Check if any existing version is newer
        for (const existing of existingVersions) {
          if (existing.version && semver.valid(existing.version) &&
              semver.gt(existing.version, installedVersion)) {
            shouldLink = false;
            break;
          }
        }
      }

      if (shouldLink) {
        // Unlink previous version(s) bins
        for (const existing of existingVersions) {
          if (existing.linked) {
            await this.unlinkBinsForVersion(packageName, existing.version);
          }
        }
        await this.linkBins(gId, bins, true); // force=true to overwrite
      }

      // Add to registry
      await this.addToRegistry(packageName, {
        version: installedVersion,
        dir: gId,
        spec: packageSpec,
        installedAt: new Date().toISOString(),
        bins: Object.keys(bins),
        local: isLocal,
        linked: shouldLink
      });

      // Ensure global/bin symlink points to current version's bin
      await this.ensureBinSymlink();

      logger.info(`${packageName}@${installedVersion || depVersion} installed globally`);
      if (Object.keys(bins).length > 0) {
        logger.info(`Binaries available: ${Object.keys(bins).join(", ")}`);
      }
      if (shouldLink) {
        logger.info(`This version is now active (linked)`);
      } else {
        logger.info(`Note: An older version was installed. Use 'fyn global link ${packageName}@${installedVersion}' to activate it.`);
      }

      // Prompt to remove old versions
      if (existingVersions.length > 0) {
        const oldVersions = existingVersions
          .filter(v => v.version !== installedVersion)
          .map(v => `${v.version} (${v.dir})`);

        if (oldVersions.length > 0) {
          logger.info(`Other installed versions: ${oldVersions.join(", ")}`);
          const removeOld = await this.promptYesNo(`Remove old version(s)?`);
          if (removeOld) {
            for (const existing of existingVersions) {
              if (existing.version !== installedVersion) {
                await this.removeVersion(packageName, existing.version);
                logger.info(`Removed ${packageName}@${existing.version}`);
              }
            }
          }
        }
      }

      return true;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Unlink bins for a specific version
   */
  async unlinkBinsForVersion(packageName, version) {
    const versions = await this.getPackageVersions(packageName);
    const versionInfo = versions.find(v => v.version === version);
    if (!versionInfo) return;

    for (const binName of versionInfo.bins || []) {
      const binPath = Path.join(this.globalBinDir, binName);
      try {
        const linkTarget = await Fs.readlink(binPath);
        if (linkTarget.includes(versionInfo.dir)) {
          await Fs.unlink(binPath);
        }
      } catch (err) {
        // Ignore errors
      }
    }
  }

  /**
   * Remove a specific version of a package
   */
  async removeVersion(packageName, version) {
    const versions = await this.getPackageVersions(packageName);
    const versionInfo = versions.find(v => v.version === version);

    if (!versionInfo) {
      return false;
    }

    // Unlink bins if linked
    if (versionInfo.linked) {
      await this.unlinkBinsForVersion(packageName, version);
    }

    // Remove directory
    const pkgDir = Path.join(this.packagesDir, versionInfo.dir);
    await Fs.$.rimraf(pkgDir);

    // Remove from registry
    await this.removeFromRegistry(packageName, version);

    return true;
  }

  /**
   * Remove globally installed package version(s)
   * @param {string} packageSpec - Package name or name@semver pattern
   *   - name: remove all versions (warns if multiple, won't remove linked unless only one)
   *   - name@version: remove exact version
   *   - name@semver: remove all versions matching semver range
   */
  async removeGlobalPackage(packageSpec) {
    // Parse package spec to extract name and optional version/semver
    let packageName, versionSpec;

    if (packageSpec.startsWith("@")) {
      // Scoped package: @scope/name or @scope/name@version
      const lastAt = packageSpec.lastIndexOf("@");
      if (lastAt > 0 && lastAt !== packageSpec.indexOf("@")) {
        // Has version: @scope/name@version
        packageName = packageSpec.substring(0, lastAt);
        versionSpec = packageSpec.substring(lastAt + 1);
      } else {
        packageName = packageSpec;
      }
    } else {
      // Regular package: name or name@version
      const atIndex = packageSpec.indexOf("@");
      if (atIndex > 0) {
        packageName = packageSpec.substring(0, atIndex);
        versionSpec = packageSpec.substring(atIndex + 1);
      } else {
        packageName = packageSpec;
      }
    }

    const versions = await this.getPackageVersions(packageName);

    if (versions.length === 0) {
      logger.error(`${packageName} is not installed globally`);
      return false;
    }

    // Determine which versions to remove
    let toRemove;

    if (!versionSpec) {
      // No version specified - remove all, but warn if multiple
      if (versions.length > 1) {
        logger.warn(`Multiple versions installed: ${versions.map(v => v.version).join(", ")}`);
        const confirmed = await this.promptYesNo(`Remove all ${versions.length} versions?`);
        if (!confirmed) {
          logger.info("Aborted. Specify version to remove: fyn global remove " + packageName + "@<version>");
          return false;
        }
      }
      toRemove = versions;
    } else if (semver.valid(versionSpec)) {
      // Exact version
      toRemove = versions.filter(v => v.version === versionSpec);
      if (toRemove.length === 0) {
        logger.error(`${packageName}@${versionSpec} is not installed`);
        logger.info(`Installed versions: ${versions.map(v => v.version).join(", ")}`);
        return false;
      }
    } else {
      // Semver range
      toRemove = versions.filter(v => semver.satisfies(v.version, versionSpec));
      if (toRemove.length === 0) {
        logger.error(`No versions of ${packageName} match ${versionSpec}`);
        logger.info(`Installed versions: ${versions.map(v => v.version).join(", ")}`);
        return false;
      }
      // Don't remove linked version unless explicitly requested
      const linkedVersion = toRemove.find(v => v.linked);
      if (linkedVersion && toRemove.length > 1) {
        logger.warn(`Skipping linked version ${linkedVersion.version}`);
        toRemove = toRemove.filter(v => !v.linked);
      }
    }

    // Remove the versions
    for (const versionInfo of toRemove) {
      await this.removeVersion(packageName, versionInfo.version);
      logger.info(`Removed ${packageName}@${versionInfo.version}`);
    }

    return true;
  }

  /**
   * List globally installed packages
   * @param {string} [filterName] - Optional package name to filter by
   */
  async listGlobalPackages(filterName) {
    const registry = await this.readInstalledJson();
    const packageNames = Object.keys(registry.packages);

    if (packageNames.length === 0) {
      logger.info("No global packages installed");
      return [];
    }

    // Filter by name if provided
    const namesToShow = filterName
      ? packageNames.filter(name => name === filterName || name.includes(filterName))
      : packageNames;

    if (namesToShow.length === 0) {
      logger.info(`No packages matching '${filterName}'`);
      return [];
    }

    const result = [];

    // Sort package names
    namesToShow.sort();

    for (const packageName of namesToShow) {
      const pkgInfo = registry.packages[packageName];
      const versions = pkgInfo.versions || [];

      if (versions.length === 0) continue;

      // Sort versions by semver (newest first)
      versions.sort((a, b) => {
        if (semver.valid(a.version) && semver.valid(b.version)) {
          return semver.rcompare(a.version, b.version);
        }
        return a.version.localeCompare(b.version);
      });

      console.log(`\n${packageName}:`);

      for (const v of versions) {
        const linked = v.linked ? " *" : "";
        const local = v.local ? " (local)" : "";
        const bins = v.bins?.length > 0 ? ` [${v.bins.join(", ")}]` : "";
        const date = new Date(v.installedAt).toLocaleDateString();

        console.log(`  ${v.version}${linked}${local}${bins}`);
        console.log(`    ${v.dir} - ${date}`);

        result.push({ package: packageName, ...v });
      }
    }

    console.log("\n* = linked (active) version");

    return result;
  }

  /**
   * Link (activate) a specific version of a package
   * @param {string} packageSpec - Package name@version to link
   */
  async linkPackageVersion(packageSpec) {
    // Parse package spec
    let packageName, version;

    if (packageSpec.startsWith("@")) {
      // Scoped package: @scope/name@version
      const lastAt = packageSpec.lastIndexOf("@");
      if (lastAt > 0 && lastAt !== packageSpec.indexOf("@")) {
        packageName = packageSpec.substring(0, lastAt);
        version = packageSpec.substring(lastAt + 1);
      } else {
        packageName = packageSpec;
      }
    } else {
      // Regular package: name@version
      const atIndex = packageSpec.indexOf("@");
      if (atIndex > 0) {
        packageName = packageSpec.substring(0, atIndex);
        version = packageSpec.substring(atIndex + 1);
      } else {
        packageName = packageSpec;
      }
    }

    const versions = await this.getPackageVersions(packageName);

    if (versions.length === 0) {
      logger.error(`${packageName} is not installed globally`);
      return false;
    }

    // If no version specified, show available versions
    if (!version) {
      logger.info(`Installed versions of ${packageName}:`);
      for (const v of versions) {
        const linked = v.linked ? " (linked)" : "";
        console.log(`  ${v.version}${linked}`);
      }
      logger.info(`\nUse: fyn global link ${packageName}@<version>`);
      return false;
    }

    // Find the version to link
    const targetVersion = versions.find(v => v.version === version);

    if (!targetVersion) {
      logger.error(`${packageName}@${version} is not installed`);
      logger.info(`Installed versions: ${versions.map(v => v.version).join(", ")}`);
      return false;
    }

    if (targetVersion.linked) {
      logger.info(`${packageName}@${version} is already linked`);
      return true;
    }

    // Unlink current version's bins
    const currentLinked = versions.find(v => v.linked);
    if (currentLinked) {
      await this.unlinkBinsForVersion(packageName, currentLinked.version);
    }

    // Link new version's bins
    const pkgDir = Path.join(this.packagesDir, targetVersion.dir);
    const bins = await this.discoverBins(pkgDir, packageName);
    await this.linkBins(targetVersion.dir, bins, true);

    // Update registry
    await this.updateLinkedInRegistry(packageName, version, true);

    logger.info(`${packageName}@${version} is now linked`);
    if (Object.keys(bins).length > 0) {
      logger.info(`Binaries: ${Object.keys(bins).join(", ")}`);
    }

    return true;
  }

  /**
   * Update a globally installed package (linked version)
   */
  async updateGlobalPackage(packageName) {
    const linkedVersion = await this.getLinkedVersion(packageName);

    if (!linkedVersion) {
      logger.error(`${packageName} is not installed globally`);
      return false;
    }

    const pkgDir = Path.join(this.packagesDir, linkedVersion.dir);

    logger.info(`Updating ${packageName}@${linkedVersion.version}...`);

    // For local packages, validate path still exists
    if (linkedVersion.local) {
      const localPath = linkedVersion.spec.replace(/^file:/, "");
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
        targetDir: "node_modules",
        centralStore: true,
        production: true,
        lockfile: true,
        fynlocal: linkedVersion.local,
        registry: this.options.registry || "https://registry.npmjs.org",
        layout: "normal",
        flattenTop: true
      },
      _fynpo: false
    });

    await fyn.resolveDependencies();
    await fyn.fetchPackages();

    const installer = new PkgInstaller({ fyn });
    await installer.install();

    // Get the new installed version
    const newVersion = await this.getInstalledVersion(pkgDir, packageName);

    // Re-discover bins
    const bins = await this.discoverBins(pkgDir, packageName);

    // Update registry with new version info
    await this.addToRegistry(packageName, {
      ...linkedVersion,
      version: newVersion,
      bins: Object.keys(bins),
      updatedAt: new Date().toISOString()
    });

    // Re-link bins if linked
    if (linkedVersion.linked) {
      await this.linkBins(linkedVersion.dir, bins, true);
    }

    logger.info(`${packageName} updated to ${newVersion}${linkedVersion.local ? " from local source" : ""}`);
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
