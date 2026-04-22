# Contributing to the Cline SDK

This document covers onboarding, development workflow, and publishing. For package boundaries and change routing during development, see [AGENTS.md](./AGENTS.md). For architecture and runtime flows, see [ARCHITECTURE.md](./ARCHITECTURE.md). For API details, see [DOC.md](./DOC.md).

This repo is a WIP framework for building and orchestrating AI agents. Full refactors are acceptable when they improve the architecture and all call sites are updated.

## Workspace Overview

### Published SDK Packages

| Package | Owns |
|---------|------|
| `@clinebot/shared` | Contracts, schemas, path helpers, hook engine, extension registry |
| `@clinebot/llms` | Provider settings, model catalogs, manifests, handler creation |
| `@clinebot/agents` | Stateless agent loop, tool orchestration, hook/extension runtime |
| `@clinebot/hub` | Hub discovery, client helpers, and host-side daemon controls |
| `@clinebot/core` | Stateful orchestration, session lifecycle, storage, config, telemetry, and hub runtime services |

### Internal Package

- `@clinebot/enterprise`: enterprise identity, control-plane sync, managed instructions. Excluded from root SDK build/version/publish flows. `@clinebot/core` must stay enterprise-agnostic.

### Apps

- `apps/cli`: CLI host and local hub management
- `apps/code`: Tauri + Next.js desktop app
- `apps/vscode`: VS Code extension
- `apps/examples`: sample consumers and integration examples

## Development Workflow

### Essential Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run build` | Build SDK and CLI |
| `bun run build:sdk` | Build SDK packages only |
| `bun run dev` | Build in development mode |
| `bun run cli` | Run CLI interactively |
| `bun run test` | Run the Vitest suite |
| `bun run types` | Typecheck all packages |
| `bun run lint` / `format` / `fix` | Code quality and formatting |

Package-scoped commands:

```sh
bun -F @clinebot/core build|test|typecheck
bun -F @clinebot/agents build|test|typecheck
```

### Rebuilding

Changes to published SDK packages require `bun run build:sdk`. Direct CLI runs pick up rebuilt packages immediately. Use `dev:*` scripts for automatic rebuilding during development.

Internal-only packages (`packages/enterprise`) are excluded from root build/version/publish flows — work on them with package-scoped commands.

Hub-backed hosts use shared workspace discovery and owned daemon startup logic. If you touch hub bootstrap, preserve the startup lock and owner-scoped discovery behavior so multiple builds can coexist safely.

### Debug Builds

- Set `CLINE_BUILD_ENV=development` for debug builds. Spawned Node/Bun subprocesses get an inspector endpoint plus `--enable-source-maps`.
- By default, child-process inspector ports are ephemeral (`--inspect=127.0.0.1:0`) to avoid collisions across parallel dev runs.
- Set `CLINE_DEBUG_HOST` and `CLINE_DEBUG_PORT_BASE` to opt into deterministic role-based ports. With `CLINE_DEBUG_PORT_BASE=9230`, the roles map to hub `9230`, hook worker `9231`, plugin sandbox `9232`, connector child `9233`, fallback sandbox `9234`.
- Fallback chain: `CLINE_BUILD_ENV` → `NODE_ENV` → Bun `--conditions=development`.
- To debug the CLI process itself: `cd apps/cli && CLINE_BUILD_ENV=development bun --conditions=development --inspect-brk=6499 ./src/index.ts "hey"`.
- The workspace includes a VS Code launch config (`Launch CLI Debugger`) that uses `"type": "bun"` (requires `oven.bun-vscode`).

### Testing

Root commands for cross-package confidence:

```sh
bun run test        # all tests
bun run types       # typecheck all packages
bun run check       # lint + build + typecheck + check-publish
```

If you touch hub/bootstrap/session flows, prefer both unit coverage and an end-to-end sanity check.

## Publishing

### Quick Release (recommended)

The `bun release` script automates the full publish flow — versioning, lockfile regeneration, verification, and publishing — in a single interactive command.

```sh
# SDK packages (@clinebot/{shared,llms,agents,core})
bun release sdk              # auto-increment patch version
bun release sdk 0.1.0        # explicit version
bun release sdk --tag next   # publish with a custom npm dist-tag
bun release sdk --dry-run    # preview without side effects

# CLI (cross-platform binaries, GitHub release, Homebrew tap)
bun release cli              # auto-increment patch version
bun release cli 0.1.0        # explicit version
bun release cli --dry-run    # preview without side effects

# Homebrew only (no version bump or tests — re-publish to tap)
bun release brew             # build, GitHub release, push cask
bun release brew --dry-run   # preview without side effects
```

Additional flags: `--skip-tests`, `--skip-git-tags`.

The script checks out `main` (and pulls latest) before starting. If the working tree is dirty it aborts.

The SDK flow runs: tests → version bump → lockfile regen → tarball verification → publish (shared → llms → agents → core) → git tag `sdk-v{VERSION}`.

The CLI flow runs: tests → version bump → lockfile regen → cross-platform build & GitHub release & Homebrew tap push → git tag `cli-v{VERSION}`.

The Brew flow runs: build binaries → GitHub release → push cask to Homebrew tap. Use this when the version is already bumped and you just need to (re-)publish to Homebrew.

### Manual SDK Publish

If you need fine-grained control over individual steps:

1. `bun run test`
2. `bun version <version>` — updates all workspace package versions, regenerates models, formats, and builds.
3. `rm bun.lock && bun install --lockfile-only` — regenerate the lockfile so `bun pm pack` resolves `workspace:*` to the new versions.
4. `bun scripts/check-publish.ts` — pack tarballs, verify dependency alignment, test isolated install and module resolution.
5. `npm login` — ensure you're authenticated with the npm registry.
6. Publish in dependency order:
   ```sh
   cd packages/shared && bun publish && cd ../llms && bun publish && cd ../agents && bun publish && cd ../core && bun publish && cd ../../
   ```
7. For tagged production releases, create and push a git tag: `git tag -a sdk-v{VERSION} -m "SDK v{VERSION}" && git push origin sdk-v{VERSION}`.

### Workspace Dependency Rules

- Source manifests use `workspace:*` so `bun install` and local builds resolve correctly.
- Published runtime workspace packages stay in `dependencies`. Bundled internals go in `devDependencies` so they don't leak into packed manifests.
- `bun publish` resolves `workspace:*` to concrete versions when packing.

### Verifying a Single Package

Inspect the exact manifest that will be published:

```sh
cd ./packages/core
tmpdir=$(mktemp -d)
bun pm pack --destination "$tmpdir" >/dev/null
tar -xOf "$tmpdir"/*.tgz package/package.json | jq '.version, .dependencies'
```

Check installed versions in a consuming project:

```sh
bun pm ls @clinebot/core @clinebot/agents @clinebot/llms
```

### CI

The CI publish workflow (`.github/workflows/publish-sdk.yaml`) follows the same order: build → version → check-publish → publish (shared → llms → agents → core). It supports `nightly` and `latest` channels and is triggered by manual dispatch or a daily cron.

#### Brew

To publish CLI to the Homebrew tap:

```sh
bun release brew
```

To install or update CLI from brew:

```sh
brew upgrade cline/internal-tap/cline 2>/dev/null || brew install cline/internal-tap/cline
```

### Root Automation Scope

Root scripts are intentionally narrower than the full workspace:

- Root SDK build/test/version/publish flows target the publishable SDK packages only.
- Internal packages can still be built/tested directly, but should not be swept into release automation by accident.
- If you add a new internal package, keep it out of root publish/version/build sweeps unless you explicitly intend to publish it.
