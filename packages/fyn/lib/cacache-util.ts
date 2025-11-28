// @ts-nocheck
/**
 * cacache refresh utilities
 *
 * Problem: cacache doesn't provide a way to track when cached data was last refreshed.
 * Using cacache.index.insert() to update metadata creates append-only history
 * causing massive file bloat (GB over time with frequent refreshes).
 *
 * Solution: Update bucket file mtime (filesystem metadata only) to track refresh time.
 * Safe because cacache's integrity checks verify file CONTENTS, not metadata.
 *
 * How fyn uses this:
 * 1. When checking cache: Read bucket mtime to see when metadata was last refreshed
 * 2. If age < 30 min: Use cached package metadata (avoid hitting npm registry)
 * 3. If age > 30 min: Fetch fresh from registry, then update mtime
 * 4. After fetching: Call refreshCacheEntry() to update mtime to current time
 *
 * cacache doesn't know or care about mtime - it only verifies actual data contents.
 * The mtime is just fyn's bookkeeping to track "last refreshed from npm at X time".
 */

const cacache = require("cacache");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

/**
 * Update cache entry refresh timestamp by modifying bucket file mtime.
 * Does not modify file contents, only filesystem metadata.
 * Errors are silently ignored (cache refresh is non-critical).
 */
async function refreshCacheEntry(cache, key) {
  const bucket = getBucketPath(cache, key);
  const time = new Date();
  try {
    await fs.utimes(bucket, time, time);
  } catch (err) {
    // Ignore errors - cache refresh is non-critical
    // Common errors: ENOENT (bucket doesn't exist), EPERM (permissions)
  }
}

/**
 * Get cache entry info with refreshTime added from bucket mtime.
 * Returns standard cacache.get.info() result plus refreshTime field.
 * Returns null if entry not found.
 */
async function getCacheInfoWithRefreshTime(cache, key) {
  const bucket = getBucketPath(cache, key);

  try {
    const [info, bucketStat] = await Promise.all([cacache.get.info(cache, key), fs.stat(bucket)]);

    if (!info) {
      return null;
    }

    // Add refreshTime from bucket mtime
    return {
      ...info,
      refreshTime: bucketStat.mtimeMs
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Get bucket file path for a cache key.
 * Calculates path using same algorithm as cacache (SHA256 + directory segments).
 * Reads index version from cacache/package.json for compatibility.
 */
function getBucketPath(cache, key) {
  const hashed = hashKey(key);
  const indexV = require("cacache/package.json")["cache-version"].index;
  return path.join(
    cache,
    `index-v${indexV}`,
    hashed.slice(0, 2),
    hashed.slice(2, 4),
    hashed.slice(4)
  );
}

/**
 * Hash a cache key using SHA256 (matches cacache's algorithm).
 */
function hashKey(key) {
  return crypto
    .createHash("sha256")
    .update(key)
    .digest("hex");
}

module.exports = {
  refreshCacheEntry,
  getCacheInfoWithRefreshTime,
  getBucketPath,
  hashKey
};