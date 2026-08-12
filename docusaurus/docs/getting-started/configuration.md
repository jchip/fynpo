---
id: configuration
title: Configuration
---


```javascript
{
  changeLogMarkers: ["## Packages", "## Commits"],
  command: { 
    bootstrap: { npmRunScripts: ["build"] },
    publish: {
      tags: {},
      versionTagging: {},
      includePackages: [],
      excludePackages: [],
      allowForeignRepos: false
    }
  },
  forcePublish: [],
  ignoreChanges: [],
  versionLocks: [],
  commitlint: {
  },
}
```
### changeLogMarkers
The markers used to list the changed packages and corresponding commit messages in CHANGELOG.md. This will be used by `fynpo prepare` command to detect the changed packages.

### command.bootstrap.npmRunScripts
npm scripts to run for each package while bootstrapping them. Its recommended to `build` all the packages while bootstrapping for the local package linking to work properly.

### command.publish.tags
To publish to npm with the given npm dist-tag. Users can specify different tags for different packages and also enable/disable tags for individual or multiple packages.

```javascript
  command: {
    publish: {
      tags: {
        tag1: {
          enabled: true, // set false to disable this tag
          packages: {
            "pkg1": true,
            "pkg2": false, // disable tag for pkg2
          },
          addToVersion: true,
        },
        tag2: {
          enabled: true,
          packages: {
            "pkg3": true,
          },
          addToVersion: false,
        },
      },
    },
  }
```

- Above config will add the tag `tag1` to `publishConfig` of `pkg1` and `tag2` to `publishConfig` of `pkg3`.
- `addToVersion` - If enabled, will add the tag name to package version. Example - `1.0.0-tag1.0`

### command.publish.versionTagging
To add `ver[pkgVerison]` as `dist-tag`.

```javascript
command: {
    publish: {
      versionTagging: {
        pkg4: true
      }
    }
}
```

if current version of `pkg4` is `1.0.0`, the above config will add the tag `ver1` to `publishConfig` of `pkg4`.

### command.publish.includePackages

Restrict publishing to the listed packages. A monorepo usually holds packages that must never
reach the registry — demos, samples, fixtures, local adapters — alongside the few that ship.

```javascript
command: {
  publish: {
    includePackages: ["path:core/*", "path:dev-tools/*"]
  }
}
```

When the list is absent or empty, every package is publishable, which is the default. When it is
non-empty, only packages matching an entry may be published. It is an allow list on purpose, so
the config fails closed: a package added later under an unlisted path is not publishable until
someone says it is.

This affects publishing only. Package discovery, `bootstrap`, and `run` never consult it, so
excluded packages still build normally.

A package's own `"private": true` remains an independent veto — a private package is never
published regardless of this setting.

#### Package references

`includePackages` and `excludePackages` take *package refs*, the same syntax as
[versionLocks](#versionlocks):

| ref | matches |
| --- | --- |
| `pkg1` | package **named** `pkg1` |
| `name:pkg1` | same, explicit |
| `pkg1@1.0.0` | package **id** — a `@` in the middle implies an id |
| `id:pkg1@1.0.0` | same, explicit |
| `path:core/*` | package **directory**, as a glob relative to the monorepo root |
| `path:/^core\//` | package directory, as a regular expression |

A bare entry is read as a name (or an id when it contains a `@`), so **directory patterns need
the explicit `path:` prefix** — `core/*` alone will not match a path.

### command.publish.excludePackages

Remove packages from the publishable set. Applied after `includePackages`, and always wins.

```javascript
command: {
  publish: {
    includePackages: ["path:rollup-federation/*"],
    excludePackages: ["path:rollup-federation/share-*"]
  }
}
```

Useful on its own as a deny list, or to carve exceptions out of a broader allow list. Note a deny
list alone fails open — a package added under a new top level directory stays publishable until
someone excludes it.

### command.publish.allowForeignRepos

Default `false`. By default fynpo skips packages that live in a **different git repo nested inside
the monorepo** — a nested clone, a submodule, or a linked worktree — and warns, naming them:

```
> 2 package(s) are in a nested git repo - cannot be released from here:
  vendor/some-lib
  vendor/other-lib
```

Such a package cannot be released by the outer repo. Every git operation in the release path —
change detection, commit collation, the publish commit's changed file list, staging the bumped
version — runs against the outer repo, which has no commits and no tracked files for those paths.
Left unchecked they appear in a release before the first release tag exists, then silently vanish
from every release after it. Release them from inside their own repo instead.

Set to `true` to keep them in the set anyway:

```javascript
command: {
  publish: {
    allowForeignRepos: true
  }
}
```

### forcePublish
List of packages to be force published. Use `*` for all packages.

To force publish all the packages, 

```javascript
{
  forcePublish: ["*"]
}
```

To force publish selected packages,

```javascript
{
  forcePublish: ["pkg1", "pkg2"] 
}
```

### ignoreChanges
Ignore changes in files matched by glob(s) when detecting changed packages.

```javascript
{
  "ignoreChanges": ["**/__tests__/**", "**/*.md"]
}
```

### versionLocks
Group of packages to be version locked together. Use ['*'] to lock the verisons of all the packages together.

Lock versions of all packages:

```javascript
{
  "versionLocks": ["*"]
}
```

Lock versions of selected packages:

```javascript
{
  "versionLocks": [["pkg1", "pkg3"], ["pkg2", "pkg4"]]
}
```
Here pkg1, pkg3 are version locked and pkg2, pk4 are verison locked together.

### commitlint
commit lint configuration. Refer [here](https://commitlint.js.org/#/reference-configuration) for the details of supported configurations.



