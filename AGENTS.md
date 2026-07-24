# AGENTS.md

Repo-wide notes for AI agents. The SDK workspace also has `sdk/AGENTS.md`; see `CONTRIBUTING.md`, `README.md`, and per-package docs for the rest.

## Cursor Cloud specific instructions

This is the **Cline** monorepo (`@cline/packages`), a Bun workspace. Toolchain is **Bun 1.3.13** (package manager + task runner) with **Node >=22** as the runtime. Do not use npm/yarn/pnpm; the single lockfile is `bun.lock`. See `.clinerules/bun-and-node.md` for the bun-vs-node distinction.

The startup update script already runs `bun install` and `bun run build:sdk`, and `bun` is available on `PATH` (symlinked into `/usr/local/bin`). Standard commands live in the root `package.json` scripts — reference those rather than re-deriving them.

### Flagship product: Cline CLI
- Run from source: `bun run cli` (interactive: `bun run cli -i`; one-shot: append a prompt). This resolves to `apps/cli` and **auto-spawns the `@cline/cline-hub` daemon** — you do not start the hub separately.
- Inspect local health with `bun run cli doctor`; `bun run cli version` prints the version.
- An actual agent turn requires an **LLM provider credential**. With no credentials the default `cline` provider fails fast with an `Unauthorized` error and the interactive TUI shows a provider sign-in screen. Configure via `cline auth` or provider env vars (e.g. `ANTHROPIC_API_KEY`, `CLINE_API_KEY`, `OPENROUTER_API_KEY`); see `apps/cli/README.md`.

### Build/SDK gotcha (important)
- SDK packages (`@cline/shared|llms|agents|core|sdk`) resolve each other through compiled `dist/` (their `exports` point only at `dist/`, with no `development` source condition). You **must** run `bun run build:sdk` after changing SDK dependencies/source before running the CLI or SDK tests, otherwise imports fail with missing `@cline/*` / missing `dist/` errors. Running processes do **not** hot-reload SDK source changes — rebuild and restart.

### Lint / test
- Lint: `bun run lint` (Biome). The repo currently reports pre-existing warnings/infos (no errors); a clean run exits 0.
- Unit tests: `bun run test:unit` (runs `@cline/agents`, `@cline/llms`, `@cline/core`, `@cline/cli`, `@cline/cline-hub` in parallel). For focused runs use `bun -F <pkg> test` / `test:unit` from the repo root.
- Known cloud-env test artifact: `@cline/core` test `src/services/workspace/workspace-manifest.test.ts > readGitWorkspaceState > prefers origin and returns the current branch` fails because cloud VMs configure git `insteadOf` rules that rewrite GitHub remotes to `https://x-access-token:...@github.com/...`. This is an environment artifact, not a code bug.
- Some `@cline/cli` e2e assertions (`bun -F @cline/cli test:e2e`) may fail on exact tool-listing string formats; treat as pre-existing test drift, not an environment problem.

### Optional heavier products (not set up here)
- VS Code extension (`apps/vscode`): needs `bun run protos` (gRPC/protobuf codegen) and, for its Playwright/vscode-test e2e, GUI system libs + `xvfb` (see `CONTRIBUTING.md`).
- Tauri desktop/menubar (`apps/examples/desktop-app`, `apps/examples/menubar`): require Rust/Cargo.
- Docs (`docs/`): Mintlify (`npm`/`mintlify dev`).
