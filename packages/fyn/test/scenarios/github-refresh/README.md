# GitHub Refresh Testing

This scenario tests GitHub package dependency cache refresh functionality with real GitHub repositories.

⚠️ **WARNING**: This scenario pushes commits to real GitHub repositories and is skipped by default to avoid polluting repos. Only run manually when needed.

## Testing Approaches

### Approach 1: Time Manipulation (Recommended)
Manipulate the cache bucket mtime to simulate stale cache without waiting:

1. **Step 1**: Install git dependency (creates cache with current timestamp)
2. **Step 2**: Manually set cache bucket mtime to be older than `META_CACHE_STALE_TIME` (30 minutes)
3. **Step 3**: Install again and verify cache is refreshed (new tarball created)

**Pros**: Fast, deterministic, doesn't require actual git repo changes
**Cons**: Requires direct filesystem manipulation

### Approach 2: Local Git Repository
Use a local git repository that can be modified:

1. **Step 1**: Create a local git repo fixture
2. **Step 2**: Install from branch/tag (creates cache)
3. **Step 3**: Make a new commit to the branch
4. **Step 4**: Set cache mtime to be stale
5. **Step 5**: Install again and verify new commit is fetched

**Pros**: Tests real git behavior
**Cons**: More complex setup, requires git operations

### Approach 3: Mock Pacote Git Fetcher
Mock pacote's git fetching to control behavior:

1. Mock pacote to return different commit hashes
2. Verify cache refresh logic triggers correctly
3. Unit test the refresh logic in isolation

**Pros**: Fast, isolated, no git operations
**Cons**: Doesn't test real git integration

### Approach 4: Scenario with Time Wait
Use setTimeout to wait for staleness (like cacache-util tests):

1. **Step 1**: Install git dependency
2. **Step 2**: Wait for `META_CACHE_STALE_TIME + buffer`
3. **Step 3**: Install again and verify refresh

**Pros**: Simple, tests real timing
**Cons**: Slow (30+ minutes), not practical for CI

## Recommended Implementation

Use **Approach 1** (Time Manipulation) combined with a local git repo fixture:

1. Create a local git repository in `test/fixtures/git-test-repo/`
2. Use `fs.utimes()` to manually age the cache bucket
3. Verify that stale cache triggers refresh
4. Verify that fresh cache uses cached tarball

This gives us:
- Fast execution (no waiting)
- Real git behavior (actual git repo)
- Deterministic results (controlled cache age)

## github-refresh vs git-refresh-local

There are two related scenarios:

- **github-refresh**: Tests with real GitHub repositories (requires push access) - **SKIPPED BY DEFAULT**
- **git-refresh-local**: Tests with local git repositories (no network required) - **RUNS BY DEFAULT**

Both test git dependency refresh logic but with different repository types.
