# `.f` store layout: package dir must end in `node_modules/<name>`

Commit: `debd367 fyn(fix): package dir should always have node_modules prefix`

## 1. Motivation

`fyn` extracts each installed package into a versioned content-addressed store
under `node_modules/.f/_/`. Previously, the real on-disk path for a package was:

```
node_modules/.f/_/<name>/<version>/<name>/
```

Modern bundlers (Turbopack, and increasingly others) use the substring
`node_modules/<name>` in a resolved path as the marker for a package root.
A path like `.../<version>/<name>` does not contain that marker, so these
tools either reject the layout or treat the parent directory as if it were
the package boundary. The store layout needs to put `node_modules/<name>`
at the end of each package's real path.

## 2. Design

Add an extra `node_modules` segment between `<version>` and `<name>` in the
store layout:

| | Old | New |
|---|---|---|
| store path | `.f/_/<name>/<version>/<name>` | `.f/_/<name>/<version>/node_modules/<name>` |
| package root marker | absent | `node_modules/<name>` present |

No other aspects of the layout change. `FV_DIR` (`.f`), the `_` versions
container, the per-package directory, and the per-version directory are all
unchanged. Promoted packages in normal layout (top-level `node_modules/<name>`)
are unaffected.

### Two layout forms, runtime selectable

Both forms are supported simultaneously. Which one a given install uses is
recorded in `node_modules/.f/.fyn.json` (`shortPkgDir: boolean`) so the
next run picks the same form automatically.

| Form | Store path | When |
|---|---|---|
| **long** (default) | `.f/_/<name>/<version>/node_modules/<name>` | new installs |
| **short** | `.f/_/<name>/<version>/<name>` | pre-existing installs, or opt-in via `FYN_SHORT_PKG_DIR=1` |

Selection precedence on each run:

1. If `node_modules/.f/.fyn.json` exists and records `shortPkgDir` →
   use that. `FYN_SHORT_PKG_DIR` that disagrees is logged as a warning
   ("remove node_modules first to change").
2. If `.fyn.json` exists but `shortPkgDir` is absent → treat as **short**
   (this is what a pre-2026 `.fyn.json` looks like; the on-disk store is
   short).
3. Else (fresh install) → respect `FYN_SHORT_PKG_DIR` env var, default
   **long**.

This makes existing installs self-migrating in the no-op sense: they keep
using their on-disk layout indefinitely, no `rm -rf` required. A user who
*wants* to switch must remove `node_modules` first, exactly like changing
the existing `layout` option.

## 3. Implementation

### 3.1 Flag plumbing — `lib/fyn.ts`

A new instance field `Fyn._shortPkgDir` selects between the two forms.
Initial value in the constructor is `Boolean(process.env.FYN_SHORT_PKG_DIR)`
(i.e. false / long by default). The persisted-config reconcile block (next
to the existing `layout` reconcile) overrides it to match what's on disk.

The previously-unused `FYN_NO_PKG_DIR_MATCH_NAME` env flag and the
`_noPkgDirMatchName` instance field were removed; they gated a different
experimental form (`<version>` with no trailing name) and are obsolete.

### 3.2 Path construction — `lib/fyn.ts:886`

`Fyn.getInstalledPkgDir(name, version, pkg)` branches on `_shortPkgDir`:

```ts
if (version) {
  if (this._shortPkgDir) {
    return Path.join(this.getOutputDir(), FV_DIR, "_", name, version, name);
  }
  return Path.join(this.getOutputDir(), FV_DIR, "_", name, version, "node_modules", name);
}
```

### 3.3 Persistence — `lib/fyn.ts:262-281` (load) and `:524-537` (save)

Load: alongside the existing `layout` field reconcile, read
`fynInstallConfig.shortPkgDir`. `undefined` is treated as `true` (legacy
on-disk store). Conflicts with the env var are logged as a warning and the
recorded value wins.

Save: include `shortPkgDir: this._shortPkgDir` in `outputConfig` next to
the existing `layout`.

### 3.4 Cleanup of empty parents — `lib/pkg-installer.ts:655`

`PkgInstaller._cleanUpVersions` walks up from a removed package directory and
`rmdir`s each empty parent. The walk has one extra step in long form (the
`node_modules` segment between the pkg leaf and the version dir), gated on
`this._fyn._shortPkgDir`:

```
long form:
  removed pkg dir:  .f/_/<name>/<version>/node_modules/<name>     ← removed
                    .f/_/<name>/<version>/node_modules            ← long-only: rmdir
                    .f/_/<name>/<version>                         ← rmdir

short form:
  removed pkg dir:  .f/_/<name>/<version>/<name>                  ← removed
                    .f/_/<name>/<version>                         ← rmdir
```

For scoped packages (`@scope/name`), the walk additionally `rmdir`s the
scope directory one level up (inside `node_modules` for long form, inside
`<version>` for short). The `rmdir` calls remain best-effort: any
`ENOTEMPTY` is swallowed (other versions still live there); other errors are
logged.

### 3.5 Test harness — `test/spec/scenarios.spec.ts`

Three changes:

