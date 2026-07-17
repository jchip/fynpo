# Fyn local exports plan

## Goal

Allow a locally resolved package to declare source directories that fyn exposes in each consuming package outside `node_modules`. The exposed directories remain live views of the producer's canonical source, so a source edit is visible without copying files, rerunning fyn, or running a watcher.

The normal package installation remains unchanged. A consumer can use the installed package from `node_modules`, configure a development tool to use a local export under `_fyn`, or use both for different entry points.

## Configuration contract

The producer declares an object under `fyn.localExports`. Each key is a logical export name and each value is a directory relative to the producer package root.

```json
{
  "name": "@acme/ui",
  "fyn": {
    "localExports": {
      "src": "./src",
      "themes": "./assets/themes"
    }
  }
}
```

When `@acme/ui` resolves from a fynpo package or an explicit filesystem dependency, fyn creates this consumer-owned layout:

```text
<consumer>/_fyn/@acme/ui/src    -> <producer>/src
<consumer>/_fyn/@acme/ui/themes -> <producer>/assets/themes
```

The package name retains its npm scope as directory components. The producer chooses export names and source directories but cannot choose arbitrary paths in the consumer. `fyn.localExports` is independent of Node's `exports` field and npm's `files`/ignore rules; a producer may deliberately expose `src` locally while excluding it from its published package.

`package-fyn.json` may provide or override `fyn.localExports` because fyn already merges that file into local package metadata. This permits a local-only declaration without adding it to the published `package.json`.

The merged contract is `false | Record<exportName, sourcePath | false>`. `false`, `{}`, or a missing field means no exports. A `false` entry disables that named export, allowing `package-fyn.json` to remove a declaration inherited from `package.json`; setting the whole field to `false` disables all inherited declarations.

## Fixed first-version decisions

- Only directories are supported. Fyn creates a directory symlink on Unix and a junction on Windows.
- Every destination is derived as `_fyn/<package-name>/<export-name>`.
- `_fyn` is disposable, fyn-managed state. Fyn never writes a local export outside it.
- All resolved eligible local packages are considered, including local transitive dependencies. Two resolved versions that claim the same destination cause an install error.
- Export names are one safe path segment. Empty names, `.`, `..`, path separators, absolute paths, and overlapping destinations are rejected.
- Source paths must be non-empty relative paths to existing directories. Their real paths must remain inside the producer package root; `node_modules`, `.git`, and escapes through `..` or symlinks are rejected.
- Missing, empty, or disabled configuration has no effect. Malformed configuration on an eligible local package fails the install instead of leaving an ambiguous or stale projection.
- No watcher, copying mode, glob selection, destination templates, individual-file links, Vite plugin, or generated Vite/TypeScript configuration is included.

## Dependency eligibility boundary

Eligibility comes from resolution provenance, not from the presence of `fyn.localExports` and not from an on-disk source path.

The first version accepts the current supported hard-local resolution (`depInfo.local === "hard"`), which covers:

- fynpo packages rewritten to local filesystem dependencies;
- `file:` dependencies;
- `link:` dependencies;
- explicit relative, absolute, and home-relative filesystem paths already recognized by fyn.

The feature never processes declarations from:

- configured or public registries;
- Git, GitHub, or `git+file:` dependencies;
- HTTP(S) tarballs or other URL sources;
- packages merely unpacked, cached, hard-linked from a download cache, or present in a central store.

The implementation should use an explicit local-provenance predicate that requires the resolver's supported hard-local marker and no effective URL provenance. The existing dependency-source helper can detect a local path inherited from a Git/URL parent; that case must remain ineligible. The predicate must not infer eligibility from `dist.fullPath`, because Git and cached packages can also have filesystem locations. Remote packages carrying the same field are installed normally and their `fyn.localExports` declaration is ignored.

## Managed layout and state

Fyn owns the complete `_fyn` tree once it creates it. A small `_fyn/.fyn-local-exports.json` manifest serves as the ownership marker and records package name, resolved version, export name, consumer-relative source, consumer-relative destination, and link target. On Windows, a source on another drive remains absolute because no relative path exists.

Fyn also records the desired manifest in its existing install configuration under `node_modules/.f/.fyn.json`. That copy lets `fyn sync-local` recreate the projection if the entire disposable `_fyn` tree is removed.

On each successful install, fyn computes the complete desired export map, then reconciles it with the manifest:

1. Refuse to modify a pre-existing `_fyn` directory that has no valid fyn ownership marker.
2. Reject duplicate or overlapping destinations before changing the filesystem.
3. Leave the complete tree unchanged when its manifest and links already match.
4. Otherwise, build the complete desired tree beside `_fyn` and replace the managed tree only after it is ready.
5. Remove the managed `_fyn` tree when no desired exports remain.

Link targets should be relative on Unix so a monorepo or worktree can move as a unit. Windows junction creation should use the existing platform-aware directory-link utility. Reconciliation must compare resolved targets correctly on both platforms.

`scanFileStats` should ignore `_fyn`; it is derived state and must not cause a new install. Existing local-package change detection continues to inspect canonical producer directories. Source file edits, additions, and deletions require no projection refresh because consumers see them through directory links.

