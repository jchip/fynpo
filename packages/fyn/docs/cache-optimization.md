# Cache Optimization and Custom Dependencies

## Overview

Fyn uses customized versions of core npm packages (`make-fetch-happen`, `npm-registry-fetch`, `pacote`) to implement aggressive cache optimizations. These customizations bypass HTTP cache-control semantics to reduce registry hits.

**Note**: These customizations were implemented in April 2020 and may need reevaluation.

## The Historical Problem (2020)

When these optimizations were implemented in April 2020, there were concerns about HTTP cache behavior. The customizations were designed to address:

**Hypothetical issues:**
- HTTP headers might mark packuments as requiring frequent revalidation
- HTTP `max-age` values might be too short
- Standard caching might cause excessive registry hits

**Current Reality (2025):**

Testing the npm registry today shows:
```bash
$ curl -I https://registry.npmjs.org/lodash
cache-control: public, max-age=300
```

The npm registry returns `max-age=300` (5 minutes), which is actually **more aggressive than fyn's 30-minute window** for allowing cached responses without revalidation.

## Questions to Investigate

1. **Does npm CLI actually have performance issues?**
   - npm is widely used and doesn't appear to have caching performance problems
   - npm uses the same underlying packages (make-fetch-happen, pacote)

2. **What was the original issue?**
   - The customization was added ~5 years ago (April 2020)
   - npm/registry behavior may have changed since then
   - The original problem may no longer exist

3. **Is the optimization still needed?**
   - HTTP cache-semantics with 5-minute max-age seems reasonable
   - The 30-minute custom window may be overly aggressive
   - Potential risk of using stale metadata for 30 minutes

## Fyn's Solution

Fyn implements a **custom cache management strategy** with a 30-minute staleness window, independent of HTTP cache-control headers.

### Custom Cache Strategy (pkg-src-manager.js)

#### 1. Manual Cache Key Construction
```javascript
// Line 541
const cacheKey = `make-fetch-happen:request-cache:full:${packumentUrl}`;
```

Fyn manually constructs the cache key that `make-fetch-happen` would create internally, ensuring control over cache storage location.

#### 2. Direct Cache Access
```javascript
// Lines 609-637
cacache.get(this._cacheDir, cacheKey, { memoize: true })
  .then(async cached => {
    const stale = Date.now() - cached.refreshTime;
    if (stale < META_CACHE_STALE_TIME) {  // 30 minutes
      // Use cached data WITHOUT revalidation
      return packument;
    }
    // Otherwise, queue network fetch
  })
```

Fyn **bypasses** pacote/make-fetch-happen's cache lookup and directly reads from `cacache` to check freshness using its own logic.

#### 3. Bypass HTTP Cache Policy When Fetching
```javascript
// Lines 325-326
pacote.packument(pkgName, {
  "cache-policy": "ignore",    // Don't check http-cache-semantics!
  "cache-key": qItem.cacheKey, // Use our cache key
  memoize: false
})
```

When a network fetch is required, fyn tells the dependencies to:
- **Ignore HTTP cache policy**: Don't let cache-control headers dictate behavior
- **Use custom cache key**: Ensure data is stored where fyn expects it
- **Disable memoization**: Let fyn handle its own memoization strategy

### Custom Staleness Logic

```javascript
// Line 44
const META_CACHE_STALE_TIME = 30 * 60 * 1000; // 30 minutes
```

Instead of respecting HTTP `max-age` or `expires` headers, fyn uses a **fixed 30-minute window**. Packument cache entries are considered fresh if they were written less than 30 minutes ago, regardless of what the npm registry's cache headers say.

## Required Customizations

To support this strategy, fyn maintains custom patches in `other-repos/`:

### 1. make-fetch-happen (v4.0.1 customized)

**Customization**: Allow caller to specify `cacheKey` and make cache policy ignorable

**Changes**:
- `cache.js`: Accept `opts.cacheKey` to override automatic key generation (lines 43, 121, 225)
- `index.js`: Add `opts.cachePolicy` option - when set to `"ignore"`, skip `http-cache-semantics` storability check (line 348)
- `cache.js` & `index.js`: Pass `cachedRes` parameter to track cache integrity across updates

**Why needed**: Allows fyn to control exactly where cache data is stored and bypass HTTP cache-control validation.

### 2. npm-registry-fetch (v3.8.0 customized)

**Customization**: Add `cache-policy` and `cache-key` options

**Changes**:
- `config.js`: Add `cache-policy` and `cache-key` to accepted options (lines 65-66)
- `index.js`: Pass these options through to `make-fetch-happen` (lines 94-95)

**Why needed**: Allows fyn to pass cache control options from pacote → npm-registry-fetch → make-fetch-happen.

### 3. pacote (v9.4.0 customized)

**Customization 1**: Add `cache-policy` and `cache-key` options for packument fetching

**Changes**:
- `lib/util/opt-check.js`: Add `cache-policy` and `cache-key` to accepted options (lines 35-38)
- `lib/fetchers/registry/packument.js`: Pass these options to `npm-registry-fetch` (lines 44-45)
- `lib/fetchers/registry/packument.js`: Modify `pickMem()` to support `memoize: false` and lazy MEMO initialization

**Why needed**: Allows fyn to pass cache control options from pacote API down to underlying dependencies.

**Customization 2**: Try HTTPS before Git for hosted repositories

**Changes**:
- `lib/fetchers/git.js`: Modified `hostedManifest()` to try HTTPS first, then fall back to Git protocol

**Why needed**: HTTPS is faster and more reliable for public repos. Git protocol often blocked by corporate firewalls.

**Status**: ✅ This customization is **already in official pacote v21+** - no longer needed!

