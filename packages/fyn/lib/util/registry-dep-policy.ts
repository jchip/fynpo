// @ts-nocheck
"use strict";

const Semver = require("semver");
const { TRUSTED_URL_TYPES } = require("./lifecycle-script-policy");

//
// Security hardening (opt-in via package.json `fyn.enforceRegistryDeps`):
//
// TRANSITIVE (non-top-level) dependencies must resolve from a published
// registry. A package pulled from a git/github/url-tarball source, or whose
// version selector is not parseable, is rejected. Only the top-level
// package.json may declare such "funny" dependencies.
//
// Accepted for transitive deps:
//   - registry semver / range / dist-tag (e.g. ^1.2.3, 1.x, latest, *)
//   - `npm:` aliases (resolve from a configured registry)
//   - local file:/link:/symlink deps, including fynpo monorepo siblings (which
//     fyn rewrites from semver to a local path during resolution)
//
// Rejected for transitive deps:
//   - github:, git:, git+ssh/https/http/file, http(s) tarball URLs
//   - unparseable version selectors
//

/**
 * @param {string} urlType the urlType from a dependency spec analysis
 * @returns {boolean} true if the urlType refers to a non-registry source
 *   (git/github/url tarball). `npm:` aliases are registry-backed, so false.
 */
function isNonRegistryUrlType(urlType) {
  return Boolean(urlType) && !TRUSTED_URL_TYPES.has(urlType);
}

/**
 * Whether a registry dependency's version selector is parseable: a valid semver
 * range, a coercible version, the wildcard `*`/`x`, an empty spec, or an npm
 * dist-tag (e.g. `latest`, `next`).
 *
 * @param {string} spec the requested version selector
 * @returns {boolean} true if the selector is acceptable for a registry dep
 */
function isValidRegistrySpec(spec) {
  if (spec === undefined || spec === null) {
    return false;
  }
  const s = String(spec).trim();
  if (s === "" || s === "*" || s === "x") {
    return true;
  }
  if (Semver.validRange(s) !== null) {
    return true;
  }
  if (Semver.coerce(s)) {
    return true;
  }
  // npm dist-tag: a single token (letters/digits/_-.) starting with a letter.
  return /^[a-zA-Z][\w.-]*$/.test(s);
}

/**
 * Classify a dependency's source against the registry policy. Intended to be
 * called only for transitive deps (the top-level package.json is unrestricted).
 *
 * @param {object} dep a DepItem (or a plain object) exposing
 *   `{ name, semver, urlType, localType }`
 * @returns {(null|{kind:string, urlType?:string, semver?:string})} null when
 *   the dep is acceptable, otherwise a violation descriptor:
 *   - `{ kind: "url", urlType }`   non-registry git/github/url source
 *   - `{ kind: "semver", semver }` unparseable version selector
 */
function violatesRegistryPolicy(dep) {
  const urlType = dep.urlType;
  if (urlType) {
    // `npm:` alias resolves from a registry - accepted.
    if (TRUSTED_URL_TYPES.has(urlType)) {
      return null;
    }
    // github:/git/git+*/http(s) tarball - rejected.
    return { kind: "url", urlType };
  }

  // local file:/link:/symlink (and fynpo siblings rewritten to a local path) -
  // accepted.
  if (dep.localType) {
    return null;
  }

  // registry dependency - its version selector must be parseable.
  if (!isValidRegistrySpec(dep.semver)) {
    return { kind: "semver", semver: dep.semver };
  }

  return null;
}

module.exports = {
  isNonRegistryUrlType,
  isValidRegistrySpec,
  violatesRegistryPolicy
};
