# Design: publish-scoped package filter

Date: 2026-08-11

## Problem

A fynpo monorepo usually contains packages that must never reach the registry — demos,
samples, fixtures, local adapters — alongside the handful that ship. Today fynpo has no way
to express that.

What exists and why each fails:

| mechanism | why it doesn't solve this |
| --- | --- |
| `packages` / `patterns` (top-level) | discovery-wide. Dropping `demo/*` removes it from `bootstrap`, `run`, and `local` too, so the demo stops building. |
| `ignore` / `only` (top-level, or `--ignore`/`--only`) | name-exact, and **dead in the release path** — `makePkgDeps` sets `pkg.ignore` (fynpo-base `index.ts:304-310`) but nothing in changelog/version/publish reads it. `TopoRunner` (`topo-runner.ts:48-64`) does honor `opts.ignore`, so an ignored package silently gets no tgz while still being version-bumped and listed in the `[Publish]` commit. Worst of both. |
| `"private": true` in each package.json | actually works (see gates below) but is per-package, easy to forget on a new package, and can't express "everything under `demo/`". |
| `"fynpo": false` in package.json | drops the package from the graph entirely (`fynpo-dep-graph.ts:580-582`) — excludes it from bootstrap as well. |
| `ignoreChanges` | file globs for change *detection*, not package selection. |

Net: the only working lever is `private`, applied one package at a time.

## Goal

Configure, by path, which packages are eligible to publish — without affecting discovery,
bootstrap, or build.

## Config

Lives under `command.publish`, which is already the established home for release-wide
settings read from the changelog and version code paths via explicit
`_.get(fynpoRc, "command.publish.…")` — see `update-changelog-file.ts:14`
(`command.publish.tags`) and `update-package-versions.ts:11-12`.

```json
{
  "command": {
    "publish": {
      "includePackages": ["path:core/*", "path:dev-tools/*"],
      "excludePackages": ["path:**/samples/**"]
    }
  }
}
```

Both are arrays of `PackageRef` strings (`fynpo-dep-graph.ts:85-157`), which already support
`path:`, `name:`, `id:` prefixes plus `/regex/` and minimatch globs on `path:`. This is the
same matcher `versionLocks` uses (`utils.ts:280-302`), so the syntax is not new to users.

Bare entries follow existing `PackageRef` rules — a mid-string `@` means `id`, otherwise
`name`. **Path globs therefore require the explicit `path:` prefix.**

### Semantics

1. `includePackages` absent or empty → every package is eligible (today's behavior, unchanged).
2. `includePackages` non-empty → a package is eligible only if it matches at least one ref.
3. `excludePackages` is applied after, subtractively, and always wins.
4. `"private": true` remains an independent veto, evaluated separately and unchanged.

Allowlist-first is deliberate: it fails closed. A newly added `demo/fynapp-9` is
unpublishable by default, whereas a denylist-only design silently exposes any new top-level
directory.

### Naming

Not `patterns`/`packages`/`ignore`/`only` — those are live flat option names. `patterns` in
particular is the discovery option (`index.ts:69`); if a `command.publish.patterns` key ever
got merged flat into opts it would silently repoint discovery. `includePackages` /
`excludePackages` cannot collide.

## Where it applies

One choke point, plus defense in depth at the three gates that already handle `private`.

**Primary — `getUpdatedPackages` (`utils/get-updated-packages.ts:66-169`).** Filter the
package set at entry, before the "assume all changed" branch (93-105) and before
`addVersionLocks`/`addDependents` (38-64). Everything downstream inherits it:

- the `Changed Packages` banner stops listing unpublishable packages — today it prints
  `Object.keys(packages)` unfiltered, which reads as "the config isn't working" even when
  `private` is doing its job;
- dependents/version-lock expansion can no longer drag an excluded package back in;
- the `[Publish]` commit body, which `Publish` later parses, is correct by construction.

**Secondary — the existing `private` gates**, so a filter bug can't publish something:

| file:line | change |
| --- | --- |
| `utils/update-changelog-file.ts:72` | `if (pkg.originalPkg.private \|\| !publishable(pkg)) return;` |
| `utils/update-package-versions.ts:112` | same guard alongside the `private` check |
| `publish.ts:123` | add `&& publishable(pkg)` to the final filter |

**Not touched:** `makePkgDeps`, `FynpoDepGraph`, `readFynpoPackages`, `TopoRunner`, and every
non-release command. Discovery and bootstrap behavior are byte-identical.

### Shared helper

```ts
// utils.ts
export function makePublishFilter(fynpoRc: any): (pkg: FynpoPackageInfo) => boolean;
```

Builds `PackageRef` lists once, returns a predicate. Each command builds its own graph
(`execChangelog`/`execVersion`/`execPublish`/`execUpdated` in `index.ts:165-194`), so the
helper takes `fynpoRc` rather than assuming shared state.

## Backward compatibility

With neither key set, every code path is identical to today. No migration.

## Testing

fynpo already runs vitest. Cover:

- include-only, exclude-only, both, neither
- exclude beating include for the same package
- `path:` glob vs bare name vs `id:` vs `/regex/`
- a `private` package that also matches include → still excluded
- an excluded package that is a *dependency* of an included one → not published, and the
  dependent still version-bumps correctly
- the banner: excluded packages absent from `Changed Packages`

## Adjacent bugs found while mapping this

Not part of the feature, but they break monorepos whose packages don't live in `packages/*` —
which is exactly the layout this feature targets. Worth fixing in the same change.

1. **`fynpo prepare` ignores configured patterns.** `execPrepare` (`index.ts:153-163`) uses
   `readPackages` with raw CLI opts and never passes `patterns`, so it always scans the
   default `["packages/*"]`. In a repo laid out as `core/`, `demo/`, `dev-tools/` it finds
   nothing.
2. **Hardcoded `packages/` in git-add paths.** `update-package-versions.ts:124` and
   `prepare.ts:219` build `Path.join("packages", pkg.pkgDir, "package.json")` while the write
   itself uses `pkg.path` (line 130). Wrong file staged for any non-`packages/*` layout.
3. **`Prepare`'s `private` check is dead.** `prepare.ts:208` tests `pkg.private`, but
   `readFynpoPackages` never copies `private` into `PackageInfo` (fynpo-base
   `index.ts:205-212`), so it is always `undefined`.
4. **`makePkgDeps` array-as-map bug.** `!ignores[p]` at fynpo-base `index.ts:271` and `:284`
   indexes an array by package name, always `undefined`, so names get pushed repeatedly.

## Example: the fynmesh repo

Publishes 5 of 48 packages. Today that needs `"private": true` in 43 package.json files, and
a new demo package is publishable until someone remembers. With this feature:

```json
{
  "command": {
    "publish": {
      "includePackages": [
        "path:core/*",
        "path:dev-tools/*",
        "path:rollup-federation/federation-js",
        "path:rollup-federation/rollup-plugin-federation"
      ]
    }
  }
}
```

Four lines, fail-closed, and `demo/`, `misc/`, `demo-rollup-externals/`, and the
`rollup-federation` samples are all excluded without touching a single package.json.
