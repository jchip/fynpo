// @ts-nocheck
"use strict";

const semverUtil = require("./semver");
const { DEP_ITEM, SEMVER } = require("../symbols");

/* eslint-disable complexity */

//
// Security hardening: a package's npm lifecycle scripts (preinstall, install,
// postinstall) are only executed during install when the package came from a
// configured registry, is a local file:/link:/symlink dependency, or is
// explicitly whitelisted in the project's package.json `fyn.allowScripts`.
//
// A package's source is determined from its dependency spec's urlType:
//   - registry semver (e.g. ^1.2.3)         -> no urlType             -> trusted
//   - local file:/link:/symlink/path        -> localType, no urlType  -> trusted
//   - npm: alias (resolves from a registry)  -> urlType "npm"          -> trusted
//   - github:/git/git+*/http(s) tarball      -> urlType set            -> UNTRUSTED
//
// Anything carrying a urlType that isn't a known registry alias is treated as
// untrusted (deny-by-default).
//

// urlTypes that still resolve from a configured registry and are trusted.
const TRUSTED_URL_TYPES = new Set(["npm"]);

/**
 * Derive the source urlType for a resolved package (depInfo).
 *
 * Prefers the DepItem attached to the depInfo, but falls back to analyzing the
 * original requested semver spec so the policy still works for depInfo objects
 * that don't carry a DepItem (e.g. restored from a lockfile).
 *
 * @param {object} depInfo resolved package data
 * @returns {string|undefined} the urlType, or undefined for registry/local
 */
function getUrlType(depInfo) {
  const depItem = depInfo[DEP_ITEM];
  if (depItem && depItem.urlType) {
    return depItem.urlType;
  }

  const spec = (depItem && depItem.semver) || depInfo[SEMVER];
  if (spec) {
    return semverUtil.analyze(spec).urlType;
  }

  return undefined;
}

/**
 * @param {object} depInfo resolved package data
 * @returns {boolean} true if the package source is trusted to run lifecycle
 *   scripts without being explicitly whitelisted.
 */
function isTrustedScriptSource(depInfo) {
  const urlType = getUrlType(depInfo);
  return !urlType || TRUSTED_URL_TYPES.has(urlType);
}

/**
 * Build the candidate whitelist keys for a package. Matching accepts BOTH the
 * original requested spec and the resolved version, e.g. `foo@github:user/repo`
 * and `foo@2.3.0`.
 *
 * @param {object} depInfo resolved package data
 * @returns {string[]} candidate keys, spec form first
 */
function makeAllowKeys(depInfo) {
  const depItem = depInfo[DEP_ITEM];
  const spec = (depItem && depItem.semver) || depInfo[SEMVER];
  const keys = [];
  if (spec) {
    keys.push(`${depInfo.name}@${spec}`);
  }
  if (depInfo.version && depInfo.version !== spec) {
    keys.push(`${depInfo.name}@${depInfo.version}`);
  }
  return keys;
}

/**
 * Fold a single allowScripts entry value into an accumulator. Accepts an array
 * of script names, a single script name, or the wildcard `true`/`"*"` to allow
 * all scripts for the package. Script names are normalized to lowercase.
 *
 * @param {(string[]|string|boolean)} value the allowScripts entry value
 * @param {{allowAll:boolean, scripts:Set<string>}} acc accumulator to fold into
 * @returns {{allowAll:boolean, scripts:Set<string>}} the accumulator
 */
function normalizeAllowEntry(value, acc) {
  if (value === true || value === "*") {
    acc.allowAll = true;
    return acc;
  }

  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (value !== undefined) {
    list = [value];
  }

  for (const s of list) {
    if (s === true || s === "*") {
      acc.allowAll = true;
    } else if (typeof s === "string") {
      acc.scripts.add(s.toLowerCase());
    }
  }

  return acc;
}

/**
 * Evaluate the lifecycle-script policy for a resolved package.
 *
 * @param {object} depInfo resolved package data
 * @param {object} allowScripts the project's package.json `fyn.allowScripts` map
 * @returns {{trusted:boolean, urlType:(string|undefined), allowAll:boolean,
 *   allowed:Set<string>, key:(string|undefined)}} the resolved script policy
 */
function evaluateScriptPolicy(depInfo, allowScripts) {
  const urlType = getUrlType(depInfo);
  const keys = makeAllowKeys(depInfo);

  if (!urlType || TRUSTED_URL_TYPES.has(urlType)) {
    return { trusted: true, urlType, allowAll: true, allowed: new Set(), key: keys[0] };
  }

  const acc = { allowAll: false, scripts: new Set() };
  let matchedKey;
  for (const key of keys) {
    const value = allowScripts && allowScripts[key];
    if (value !== undefined) {
      if (!matchedKey) matchedKey = key;
      normalizeAllowEntry(value, acc);
    }
  }

  return {
    trusted: false,
    urlType,
    allowAll: acc.allowAll,
    allowed: acc.scripts,
    // key to suggest when warning - prefer a matched key, else the spec form
    key: matchedKey || keys[0]
  };
}

/**
 * @param {object} policy result of {@link evaluateScriptPolicy}
 * @param {string} scriptName lifecycle script name (preinstall/install/postinstall)
 * @returns {boolean} whether the script is allowed to run
 */
function isScriptAllowed(policy, scriptName) {
  if (policy.trusted || policy.allowAll) {
    return true;
  }
  return policy.allowed.has(String(scriptName).toLowerCase());
}

module.exports = {
  TRUSTED_URL_TYPES,
  getUrlType,
  isTrustedScriptSource,
  makeAllowKeys,
  evaluateScriptPolicy,
  isScriptAllowed
};
