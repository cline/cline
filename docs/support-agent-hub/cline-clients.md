# Cline Clients: CLI, Desktop App, VS Code, JetBrains

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

Cline ships several user-facing clients that all sit on top of the same SDK/agent core. Per `apps/cli/README.md`: "The CLI shares its agent core with the Cline VS Code extension, JetBrains plugin, and SDK, so plan/act modes, MCP servers, checkpoints, rules, skills, and provider configuration all behave the same across surfaces."

## Shared code graph

All clients consume the published SDK packages (see `sdk/AGENTS.md` for the dependency diagram):

```
@cline/shared → @cline/llms → @cline/agents → @cline/core → host apps
```

| App | Repo path | Depends on |
|---|---|---|
| CLI | `apps/cli` | `@cline/core`, `@cline/shared` (bundled at build time), `@cline/cline-hub` |
| Hub dashboard | `apps/cline-hub` | `@cline/core`, `@cline/llms`, `@cline/shared` |
| VS Code extension | `apps/vscode` | `@cline/agents`, `@cline/core`, `@cline/llms`, `@cline/shared`; webview uses `@cline/shared`, `@cline/ui` |
| Desktop app | `apps/examples/desktop-app` | `@cline/core`, `@cline/llms`, `@cline/shared`, `@cline/ui` |
| Menubar app | `apps/examples/menubar` | `@cline/core`, `@cline/shared` |

## CLI (`apps/cli`)

- **Monorepo package:** `@cline/cli` (version 3.0.62 on main). **Published npm package:** `cline` — install with `npm install -g cline` (nightly: `npm install -g cline@nightly`). The `cline` wrapper package resolves per-platform binary packages (`@cline/cli-darwin-arm64|x64`, `@cline/cli-linux-arm64|x64`, `@cline/cli-windows-x64|arm64`), so no Node/Bun/Zig runtime is needed at install time (`apps/cli/README.md`, `apps/cli/DISTRIBUTION.md`).
- **Binary:** `cline`. Requires Node >=22 for source builds; end users get prebuilt binaries.
- **Modes** (`apps/cli/README.md`):
  - Interactive TUI: `cline` or `cline -i` — plan/act toggle, slash commands, file mentions, live tool approvals (built on OpenTUI).
  - One-shot: `cline "prompt"`.
  - JSON: `cline --json "..."` streams NDJSON events.
  - Yolo: `cline --yolo "..."` skips approvals and exits when the turn finishes.
  - Zen: `cline --zen "..."` fires the task to the background hub daemon and exits immediately; zen sessions run with full tool auto-approval and `spawn`/`team` tools disabled by default.
  - ACP: `cline --acp` (Agent Client Protocol mode; this is how external editors such as JetBrains AI Assistant can drive Cline, per `docs/usage/acp.mdx`).
- **Subcommands** (from `apps/cli/src/main.ts`): `auth`, `config`, `plugin` (`install`/`uninstall`), `skill` (forwards to `npx skills`), `connect` (chat connectors), `mcp` (`install`/`uninstall` + wizard), `doctor` (`fix`, `log`), `history`/`h`, `hook`, `schedule` (`create`, `list`, `get`, `trigger`, `history`, `pause`, `resume`, `stats`, `active`, `upcoming`, `export`, `import`, `update`, `delete`), `hub` (`ensure`, `start`, `status`, `stop`, `drain`, `upgrade`), `dashboard`, `update`, `version`, `kanban`. Note: the CLI README's "Top-level commands" list omits `plugin`, `skill`, `mcp`, and `dashboard`, but they exist in source.
- **Relation to SDK/hub:** the CLI bundles `@cline/core`/`@cline/shared` into its binary (`apps/cli/bun.mts` uses `"packages": "bundle"`). It auto-spawns the shared local hub daemon via `ensureDetachedHubServer` from `@cline/core` (`apps/cli/src/utils/hub-runtime.ts`); the daemon code itself lives in `sdk/packages/core/src/hub/`.
- **Release process:** npm-only, tags `cli-vX.Y.Z`, workflow `.github/workflows/cli-publish.yml` (see `.agents/skills/publish-cli/SKILL.md`).

## VS Code extension (`apps/vscode`)