1. **Regen mode (`UPDATE_NM_TREE=1`)**: when set, the assertion block writes
   the observed `nm-tree` to disk instead of comparing against the committed
   fixture.

2. **Parallel short fixtures**: the scenario runner reads either
   `nm-tree.yaml` (default) or `nm-tree-short.yaml` based on
   `process.env.FYN_SHORT_PKG_DIR`. This lets the same scenario suite run in
   both modes with no other infra change.

3. **`clean()` now wipes pkgDir sub-cwds**: a number of scenarios install
   into a nested directory (`pkgDir` on the step action) rather than the
   scenario root. Previously `clean()` only wiped the scenario root's
   `node_modules` / `fyn-lock.yaml`, so stale data from prior runs leaked
   into fresh installs. Now `clean()` also wipes each step's
   `<pkgDir>/node_modules` and `<pkgDir>/fyn-lock.yaml` while preserving
   the committed `package.json`.

### 3.6 Fixtures

Two parallel fixture sets:

- 47 `nm-tree.yaml` (long form, default) — regenerated as part of the
  layout change.
- 44 `nm-tree-short.yaml` (short form) — generated via
  `FYN_SHORT_PKG_DIR=1 UPDATE_NM_TREE=1 mocha …`. Three scenarios that
  have pre-existing pending steps in long mode also have those pending in
  short mode, so they have no short fixture (45 active scenarios − one
  step omitted from the same skip set ≈ 44 files).

Long-form diff against the prior layout: insertion of `node_modules/`
between `<version>/` and `<name>/`, longer cross-package relative paths
(one more `../` per hop), equivalent re-indentation. Short-form fixtures
are mechanically symmetric in the other direction.

### 3.7 Focused persistence spec — `test/spec/short-pkg-dir.spec.ts`

New spec (8 tests) covering what the scenario suite doesn't exercise
directly:

- `FYN_SHORT_PKG_DIR` env-var → `_shortPkgDir` flag flow.
- `getInstalledPkgDir` produces the right path for both forms, including
  scoped names and the version-omitted top-level fallback.
- `saveInstallConfig` writes `shortPkgDir` (`true`/`false`) to
  `node_modules/.f/.fyn.json`.

## 4. Testing

Long mode (default — `xrun xarc/test-only`):
- 164 passing, 7 pending (156 prior + 8 new short-pkg-dir specs).

Short mode (`FYN_SHORT_PKG_DIR=1 mocha … scenarios.spec.ts`):
- 45 scenario tests pass against the parallel `nm-tree-short.yaml`
  fixtures, 4 pre-existing pendings.

Both fixture sets land via the same `UPDATE_NM_TREE=1` regen path —
nothing about the short fixtures is hand-edited. Spot-checked
`local-hard-linking/step-01` (deeply nested intra-store bin symlinks)
under both modes — relative-path arithmetic correct in both directions.

## 5. Cross-repo impact (monorepo sweep)

Searched all sibling packages and docs for any code that hard-codes the
old shape. Symbols and fragments grepped: `.f/_`, `FV_DIR`,
`getInstalledPkgDir`, `getFvDir`, `loadFvVersions`, `localPkgLinks`, and
joins of the form `<name>/<version>`.

Findings:

1. **No external callers.** Every `getInstalledPkgDir` / `getFvDir` /
   `loadFvVersions` call site is inside `packages/fyn/lib/`.
2. **`fynpo`, `fynpo-base`** use `node_modules` only as the standard top-
   level dir name or as a scan exclusion
   (`fynpo-dep-graph.ts:533`, `index.ts:182`). Layout-agnostic.
3. **`pkg-preper`** tarballs packages by reading `package.json` from a
   caller-provided dir. No store-layout knowledge.
4. **`fyn-debug.log` files** in various packages contain old paths but
   are runtime logs, not source — regenerate on next install.
5. **`packages/fyn/docs/fyn-global.md:37`** is a design doc for an
   unshipped "global packages isolation" feature; the illustrative path is
   already abstract and needs no update.
6. **`docusaurus/docs/getting-started/debugging.md:72,79`** documents a
   VSCode sourcemap glob `node_modules/.f/_/@myscope/**/*.js`. The `**`
   matches both old and new layouts; surrounding prose remains accurate.

**Conclusion:** safe to merge from a cross-repo perspective.

## 6. Notable side discoveries

### 6.1 Pre-existing test hygiene bug (fixed here)

`clean()` was scoped to the scenario root and missed nested `pkgDir`
cwds. Stale data from prior runs surfaced as spurious `pkg2/pkg2/`
artifacts in `fynpo-sample`. Fixed as part of §3.3.

### 6.2 Stale install config cache (resolved by §3.3)

`node_modules/.f/.fyn.json` stores `localPkgLinks` keyed by string paths.
Old-layout keys persist across a layout change unless the entire
`node_modules` is removed. With the `shortPkgDir` field now recorded
(§3.3), the install config is no longer ambiguous: fyn uses whichever
layout produced the existing keys. Switching between forms still requires
`rm -rf node_modules`, but that's now an explicit user choice rather than
silent corruption.
