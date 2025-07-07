# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**fynpo** is a zero-setup JavaScript monorepo manager that works with multiple packages. It uses `fyn` (a package manager) under the hood and provides commands for bootstrapping, building, testing, and publishing packages in a monorepo structure.

## Key Commands

### Development Commands
- `npm run bootstrap` - Bootstrap all packages (installs dependencies and builds)
- `npm run test` - Run tests across all packages using `fynpo run test --stream`
- `npm run lint` - Run linting across all packages using `fynpo run lint --stream`
- `npm run coverage` - Generate coverage reports across all packages
- `npm run ci:check` - Run CI checks after fyn testing

### Core fynpo Commands
- `fynpo bootstrap` - Install dependencies and build all packages in topological order
- `fynpo run <script>` - Run npm script across packages (with streaming output)
- `fynpo updated` - List packages that have changed since last release
- `fynpo prepare` - Prepare packages for publishing (version bumping)
- `fynpo publish` - Publish packages to npm
- `fynpo version` - Update changelog and bump versions
- `fynpo init` - Initialize a new fynpo repository

### Testing Commands
- Use `fynpo run test` to run tests across all packages
- Individual package tests can be run with `fynpo run test --scope <package-name>`
- Coverage reports are generated with `fynpo run coverage`

## Architecture

### Package Structure
The monorepo consists of several core packages in `/packages/`:

- **fynpo** - Main CLI tool and orchestrator
- **fynpo-base** - Core dependency resolution and package management utilities
- **fynpo-cli** - Command-line interface components
- **fyn** - Package manager (alternative to npm/yarn)
- **create-fynpo** - Package initialization tool

### Key Components

#### FynpoDepGraph (packages/fynpo-base/src/fynpo-dep-graph.ts)
- Manages dependency relationships between packages
- Performs topological sorting for build order
- Handles circular dependency detection

#### Bootstrap (packages/fynpo/src/bootstrap.ts)
- Installs dependencies across all packages
- Builds packages in dependency order
- Handles caching and incremental builds

#### TopoRunner (packages/fynpo/src/topo-runner.ts)
- Executes tasks across packages in topological order
- Manages concurrency and error handling
- Provides streaming output with package prefixes

#### Caching System (packages/fynpo/src/caching.ts)
- Implements build caching to avoid redundant work
- Supports remote caching servers
- Handles cache invalidation based on file changes

### Configuration Files
- `fynpo.json` - Main configuration file defining packages, caching, and build settings
- `package.json` - Standard npm package configuration
- `fyn-lock.yaml` - Lock file for fyn package manager (similar to package-lock.json)

### Build System
- Uses TypeScript with compilation to `dist/` directories
- Webpack for bundling CLI tools
- SWC for fast TypeScript compilation
- Jest for testing with TypeScript support

## Development Workflow

1. **Initial Setup**: Run `npm run bootstrap` to install dependencies and build all packages
2. **Development**: Make changes to individual packages
3. **Testing**: Use `fynpo run test` to run tests across affected packages
4. **Linting**: Run `npm run lint` before committing
5. **Building**: Packages are built automatically during bootstrap or with `fynpo run build`

## Important Notes

- This is a TypeScript monorepo with strict type checking
- All packages use `fyn` instead of npm/yarn for dependency management
- The project has comprehensive test coverage requirements (100% coverage expected)
- Build artifacts go in `dist/` directories and are excluded from git
- The project uses xrun for task automation in individual packages
- Caching is enabled by default to speed up builds and tests