"use strict";

/**
 * Helper functions for creating npm environment variables.
 * Matches npm 11+ minimal approach.
 */

/**
 * Initialize base environment by filtering out npm_* variables
 *
 * @param {Object} fromEnv - Source environment (defaults to process.env)
 * @param {boolean} production - Whether to set NODE_ENV=production
 * @returns {Object} Filtered environment object
 */
function initEnv(fromEnv, production) {
  fromEnv = fromEnv || process.env;

  const env = {};
  for (const key in fromEnv) {
    if (!key.match(/^npm_/)) {
      env[key] = fromEnv[key];
    }
  }

  // express and others respect the NODE_ENV value.
  if (production) {
    env.NODE_ENV = "production";
  }

  return env;
}

/**
 * Create npm_package_* and npm_config_* environment variables
 * Matches npm 11's minimal approach - only adds npm_package_name, npm_package_version, npm_package_json
 * and minimal npm_config_* variables
 *
 * @param {Object} data - Package.json or config object
 * @param {Object} opts - Options object
 * @param {Object} opts.config - npmrc config to add as npm_config_*
 * @param {boolean} opts.production - Whether to set NODE_ENV=production
 * @param {string} opts.nodeOptions - Value for NODE_OPTIONS
 * @param {string} prefix - Prefix for environment variables (default: 'npm_package_')
 * @param {Object} env - Optional base environment (if not provided, creates from process.env)
 * @returns {Object} Environment object with npm_* variables
 */
function makeNpmEnv(data, opts, prefix, env) {
  opts = opts || {};
  prefix = prefix || "npm_package_";

  if (!env) {
    env = initEnv(process.env, opts.production);
  } else if (!data.hasOwnProperty("_lifecycleEnv")) {
    // Mark that we've already processed this data object
    Object.defineProperty(data, "_lifecycleEnv", {
      value: env,
      enumerable: false
    });
  }

  if (opts.nodeOptions) {
    env.NODE_OPTIONS = opts.nodeOptions;
  }

  // Add minimal npm_config_* variables from config (matching npm 11 behavior)
  if (opts.config) {
    const minimalConfigKeys = [
      "global_prefix",
      "noproxy",
      "local_prefix",
      "globalconfig",
      "userconfig",
      "init_module",
      "npm_version",
      "node_gyp",
      "cache",
      "user_agent",
      "prefix"
    ];

    for (const key in opts.config) {
      // Convert camelCase to snake_case for matching
      const normalizedKey = key.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");

      if (minimalConfigKeys.includes(normalizedKey) || minimalConfigKeys.includes(key)) {
        const envKey = `npm_config_${normalizedKey}`;
        const val = opts.config[key];
        if (val != null && typeof val !== "function") {
          env[envKey] = String(val);
        }
      }
    }
  }

  // Add only minimal npm_package_* variables (matching npm 11 behavior)
  // npm 11 only sets: npm_package_name, npm_package_version, npm_package_json
  if (data.name) {
    env.npm_package_name = String(data.name);
  }
  if (data.version) {
    env.npm_package_version = String(data.version);
  }

  return env;
}

module.exports = { initEnv, makeNpmEnv };