## Official Package Versions vs Customized Versions

### Current Usage (package.json)
```json
{
  "make-fetch-happen": "^15.0.2",    // Using official version
  "npm-registry-fetch": "^19.1.0",   // Using official version
  "pacote": "^21.0.3"                // Using official version
}
```

### Customized Versions (other-repos/)
```
other-repos/make-fetch-happen/     v4.0.1 + custom patches
other-repos/npm-registry-fetch/    v3.8.0 + custom patches
other-repos/pacote/                v9.4.0 + custom patches
```

## Status of Customizations in Official Versions

❌ **make-fetch-happen v15.0.2**: Does NOT have customizations
- Completely rewritten architecture
- No support for custom `cacheKey` option
- No support for `cachePolicy: "ignore"` option
- Cache key generation is hardcoded in `lib/cache/key.js`
- HTTP cache semantics always enforced via `lib/cache/policy.js`

❌ **npm-registry-fetch v19.1.0**: Does NOT have customizations
- No `cache-key` or `cache-policy` options in config
- Cannot pass these options to make-fetch-happen

⚠️ **pacote v21.0.3**: Partially compatible
- ❌ No `cache-key` or `cache-policy` options
- ❌ Cache customizations not present
- ✅ HTTPS-first git hosting already implemented (no longer needed!)

## Performance Impact

These customizations provide significant performance benefits:

### Without Customizations (respecting HTTP cache-control)
- Every packument might require revalidation request
- Typical install might make 100+ revalidation requests
- Each revalidation adds 50-200ms network latency
- Total overhead: **5-20+ seconds per install**

### With Customizations (30-minute cache window)
- Cached packuments used without revalidation for 30 minutes
- Typical install with warm cache: **0-5 revalidation requests**
- Dramatically reduced network I/O
- Total time saved: **5-20+ seconds per install**

### Use Cases Most Benefited
1. **CI/CD pipelines** - Multiple builds within 30 minutes share cache
2. **Development iterations** - Frequent installs during development
3. **Monorepo workflows** - Multiple projects sharing cache
4. **Corporate networks** - Reduces load on internal registry mirrors

## Migration Considerations

To use official versions of these packages, fyn would need to either:

### Option 1: Apply Patches to New Versions
- Port customizations to make-fetch-happen v15+
- Port customizations to npm-registry-fetch v19+
- Port customizations to pacote v21+
- Maintain patches going forward

### Option 2: Use Customized Versions from other-repos/
- Continue using customized older versions
- Risk: Missing bug fixes and features from newer versions
- Risk: Potential security vulnerabilities in older versions

### Option 3: Refactor Fyn's Cache Strategy
- Remove dependency on custom cache keys and policy bypass
- Implement alternative cache optimization strategy
- Potentially accept performance degradation
- Most compatible with future versions

## Critical Analysis

### The 30-Minute vs 5-Minute Question

**NPM Registry**: `max-age=300` (5 minutes)
**Fyn Custom**: 30 minutes before revalidation

**Questions:**
1. Why does fyn need 30 minutes when npm registry allows 5 minutes?
2. Has the performance benefit been measured recently (2024-2025)?
3. Does npm CLI have the "performance issues" that fyn is avoiding?

### Potential Issues with Current Approach

1. **Using stale metadata**: 30-minute window means you could install packages based on metadata that's up to 30 minutes old
2. **Version publication race**: New package version published → takes up to 30 minutes to see it
3. **Security updates**: Critical security fix published → delayed visibility

### Performance Testing Needed

The claimed "5-20+ seconds" performance benefit needs validation:
- When was this measured?
- Under what conditions?
- Is this still true with modern npm registry infrastructure?
- How does this compare to npm CLI performance today?

## Recommendation

### Short Term
**Investigate before migrating**: These customizations were added 5 years ago (April 2020). Before investing effort to port them to newer versions:

1. **Measure actual performance impact** (2025 conditions)
   - Compare fyn with customizations vs. without
   - Compare against npm CLI performance
   - Test with modern npm registry infrastructure

2. **Evaluate the trade-offs**
   - Is 30-minute staleness acceptable?
   - What's the actual performance gain with current registry?
   - Are there alternative approaches?

### Long Term

**Option A: Eliminate customizations** (Recommended for investigation)
- Test if modern npm registry + standard caching is "good enough"
- 5-minute cache is already quite aggressive
- Reduces maintenance burden significantly
- Aligns with standard npm tooling behavior

**Option B: Keep customizations**
- Only if performance testing shows significant benefit
- Port patches to make-fetch-happen v15+, npm-registry-fetch v19+, pacote v21+
- Maintain patches across future updates
- Document the specific use cases that benefit

**Option C: Hybrid approach**
- Use standard packages by default
- Allow opt-in to aggressive caching via config flag
- Best of both worlds: safety + performance when needed

The key insight: **npm doesn't seem to have performance issues**, so we should question whether these customizations are solving a real problem or an imagined one from 2020.

## Related Files

- `lib/pkg-src-manager.js` - Main cache strategy implementation
  - Lines 541-680: Cache key construction and lookup logic
  - Lines 318-344: Pacote request with custom options
- `lib/cacache-util.js` - Cache utilities including refresh time tracking
- `other-repos/make-fetch-happen/` - Customized make-fetch-happen source
- `other-repos/npm-registry-fetch/` - Customized npm-registry-fetch source
- `other-repos/pacote/` - Customized pacote source

## See Also

- [npm cache behavior](../npm-behavior.md)
- [cacache](https://github.com/npm/cacache) - Content-addressable cache used by npm
- [http-cache-semantics](https://github.com/kornelski/http-cache-semantics) - HTTP cache-control parser