`fyn sync-local` should also reconcile the recorded local exports. Its role is repairing or recreating missing links and applying recorded configuration, not copying changed source files.

The realized projection does not belong in `fyn-lock.yaml` because it does not change dependency resolution. The source declaration remains in package metadata, and the `_fyn` manifest records disposable realized state.

## Implementation seams

### 1. Parse and plan local exports

Add a small module under `packages/fyn/lib/` responsible for:

- checking eligible local provenance;
- reading `depInfo.json.fyn.localExports` after local metadata and local build processing are complete;
- checking configuration and source/destination boundaries;
- producing a normalized desired map without filesystem mutation;
- detecting package/version/export collisions across the complete resolved graph.

Keep planning separate from reconciliation so all errors are found before fyn changes `_fyn`.

### 2. Reconcile after dependency installation

Integrate the planner with `PkgInstaller` after dependency lifecycle scripts and optional-dependency removals have completed, but before `_saveLockData`. At that point local builds are complete, every `depInfo.json` is loaded, failed optional packages can be excluded, and the projection is ready before the consumer's install/postinstall/prepare scripts run.

Do not use `npm-packlist` or `hardLinkDir.link`; local exports intentionally have a different file-selection contract. Reuse the existing platform-aware directory-link operations where their current behavior matches the required safe reconciliation.

### 3. Support repair and no-change behavior

Extend `FynCli.syncLocalLinks` to reconcile the local-export manifest in addition to refreshing normal hard-linked packages. Add `_fyn` to the generated-state exclusions used by the consumer file-stat scan.

Normal `node_modules` cleanup remains independent. Removing a dependency or its `localExports` entry is handled by `_fyn` reconciliation, not by package-store cleanup.

### 4. Document consumer integration

Document that fyn only creates stable source surfaces. Consumers remain responsible for Vite aliases, TypeScript paths, or equivalent tool configuration. With Vite's default realpath behavior, the target is outside `node_modules`; projects whose Vite filesystem boundary excludes the producer path may need an explicit `server.fs.allow` rule. Fyn should not mutate application tool configuration.

Document `_fyn/` as generated content that should be excluded from Git, package publication, and fynpo build-cache inputs. Fyn must not edit a consumer's root `.gitignore` or npm packaging configuration automatically.

## Test-first implementation sequence

### Phase 1: configuration and provenance tests

Add focused specs for the pure planning behavior before implementation:

- fynpo, `file:`, `link:`, and explicit path dependencies are eligible;
- registry, Git/GitHub, `git+file:`, URL tarball, cache, and central-store packages are ineligible even when their package JSON contains `fyn.localExports`;
- `package-fyn.json` declarations are available on eligible local metadata;
- package/package-fyn precedence and per-export/all-export `false` tombstones behave deterministically;
- malformed shapes, unsafe export names, absolute/escaping sources, symlink escapes, non-directories, and destination overlaps fail without filesystem changes;
- scoped and unscoped package destinations are deterministic;
- two local versions claiming the same destination fail clearly.

Success check: the focused tests fail for the missing feature and demonstrate the complete configuration and trust boundary.

### Phase 2: link reconciliation tests

Add unit specs around the managed `_fyn` reconciler:

- create Unix directory links and Windows junctions through the platform abstraction;
- retain correct links and repair broken or incorrect links;
- remove stale exports, removed packages, and empty scope directories;
- refuse an unmarked pre-existing `_fyn` tree;
- preserve no content outside the managed root;
- expose source edits, atomic file replacements, additions, and deletions immediately through the linked directory without another fyn process;
- leave the previous valid manifest intact when planning fails.

Success check: link behavior is deterministic and the live-source assertion passes without invoking `fyn sync-local` between the source mutation and consumer read.

### Phase 3: installer scenario

Add a scenario near `test/scenarios/local-hard-linking` with a producer whose npm `files` field includes only `dist`, while `fyn.localExports.src` points to an excluded `src` directory. Cover:

- the published-form install still lacks `src` under `node_modules`;
- `_fyn/<package>/src` points to the canonical source;
- consumer lifecycle scripts can read the projection;
- changing and deleting producer source is immediately reflected;
- removing the declaration or dependency cleans the managed projection;
- an optional local dependency that fails installation leaves no projection;
- a remote package with the same declaration creates no `_fyn` entry.

Include one scoped producer. Run the relevant scenario in both long and short package-store layouts because `_fyn` must remain independent of that choice.

Success check: the scenario passes without adding Vite as a test dependency and proves the filesystem semantics Vite needs.

### Phase 4: regression checks

Run the focused specs, the local-hard-linking scenarios, the full fyn test command, and lint using repository-approved `fyn`, `xrun`, or `nvx` commands. Do not use `npm` or `npx`.

Success check: existing installs without `fyn.localExports` have identical `node_modules`, lockfile, lifecycle, and no-change behavior; the full fyn suite and lint pass.

## Delivery check

The implementation is complete when producer-declared directories from eligible local packages appear as live managed links under `_fyn`, remote packages can never create those links, stale links are removed safely, no watcher is required, and all focused and regression tests pass.
