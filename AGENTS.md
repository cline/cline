This is the **Cline** monorepo. Toolchain is **Bun 1.3.13** (package manager + task runner) with **Node >=22** as the runtime. Do not use npm/yarn/pnpm.

## Cloud Agent Instructions

### Ports
- Do **not** hardcode hub or dashboard ports in scripts or docs. Preferred defaults exist, but binds fall back to a free port when busy.
- Hub daemon: clients use discovery (`ensureDetachedHubServer` / hub discovery file). Dev allows port fallback unless `CLINE_HUB_PORT` is set explicitly.
- Hub dashboard + Vite (`bun run --cwd apps/cline-hub dev`): prefer free defaults; if taken, pick the next free port and print the live URLs. Explicit `CLINE_HUB_DASHBOARD_PORT` / `CLINE_HUB_WEBVIEW_DEV_PORT` fail closed (no silent relocate).
- Always open / connect to the URL printed at startup, not a memorized port.

### Cline CLI
- Run from source: `bun run cli` (interactive: `bun run cli -i`; one-shot: append a prompt). This resolves to `apps/cli` and **auto-spawns the `@cline/cline-hub` daemon** — you do not start the hub separately.
- Inspect local health with `bun run cli doctor`; `bun run cli version` prints the version.
- An actual agent turn requires an **LLM provider credential**. With no credentials the default `cline` provider fails fast with an `Unauthorized` error and the interactive TUI shows a provider sign-in screen. Configure via `cline auth` or provider env vars (e.g. `ANTHROPIC_API_KEY`, `CLINE_API_KEY`, `OPENROUTER_API_KEY`); see `apps/cli/README.md`. One-shot form: `bun run cli -P anthropic -m claude-sonnet-4-5 "<prompt>"`.
- Credential gotcha: the injected `ANTHROPIC_API_KEY` may authenticate but still fail the turn with `Your credit balance is too low` — that means auth works and only billing blocks the LLM call, not the environment. Use a funded key (or another funded provider) to run live turns.
- Seed the TUI past onboarding with `--key "$ANTHROPIC_API_KEY"` (or another provider key) when capturing screenshots.

### Drive / Status Hub (product surfaces)
- **Hub UI:** `bun run --cwd apps/cline-hub dev` → open the printed dashboard URL → Connect. Drive tab, Spotlight (in-call), Status Hub (`/status`), Drive Settings.
- **Status data ports:** product views depend on ports only (`StatusSnapshotSource` in CLI, `StatusTeamsSource` in hub). Live hub adapters implement them; demos are separate adapters in `@cline/drivecode-demo`, wired only at composition roots (`apps/cli/src/tui/root.tsx`, hub `App.tsx`).
- **Demo bootstrap (edge only):** `readDrivecodeDemoCliBootstrap()` / `readDrivecodeDemoHubBootstrap()` parse env/query. Views do not read `CLINE_DEMO_*` or `?demoPlans`.
  - CLI: `CLINE_DEMO_STATUS_PLANS=1` → compose `DrivePlansDemoStatusSnapshotSource` as fallback behind the hub adapter; `CLINE_DEMO_STATUS_LENS`; `CLINE_DEMO_OPEN_STATUS=1`; `CLINE_DEMO_DRIVE=1`
  - Hub: `?demoPlans=1` → `DrivePlansDemoTeamsSource`; `?statusMode=dependency-map`
  - Screenshots: also `CLINE_DISABLE_CLINE_PASS_NOTICE=1`
- Domain graph logic stays in `@cline/shared` (`buildDependencyMap`). Rebuild with `bun run build:sdk` after shared edits.
- Product screenshots: `docs/drivecode/assets/` (`tui-drive-*.png`, `tui-status-*.png`, hub `status-*.png`, `drive-*.png`).
- Demo package docs: `apps/drivecode-demo/README.md`.

### Drive docs (`docs/drivecode/`)
- **Single nest.** All Drive / drivecode docs live under `docs/drivecode/` (plans, design, assets, reviews, writing, HANDOFF, product reference). Do not recreate `docs/plans/`, `docs/design/`, `docs/reviews/`, `docs/writing/`, or `docs/assets/drivecode/`.
- **Entry points:** `docs/drivecode/README.md` (product reference), `docs/drivecode/HANDOFF.md` (continuation brief), `docs/drivecode/AGENTS.md` (maintain / add / edit rules).
- **Adding:** product plans → `docs/drivecode/plans/cline-drivemode/`; harness plan → `docs/drivecode/plans/drivecode-sdk/`; wireframes → `docs/drivecode/design/drive-wireframes/`; screenshots → `docs/drivecode/assets/`; reviews → `docs/drivecode/reviews/`; essays → `docs/drivecode/writing/`.
- **Editing:** prefer relative links inside the nest; use absolute `docs/drivecode/...` in handoffs and external callouts. After moves/renames, grep for the old path and fix links — do not leave stubs at old locations.
- **Out of scope:** Mintlify user docs stay in `docs/sdk/`, `docs/cli/`, `docs/features/`, etc. Repo-root `assets/drive/` is brand source, not docs.

