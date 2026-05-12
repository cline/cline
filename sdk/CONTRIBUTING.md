# Contributing to the Cline SDK

This document covers onboarding, development workflow, and publishing. For package boundaries and change routing during development, see [AGENTS.md](./AGENTS.md). For architecture and runtime flows, see [ARCHITECTURE.md](./ARCHITECTURE.md).

This repo is a WIP framework for building and orchestrating AI agents. Full refactors are acceptable when they improve the architecture and all call sites are updated.

## Workspace Overview

### Published SDK Packages

| Package | Owns |
|---------|------|
| `@cline/shared` | Contracts, schemas, path helpers, hook engine, extension registry |
| `@cline/llms` | Provider settings, model catalogs, manifests, handler creation |
| `@cline/agents` | Stateless agent loop, tool orchestration, hook/extension runtime |
| `@cline/core` | Stateful orchestration, session lifecycle, storage, config, telemetry, hub runtime services, hub discovery, detached daemon, and hub client adapters (`@cline/core/hub`, `@cline/core/hub/daemon-entry`) |

### Apps

- `apps/cli`: CLI host and local hub management
- `apps/examples/desktop-app`: Tauri + Next.js desktop app example
- `apps/examples/vscode`: VS Code extension example
- `apps/examples/menubar`: hub notification menubar example
- `examples`: plugin, hook, and cron automation examples (customizations upon Cline SDK)

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
bun -F @cline/core build|test|typecheck
bun -F @cline/agents build|test|typecheck
```

### Rebuilding

Changes to published SDK packages require `bun run build:sdk`. Direct CLI runs pick up rebuilt packages immediately. Use `dev:*` scripts for automatic rebuilding during development.

The CLI build (`bun -F @cline/cli build`) bundles packages from their compiled `dist/`, not their TypeScript source. If you edit a package and then build the CLI without rebuilding the package first, the CLI binary will silently include the old package code. Always run `bun run build:sdk` (or the relevant `bun -F @cline/<pkg> build`) before building the CLI when testing changes end-to-end.

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

### SDK Release

The `bun release sdk` script automates the SDK publish flow: versioning, lockfile regeneration, verification, and publishing.

```sh
bun release sdk              # auto-increment patch version
bun release sdk 0.1.0        # explicit version
bun release sdk --tag next   # publish with a custom npm dist-tag
bun release sdk --dry-run    # preview without side effects
```

Additional SDK flags: `--skip-tests`, `--skip-git-tags`.

The script checks out `main` (and pulls latest) before starting. If the working tree is dirty it aborts.

The SDK flow runs: tests → version bump → lockfile regeneration → tarball verification → publish (shared → llms → agents → core) → optional `sdk-v{VERSION}` tag creation.

### CLI Release

The CLI is published through npm. Start releases from `apps/cli` with the `publish-cli` skill. The skill should guide the release prep, then offer the GitHub Actions publish path and the local publish path.

Under the hood, every release starts the same way: prepare one release commit, then choose how to publish it.

Prepare the release commit from the code you want to release:

1. Draft user-facing release notes from the commits since the last `cli-vX.Y.Z` tag.
2. Choose the release version.
3. Update `apps/cli/package.json`.
4. Add the approved notes to `apps/cli/CHANGELOG.md`.
5. Run the requested checks.
6. Commit the version and changelog changes.

Then publish that release commit with one of these paths.

Path A: publish from GitHub Actions.

Use this for normal releases. Merge the release commit to `main`, create and push the matching release tag, then run:

```sh
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
gh workflow run publish-cli.yaml -f publish_target=main -f git_tag=cli-vX.Y.Z -f confirm_publish=publish
```

The workflow checks out the provided `cli-vX.Y.Z` tag, verifies it matches `apps/cli/package.json`, builds the platform packages, publishes to npm with the `latest` dist-tag, creates the GitHub release, and posts to Slack.

Path B: publish locally.

Use this when publishing from an authenticated local machine. Start from a clean checkout at the release commit:

```sh
gh auth status
npm whoami
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
bun release cli
gh release create cli-vX.Y.Z --verify-tag --title "CLI vX.Y.Z" --notes "Paste the approved release notes here."
```

The local helper verifies the working tree is clean, verifies `cli-vX.Y.Z` points at `HEAD` locally and on `origin`, runs tests, builds platform packages, and publishes to npm.

Nightly release:

```sh
gh workflow run publish-cli.yaml -f publish_target=nightly
```

Nightly also runs on a schedule. It publishes `X.Y.Z-nightly.TIMESTAMP` to npm with the `nightly` dist-tag and skips if there were no commits in the last 24 hours unless forced.

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
bun pm ls @cline/core @cline/agents @cline/llms
```

### CI

The CI publish workflow (`.github/workflows/publish-sdk.yaml`) follows the same order: build → version → check-publish → publish (shared → llms → agents → core). It supports `nightly` and `latest` channels and is triggered by manual dispatch or a daily cron.

### Root Automation Scope

Root scripts are intentionally narrower than the full workspace:

- Root SDK build/test/version/publish flows target the publishable SDK packages only.
- Internal packages can still be built/tested directly, but should not be swept into release automation by accident.
- If you add a new internal package, keep it out of root publish/version/build sweeps unless you explicitly intend to publish it.
