This is the **BedrockCoder** monorepo. Toolchain is **Bun 1.3.13** (package manager + task runner) with **Node >=22** as the runtime. Do not use npm/yarn/pnpm.

## Cloud Agent Instructions

### Build / Lint / test
- SDK packages (`@bedrock-coder/shared|llms|agents|core`) resolve each other through compiled `dist/` (their `exports` point only at `dist/`, with no `development` source condition). You **must** run `bun run build:sdk` after changing SDK dependencies/source before running the extension or SDK tests, otherwise imports fail with missing `@bedrock-coder/*` / missing `dist/` errors. Running processes do **not** hot-reload SDK source changes — rebuild and restart.
- Known cloud-env test artifact: `@bedrock-coder/core` test `src/services/workspace/workspace-manifest.test.ts > readGitWorkspaceState > prefers origin and returns the current branch` fails because cloud VMs configure git `insteadOf` rules that rewrite GitHub remotes to `https://x-access-token:...@github.com/...`. This is an environment artifact, not a code bug.

### GUI display
- A virtual X display is live at **`DISPLAY=:1`** (the same desktop used for screenshots). VS Code launched with `DISPLAY=:1` renders there and can be screenshotted — no need to start your own `xvfb`. Prefer starting long-running GUI/dev processes in a `tmux` session (see the tmux guidance) so they survive.

### VS Code extension (`apps/vscode`, package `bedrock-coder`)
Toolchain is pre-installed and persisted in the VM: generated gRPC/proto code, the bundled `ripgrep` binaries (`apps/vscode/bin/`), the built webview (`webview-ui/build`), the esbuild bundle (`dist/extension.js`), VS Code itself (`/usr/bin/code`), and the GUI system libraries its tests need.
- **Codegen prerequisite:** `bun run protos` (from `apps/vscode`) regenerates `src/generated/*` and the webview grpc client. The `dev`, `build:webview`, and `check-types` scripts already run it, so proto changes are picked up by those commands; run it manually only if you edit `.proto` files without a full build.
- **Build:** `bun run build:webview` (webview UI, ~15s) then `bun esbuild.mjs` (extension bundle). `bun run package` does the full production build.
- **Run it (dev host):** `DISPLAY=:1 code --no-sandbox --user-data-dir=/tmp/vscode-userdata --extensionDevelopmentPath=/workspace/apps/vscode <some-folder>`, then click the BedrockCoder icon in the Activity Bar to open the webview. (`--no-sandbox` is required in this container.)
- **Test:** `bun run test:unit` (bun-based, ~984 tests, no VS Code host needed). `bun run test:integration` (`@vscode/test-electron`, downloads a VS Code build, runs under the GUI libs) and `bun run test:e2e` (Playwright) exercise a real extension host — heavier, and the GUI libs for them are already installed.
- One-time deps (already installed, listed here in case they must be recreated): ripgrep via `bun run download-ripgrep`; VS Code test GUI libs per `CONTRIBUTING.md` (`libnss3`, `libatk*`, `libgbm1`, `xvfb`, etc.).