- **Package name:** `claude-dev` (historical name), **display name "Cline"**, publisher `saoudrizwan`, marketplace id `saoudrizwan.claude-dev`. Version 4.1.18 on main. Requires VS Code `^1.101.0`.
- **Architecture:** extension host entry `apps/vscode/src/extension.ts` plus a React webview UI in `apps/vscode/webview-ui/` (view id `claude-dev.SidebarProvider`). Extension host and webview communicate over generated gRPC/proto code (`apps/vscode/src/generated/`, protos in `apps/vscode/proto/`).
- **Relation to SDK:** hybrid. The extension still contains a large legacy core under `apps/vscode/src/core/` (controller, task, storage) and an SDK integration layer under `apps/vscode/src/sdk/` that imports `@cline/core`. The repo README marks it as "WIP migrating". Its README file (`apps/vscode/README.md`) is empty on main; the changelog is the root `CHANGELOG.md`.
- **Rollout mechanism:** `apps/vscode-rollout` (`@cline/vscode-rollout`, private) is a loader VSIX used for A/B between the SDK-based build (`apps/vscode`) and the legacy build (`legacy-extension` branch). See also `.agents/skills/publish-extension/SKILL.md` for stable/nightly/legacy publish workflows.

## Desktop app (`apps/examples/desktop-app`)

- **Package:** `@cline/code`, version 0.0.29 on main. Product name **"Cline"** (bundle id `bot.cline.app`) for stable; **"Cline Beta"** (`bot.cline.app.beta`) for the beta channel (`src-tauri/tauri.conf.json`, `tauri.beta.conf.json`).
- **Architecture:** Tauri v2 (Rust) shell + Next.js webview (dev port 3125) + a Bun "sidecar" backend (default port 3126, WebSocket transport at `ws://.../transport`). See `apps/examples/desktop-app/sidecar/ARCHITECTURE.md`.
- **Distribution:** despite living under `apps/examples/`, this is a released product. Stable releases tag `desktop-vX.Y.Z` from `main` (auto-update feed `desktop-latest`); beta releases tag `desktop-vX.Y.Z-beta.N` from the `desktop-experimental` branch and install side-by-side as "Cline Beta" (feed `desktop-beta`). Builds are universal macOS DMG and Windows NSIS via `.github/workflows/desktop-publish.yml` (see `.agents/skills/publish-desktop/SKILL.md`).

## JetBrains plugin

**Not in this repository.** The repo README states: "Currently we are not open-sourcing JetBrains plugins." Facts on main:

- Integration CI dispatches tests to a separate repo, `cline/intellij-plugin` (`.github/workflows/ext-jb-test-integration.yml`).
- Docs link to JetBrains Marketplace plugin `28247-cline` (one docs card cites `27189-cline` — the docs are inconsistent about the plugin id).
- Supporting artifacts here: `apps/vscode/scripts/add-endpoints-to-jetbrains.sh`, install docs (`docs/getting-started/installing-cline.mdx`), and `host_type: jetbrains` in telemetry docs.
- JetBrains AI Assistant can alternatively drive Cline through the CLI's ACP mode (`docs/usage/acp.mdx`).

When supporting JetBrains users, remember the plugin source, issues about plugin internals, and its release cadence belong to the closed `cline/intellij-plugin` repo; this monorepo only carries shared core behavior and docs.

## Other apps worth knowing

- `apps/cline-hub` — `@cline/cline-hub` (private): browser dashboard for the local hub daemon; started via `cline dashboard` and bundled into the CLI build. See [cline-hub.md](./cline-hub.md).
- `apps/examples/menubar` — `@cline/menubar`: Tauri menu-bar hub monitor; surfaces system notifications for background (zen) tasks via hub `ui.notify` events.
- `apps/examples/vscode` — `@cline/vscode`: an example extension that runs Cline sessions over the hub/RPC runtime (not the marketplace extension).
- `apps/examples/quickstart`, `cli-agent`, `cline-core-cli-agent`, `code-review-bot`, `multi-agent` — SDK usage examples (`apps/examples/README.md`).

## Support notes / common confusions

- "Cline" on npm = the CLI. "claude-dev" / `saoudrizwan.claude-dev` = the VS Code extension. `@cline/code` = the desktop app.
- The hub **daemon** is part of `@cline/core` (spawned automatically by clients); `apps/cline-hub` is only the optional browser **dashboard**. Easy to conflate.
- The desktop app lives under `apps/examples/` but is a shipped product with its own release channel.
- The VS Code extension is mid-migration: both legacy core code and SDK-based code exist on main.
