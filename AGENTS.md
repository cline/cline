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

### GUI display
- A virtual X display is live at **`DISPLAY=:1`** (the same desktop used for screenshots). GUI apps (VS Code, the Tauri desktop window) launched with `DISPLAY=:1` render there and can be screenshotted — no need to start your own `xvfb`. Prefer starting long-running GUI/dev processes in a `tmux` session (see the tmux guidance) so they survive.

### VS Code extension (`apps/vscode`, package `claude-dev`)
Toolchain is pre-installed and persisted in the VM: generated gRPC/proto code, the bundled `ripgrep` binaries (`apps/vscode/bin/`), the built webview (`webview-ui/build`), the esbuild bundle (`dist/extension.js`), VS Code itself (`/usr/bin/code`), and the GUI system libraries its tests need.
- **Codegen prerequisite:** `bun run protos` (from `apps/vscode`) regenerates `src/generated/*` and the webview grpc client. The `dev`, `build:webview`, and `check-types` scripts already run it, so proto changes are picked up by those commands; run it manually only if you edit `.proto` files without a full build.
- **Build:** `bun run build:webview` (webview UI, ~15s) then `bun esbuild.mjs` (extension bundle). `bun run package` does the full production build.
- **Run it (dev host):** `DISPLAY=:1 code --no-sandbox --user-data-dir=/tmp/vscode-userdata --extensionDevelopmentPath=/workspace/apps/vscode <some-folder>`, then click the Cline icon in the Activity Bar to open the webview. (`--no-sandbox` is required in this container.)
- **Test:** `bun run test:unit` (bun-based, ~984 tests, no VS Code host needed). `bun run test:integration` (`@vscode/test-electron`, downloads a VS Code build, runs under the GUI libs) and `bun run test:e2e` (Playwright) exercise a real extension host — heavier, and the GUI libs for them are already installed.
- One-time deps (already installed, listed here in case they must be recreated): ripgrep via `bun run download-ripgrep`; VS Code test GUI libs per `CONTRIBUTING.md` (`libnss3`, `libatk*`, `libgbm1`, `xvfb`, etc.).

### Desktop app (`apps/examples/desktop-app`, package `@cline/code`)
A Tauri v2 (Rust) shell + Next.js webview + a Bun "sidecar" backend. Rust and the Tauri Linux system libs are pre-installed and persisted.
- **Headless (no Rust/window):** run the backend and UI separately — `bun run dev:sidecar` (Bun backend on `127.0.0.1:3126`, serves `ws://.../transport`) and `bun run dev:web` (Next.js UI on `http://localhost:3125`). This is the easiest way to develop/test the UI; open `:3125` in a browser.
- **Native window:** `bun run dev` (`tauri dev`) — its `beforeDevCommand` builds the sidecar binary and starts `dev:web` (`:3125`), then Rust `main.rs` spawns the sidecar; so free ports `3125`/`3126` first. Launch with `DISPLAY=:1` to see the window. A `libEGL: DRI3 error` warning is benign (software rendering) — the WebKitGTK window still renders.
- **Rust version caveat:** the crate graph needs Cargo's `edition2024` feature, so **Rust ≥1.85** is required (the VM's base 1.83 fails with "feature `edition2024` is required"). The toolchain here was updated via `rustup default stable` (currently 1.97). First `cargo` build downloads/compiles the full Tauri crate graph (a few minutes); subsequent builds are cached.
- **System libs (already installed):** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`, `build-essential`.
- **Test/typecheck:** `bun run typecheck`, `bun run test:chat-ui` (Vitest). Both trigger `build:ui` first.

### Not set up
- JetBrains plugin and Kanban board (separate repos). Menubar Tauri app (`apps/examples/menubar`) — same Rust/WebKitGTK toolchain as the desktop app if needed. Docs (`docs/`): Mintlify via `npm`.