### Build / Lint / test
- SDK packages (`@cline/shared|llms|agents|core|sdk`) resolve each other through compiled `dist/` (their `exports` point only at `dist/`, with no `development` source condition). You **must** run `bun run build:sdk` after changing SDK dependencies/source before running the CLI or SDK tests, otherwise imports fail with missing `@cline/*` / missing `dist/` errors. Running processes do **not** hot-reload SDK source changes — rebuild and restart.\
- Known cloud-env test artifact: `@cline/core` test `src/services/workspace/workspace-manifest.test.ts > readGitWorkspaceState > prefers origin and returns the current branch` fails because cloud VMs configure git `insteadOf` rules that rewrite GitHub remotes to `https://x-access-token:...@github.com/...`. This is an environment artifact, not a code bug.
- Some `@cline/cli` e2e assertions (`bun -F @cline/cli test:e2e`) may fail on exact tool-listing string formats; treat as pre-existing test drift, not an environment problem.

### GUI display
- A virtual X display is live at **`DISPLAY=:1`** (the same desktop used for screenshots). GUI apps (VS Code, the Tauri desktop window) launched with `DISPLAY=:1` render there and can be screenshotted — no need to start your own `xvfb`. Prefer starting long-running GUI/dev processes in a `tmux` session (see the tmux guidance) so they survive.
- TUI screenshots: launch `xterm` on `DISPLAY=:1`, run `bun run cli -i --key …` with the demo envs above, then `import -window <id> docs/drivecode/assets/<name>.png`. Prefer demo envs over fragile `xdotool` key chords (Ctrl+D alone exits the TUI).

### VS Code extension (`apps/vscode`, package `claude-dev`)
Toolchain is pre-installed and persisted in the VM: generated gRPC/proto code, the bundled `ripgrep` binaries (`apps/vscode/bin/`), the built webview (`webview-ui/build`), the esbuild bundle (`dist/extension.js`), VS Code itself (`/usr/bin/code`), and the GUI system libraries its tests need.
- **Codegen prerequisite:** `bun run protos` (from `apps/vscode`) regenerates `src/generated/*` and the webview grpc client. The `dev`, `build:webview`, and `check-types` scripts already run it, so proto changes are picked up by those commands; run it manually only if you edit `.proto` files without a full build.
- **Build:** `bun run build:webview` (webview UI, ~15s) then `bun esbuild.mjs` (extension bundle). `bun run package` does the full production build.
- **Run it (dev host):** `DISPLAY=:1 code --no-sandbox --user-data-dir=/tmp/vscode-userdata --extensionDevelopmentPath=/workspace/apps/vscode <some-folder>`, then click the Cline icon in the Activity Bar to open the webview. (`--no-sandbox` is required in this container.)
- **Test:** `bun run test:unit` (bun-based, ~984 tests, no VS Code host needed). `bun run test:integration` (`@vscode/test-electron`, downloads a VS Code build, runs under the GUI libs) and `bun run test:e2e` (Playwright) exercise a real extension host — heavier, and the GUI libs for them are already installed.
- One-time deps (already installed, listed here in case they must be recreated): ripgrep via `bun run download-ripgrep`; VS Code test GUI libs per `CONTRIBUTING.md` (`libnss3`, `libatk*`, `libgbm1`, `xvfb`, etc.).

### Desktop app (`apps/examples/desktop-app`, package `@cline/code`)
A Tauri v2 (Rust) shell + Next.js webview + a Bun "sidecar" backend. Rust and the Tauri Linux system libs are pre-installed and persisted.
- **Headless (no Rust/window):** run the backend and UI separately — `bun run dev:sidecar` (Bun backend on `127.0.0.1:3126`, serves `ws://.../transport`) and `bun run dev:web` (Next.js UI on `http://localhost:3125`).
- **Native window:** `bun run dev` (`tauri dev`) — its `beforeDevCommand` builds the sidecar binary and starts `dev:web` (`:3125`), then Rust `main.rs` spawns the sidecar; so free ports `3125`/`3126` first. Launch with `DISPLAY=:1` to see the window. A `libEGL: DRI3 error` warning is benign (software rendering) — the WebKitGTK window still renders.
- **Rust version caveat:** the crate graph needs Cargo's `edition2024` feature, so **Rust ≥1.85** is required (the VM's base 1.83 fails with "feature `edition2024` is required"). The toolchain here was updated via `rustup default stable` (currently 1.97). First `cargo` build downloads/compiles the full Tauri crate graph (a few minutes); subsequent builds are cached.
- **System libs (already installed):** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`, `build-essential`.
- **Test/typecheck:** `bun run typecheck`, `bun run test:chat-ui` (Vitest). Both trigger `build:ui` first.
