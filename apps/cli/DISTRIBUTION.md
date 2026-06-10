# CLI Distribution

The Cline CLI (`cline`) is distributed as compiled binaries via npm. Users run `npm i -g cline` and get a working `cline` command without needing Bun, Zig, or any other runtime installed.

## Why Compiled Binaries?

The CLI depends on OpenTUI (`@opentui/core`), which uses `bun:ffi` to call into a native Zig binary for terminal rendering. This means:

- The CLI cannot run on Node.js (Node doesn't support `bun:ffi`)
- If shipped as a JS bundle (`dist/index.js`), users must have Bun installed
- Compiled binaries (`bun build --compile`) embed the Bun runtime, so users need nothing pre-installed

Bun's `--compile` flag produces a single self-contained executable that includes the Bun runtime, all JS/TS code, and native addons.

## What Gets Published

Publishing the CLI publishes 9 packages to npm:

| Package | Description |
|---|---|
| `@cline/cli-darwin-arm64` | macOS Apple Silicon binary |
| `@cline/cli-darwin-x64` | macOS Intel binary |
| `@cline/cli-linux-arm64` | Linux ARM binary |
| `@cline/cli-linux-x64` | Linux x64 binary (AVX2-compiled; requires Haswell or newer) |
| `@cline/cli-linux-x64-baseline` | Linux x64 baseline binary (no-AVX2; Sandy Bridge and older) |
| `@cline/cli-windows-x64` | Windows x64 binary (AVX2-compiled) |
| `@cline/cli-windows-x64-baseline` | Windows x64 baseline binary (no-AVX2) |
| `@cline/cli-windows-arm64` | Windows ARM binary |
| `cline` | Wrapper package (pulls the right binary via `optionalDependencies`) |

Each platform package contains a compiled binary and a minimal `package.json` with `os` and `cpu` fields:

```json
{
  "name": "@cline/cli-darwin-arm64",
  "version": "0.1.0",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "bin": {
    "cline": "bin/cline"
  }
}
```

The `os` and `cpu` fields tell npm to skip this package on non-matching platforms. A macOS ARM user gets ~30-60MB, not ~200MB of binaries for every platform.

The `cline` wrapper package contains no binary -- just the resolver script, postinstall script, and `optionalDependencies` pointing to all platform packages:

```json
{
  "name": "cline",
  "version": "0.1.0",
  "bin": {
    "cline": "./bin/cline"
  },
  "scripts": {
    "postinstall": "node ./postinstall.mjs || true"
  },
  "optionalDependencies": {
    "@cline/cli-darwin-arm64": "0.1.0",
    "@cline/cli-darwin-x64": "0.1.0",
    "@cline/cli-linux-arm64": "0.1.0",
    "@cline/cli-linux-x64": "0.1.0",
    "@cline/cli-linux-x64-baseline": "0.1.0",
    "@cline/cli-windows-x64": "0.1.0",
    "@cline/cli-windows-x64-baseline": "0.1.0",
    "@cline/cli-windows-arm64": "0.1.0"
  }
}
```

After installing, users run `cline`:

```bash
npm i -g cline

cline              # interactive mode
cline "prompt"     # single-prompt mode
cline auth         # authenticate a provider
```

## How to Publish

Every release starts by preparing one release commit from the code you want to publish:

1. Draft user-facing release notes from the commits since the last `cli-vX.Y.Z` tag.
2. Choose the release version. Because this publishes over the existing `cline` package, the version must be greater than the current published `cline` version. The handoff release is `3.0.0`.
3. Update `apps/cli/package.json`.
4. Add the approved notes to `apps/cli/CHANGELOG.md`.
5. Run checks.
6. Commit the release changes.

Then publish that release commit with one of these paths.

### Publish From GitHub Actions

Use this path for normal releases.

```bash
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
gh workflow run cli-publish.yml -f publish_target=main -f git_tag=cli-vX.Y.Z -f confirm_publish=publish
```

This path requires the release commit to be on `main` and the matching `cli-vX.Y.Z` tag to exist before the workflow runs. The workflow checks out the tag, publishes to npm with the `latest` dist-tag, creates the GitHub release, and posts to Slack.

### Publish Locally

Use this path when publishing from an authenticated local machine.

Start from a clean checkout at the release commit:

```bash
gh auth status
npm whoami
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
bun release cli
gh release create cli-vX.Y.Z --verify-tag --title "CLI vX.Y.Z" --notes "Paste the approved release notes here."
```

The release helper checks the working tree, verifies the tag points at `HEAD` locally and on `origin`, runs tests, builds all platform packages, and publishes the platform packages plus the generated `cline` wrapper package to npm. The package version and tag must match.

By default, `bun release cli` publishes with the npm dist-tag `latest` (what users get with `npm i -g cline`). To publish under a different dist-tag like `next`, pass `--tag`:

```bash
bun release cli --tag next
```

## CI Workflow

The GitHub workflow at `.github/workflows/cli-publish.yml` automates publishing:

- Main releases are manual. Select `publish_target=main` and set `confirm_publish=publish`.
- Main releases require `git_tag=cli-vX.Y.Z`, check out that tag, verify it matches `apps/cli/package.json`, run tests, build all platform packages, publish to npm with the `latest` dist-tag using trusted publishing, create a GitHub release, and post to Slack.
- Nightly releases run on a schedule or manually with `publish_target=nightly`.
- Nightly releases publish `X.Y.Z-nightly.TIMESTAMP` to npm with the `nightly` dist-tag and skip if there were no commits in the last 24 hours unless forced.

CI publishing uses npm trusted publishing. Configure npm trusted publishers for the `cline` wrapper package and every platform package before relying on the workflow.

## How It Works Under the Hood

```
User runs: npm i -g cline
  |
  v
npm installs cline (wrapper package)
  + optionalDependencies (only the matching platform gets installed):
    - @cline/cli-darwin-arm64
    - @cline/cli-darwin-x64
    - @cline/cli-linux-arm64
    - @cline/cli-linux-x64              (standard; requires AVX2)
    - @cline/cli-linux-x64-baseline     (no-AVX2; installed alongside standard)
    - @cline/cli-windows-x64
    - @cline/cli-windows-x64-baseline
    - @cline/cli-windows-arm64
  |
  v
postinstall script runs:
  - Detects platform/arch
  - Finds the installed platform package
  - Creates a cached hard link for fast startup
  |
  v
User runs: cline
  |
  v
bin/cline (Node.js resolver) executes:
  1. Check CLINE_BIN_PATH env var override (SIGILL guard included)
  2. Check cached binary at bin/.cline
  3. Walk up node_modules for the platform package
     (baseline preferred first on no-AVX2 x64 Linux)
  4. Execute the compiled binary
  5. SIGILL safety net: if standard binary crashes, retry with baseline
```

## File Layout

```
apps/cli/
  bin/
    cline                   # Node.js resolver script (npm entry point)
  script/
    build.ts                # Cross-compile for all platforms
    publish-npm.ts          # npm publish orchestration
    postinstall.mjs         # Post-install binary caching
```

## Scripts Reference

From `apps/cli/`:

```bash
bun run build:platforms:single  # build only current platform (+ baseline if x64)
bun run build:platforms         # build all 8 platform binaries
bun run publish:npm:dry         # preview generated npm package publishing
```

Direct `bun pm pack` and `bun pm pack --dry-run` from `apps/cli` are blocked because the source package is not the npm release package. Build platform packages first, then use `bun run publish:npm:dry` to preview the generated packages under `dist/`.

## Build Script (`script/build.ts`)

Cross-compiles the CLI for all target platforms:

1. When `--install-native-variants` is passed, pre-installs all platform variants of `@opentui/core` using `bun install --os="*" --cpu="*"` so Bun can resolve native FFI binaries for cross-compilation. Without this, Bun only has the host platform's native binary and cross-compiled builds fail.
2. Builds SDK packages (`bun run build:sdk`) and the CLI JS bundle (`bun -F @cline/cli build`)
3. For each target platform:
   - Runs `bun build --compile --target bun-{os}-{arch}` to create a standalone executable
   - Generates a `package.json` with `os` and `cpu` fields for npm platform filtering
   - Runs a smoke test on the current platform's binary (`cline --version`)
   - Copies the plugin sandbox bootstrap file if present

Flags:
- `--single` -- build only for the current platform (faster for local testing)
- `--install-native-variants` -- allow the script to download all OpenTUI native packages required for cross-platform builds
- `--skip-install` -- skip re-downloading platform-specific native packages if they're already installed
- `--skip-sdk-build` -- skip rebuilding SDK packages (if already built)

## Publish Script (`script/publish-npm.ts`)

Orchestrates publishing all packages to npm:

1. Reads built packages from `dist/`
2. Publishes all 8 platform packages in parallel (`@cline/cli-darwin-arm64`, `@cline/cli-linux-x64-baseline`, etc.)
3. Generates a clean main package (`cline`) with:
   - `bin.cline` pointing to the resolver script
   - `postinstall` running the binary caching script
   - `optionalDependencies` listing all platform packages
4. Publishes the generated `cline` wrapper package

Platform packages must be published before the generated `cline` wrapper package because npm validates that `optionalDependencies` exist.

The publish script generates a separate `package.json` for the published `cline` wrapper package. The development `package.json` (with `bin` pointing to `src/index.ts` for `bun link`) is never published directly.

## Binary Resolver (`bin/cline`)

A Node.js script that serves as the entry point when users run `cline`. It finds and executes the correct platform-specific binary.

The shebang is `#!/usr/bin/env node` because Node.js is guaranteed to be available wherever npm is. The resolver uses only CommonJS (`require`) and Node.js APIs -- no `bun:` imports or Bun-specific APIs. It then spawns the compiled binary which has Bun embedded.

Resolution chain:
1. `CLINE_BIN_PATH` env var (for development or custom deployments)
2. `bin/.cline` cached hard link (created by postinstall for fast startup)
3. Walk up `node_modules` from the script directory to find the platform package

## Postinstall (`script/postinstall.mjs`)

Runs after `npm install cline`. Creates a hard link from the platform binary to `bin/.cline` for fast startup on subsequent runs. Falls back to file copy if hard linking fails (NFS, cross-device, network-mounted filesystems).

The postinstall is defensive: it wraps everything in try/catch and always exits 0 (the `|| true` in the npm script). If postinstall fails, the resolver script has its own fallback logic to find the binary at runtime, so the cached binary is just an optimization.

On Windows, the postinstall is a no-op because npm handles `.cmd` shim generation from the `bin` field.

## Development vs Distribution

During development, `bin` in package.json points to `src/index.ts` for `bun link` to work. The publish script generates a separate package.json for the published package that points to the resolver script. The development package.json is never modified during publish.

| Mode | bin target | Runtime | Needs Bun? |
|---|---|---|---|
| `bun run dev` | src/index.ts | Bun (source) | Yes |
| `bun link` + `cline` | src/index.ts | Bun (source) | Yes |
| `npm i -g cline` | bin/cline resolver | Compiled binary | No |

## Gotchas

### Native addon cross-compilation
When building for a different platform (e.g., compiling for Linux on a Mac), Bun needs the target platform's native binaries for `@opentui/core`. The build script handles this by pre-downloading all platform variants with `bun install --os="*" --cpu="*"`.

### Version synchronization
All 9 packages (8 platform + 1 wrapper) must have the same version. The build script reads the version from `apps/cli/package.json`. The publish script verifies that the built package versions match each other and `apps/cli/package.json`.

### Package naming and scoping
Platform packages are published under the `@cline` scope. The generated wrapper package is published as `cline`, so npm trusted publishing must be configured for all 9 package names (including `@cline/cli-linux-x64-baseline` and `@cline/cli-windows-x64-baseline`).

### postinstall reliability
The postinstall script runs in diverse environments (CI, Docker, restricted permissions, network-mounted filesystems where hard links fail). It always wraps operations in try/catch and exits 0. The resolver script is the ultimate fallback.

### Windows
Windows binaries are `.exe` files. The build script appends `.exe` to the output filename on Windows targets. The resolver handles this. npm on Windows generates `.cmd` shims for bin entries automatically.

### File permissions
Compiled binaries need to be executable (`chmod 755`). The build script sets this after copying. The postinstall also sets permissions on the cached binary. Some npm packaging steps can strip permissions, so both handle this defensively.

### Package size
Each compiled binary is ~30-60MB (Bun runtime + all bundled code + native addons). This is normal for compiled CLI tools. Users only download their platform's variant thanks to `optionalDependencies`.

## Baseline Binaries (no-AVX2 / Legacy x64 CPUs)

### Background (issue #10514)

The standard Bun-compiled x64 binary requires the AVX2 instruction set extension, which is present on Intel Haswell (2013) and later. Older x64 CPUs such as Intel Sandy Bridge (Core i7-2xxx / Xeon E5-2620 v1, 2011) support AVX but **not** AVX2. Running the standard binary on such a CPU produces an immediate `SIGILL` (Illegal Instruction) crash with exit code 132.

### What is published

Two additional baseline packages are published alongside the standard x64 packages:

| Package | Bun target | CPU requirement |
|---|---|---|
| `@cline/cli-linux-x64-baseline` | `bun-linux-x64-baseline` | x86-64-v2 (AVX, no AVX2) |
| `@cline/cli-windows-x64-baseline` | `bun-windows-x64-baseline` | x86-64-v2 (AVX, no AVX2) |

These are built by passing `--target=bun-linux-x64-baseline` (or `bun-windows-x64-baseline`) to `bun build --compile`. Bun embeds its own "baseline" runtime that avoids AVX2 instructions. The packages are identical to the standard packages in every other respect (same version, same `cpu: ["x64"]` field, same binary name).

### How AVX2 detection works

`bin/cline` detects AVX2 support at runtime before resolving the binary:

1. **On Linux**: reads `/proc/cpuinfo` and tests for the `avx2` flag as a whole word. If `avx2` is absent the CPU is treated as no-AVX2.
2. **On all other platforms**: AVX2 is assumed present. The crash has only been reported on Linux x64.

When a no-AVX2 CPU is detected and `arch === "x64"`, the resolver prepends `@cline/cli-linux-x64-baseline` to the candidate list so it is tried first.

### SIGILL safety net

Even when AVX2 detection reports capable (e.g. `/proc/cpuinfo` unreadable, or a future case on another OS), if the chosen binary exits with signal `SIGILL` the resolver transparently re-resolves and re-runs the baseline variant if one is installed. This protects against:

- Cached `.cline` binary from a prior install (the resolver skips the SIGILL net for cached binaries; users should reinstall to pick up the baseline package).
- CPUs where `/proc/cpuinfo` did not report flags reliably.

The safety net correctly handles the partial-upgrade scenario (no-AVX2 CPU, baseline package not yet installed): the standard package is tried, SIGILLs, and the resolver searches for and runs the baseline binary if it can be found. The decision is based on whether the resolved binary path contains `-baseline` — not on whether the name was a candidate — so it triggers correctly even when baseline was theoretically preferred but could not be found at resolution time.

### Reproducible crash evidence (issue #10514)

The following was captured on an Intel Xeon E5-2620 v1 (Sandy Bridge, 2011) host — this CPU has `avx` in `/proc/cpuinfo` but no `avx2`:

```
# Official @cline/cli-linux-x64 binary (AVX2-compiled, as shipped on npm):
$ /path/to/node_modules/@cline/cli-linux-x64/bin/cline --version
Illegal instruction
$ echo $?
132
```

Exit code 132 = 128 + SIGILL (signal 4). The binary dies immediately before executing any application code because Bun's startup routine uses AVX2 instructions absent on this CPU.

```
# Bun baseline build (x86-64-v2, no AVX2 required):
$ /home/david/.local/bin/bun --version
1.3.14
$ echo $?
0
```

The baseline runtime starts and runs normally on the same machine. This confirms that compiling with `--target=bun-linux-x64-baseline` fully resolves the crash for Sandy Bridge and equivalent CPUs.

### Resolution order on a no-AVX2 x64 Linux machine

```
1. CLINE_BIN_PATH env var override (if set)
2. bin/.cline cached binary (if exists; no SIGILL net here — reinstall to fix)
3. node_modules/@cline/cli-linux-x64-baseline/bin/cline  ← tried first
4. node_modules/@cline/cli-linux-x64/bin/cline           ← fallback
5. Error: "Could not find the Cline CLI binary for your platform"
```

### Building baseline packages locally

```bash
# Build all platforms including the two baseline variants:
bun run build:platforms

# Build only the current platform (baseline if on x64 Linux/Windows):
bun run build:platforms:single
```

The build script in `script/build.ts` includes `{ os: "linux", arch: "x64", variant: "baseline" }` and `{ os: "win32", arch: "x64", variant: "baseline" }` in `allTargets`. The `variant` field appends `-baseline` to the Bun compile target, package name, and output directory.

### Version synchronization

Baseline packages share the same version number as all other platform packages. All 8 platform packages (6 standard + 2 baseline) are included in `expectedPlatformPackages` in `script/publish-npm.ts` and must be present in `dist/` before the publish script proceeds.
