# Cline SDK Packages

This repository contains the SDK packages that power Cline agent runtimes.

Contributor onboarding guidance is in [`AGENTS.md`](/Users/beatrix/dev/clinee/sdk-wip/AGENTS.md).
Repository architecture guidance is in [`ARCHITECTURE.md`](/Users/beatrix/dev/clinee/sdk-wip/ARCHITECTURE.md).
Detailed API/behavior reference is in [`DOC.md`](/Users/beatrix/dev/clinee/sdk-wip/DOC.md).

## Prerequisites

Install these before working in this repo:

- `git` (version control and cloning)
- `bun` (workspace install/build/test runner)
  - https://bun.com/docs/installation
- `node` (required target runtime for built CLI artifacts)

Verify:

```bash
git --version
bun --version
node --version
```

## Quick Start

```bash
# from repo root
bun install
# Build all the SDK packages
bun run build

# Start the CLI in dev mode with a prompt argument
bun run cli -- "your prompt here"

# Start the code app in dev mode
bun run code
```

Useful workspace scripts (root `package.json`):

- `bun run build` - build SDK packages + CLI (`shared → llms → scheduler → rpc → agents → core → cli`)
- `bun run build:sdk` - build only SDK packages (no CLI)
- `bun run build:apps` - build app targets (`cli` + `desktop` + `code`)
- `bun run build:shared|build:llms|build:agents|build:rpc|build:core|build:cli|build:code|build:desktop` - build one workspace package
- `bun run build:models` - regenerate model metadata in `llms`
- `bun run cli -- "your prompt"` - run CLI from source (direct entrypoint, no workspace log prefixing)
- `bun run dev` - build SDK packages + CLI, then run CLI interactively (dev mode)
- `bun run code` - launch code app directly
- `bun run desktop` - launch desktop app directly
- `bun run types` - typecheck all packages
- `bun run clean` - remove build outputs across packages
- `bun run version 1.2.3` - update all packages/* version number to v1.2.3

> **RPC hosts self-heal across rebuilds.** Direct CLI runs use the local in-process runtime. RPC-backed hosts use shared `@clinebot/core` ensure logic, exposed through `clite rpc ensure` and reused by core session bootstrap, to reuse a compatible owned sidecar or start a fresh one automatically when the RPC runtime build changes. The default runtime build key is derived from `@clinebot/core` and `@clinebot/rpc`.


# Repository Structure

It is organized as a Bun workspace with six SDK packages and three app targets:

SDK packages (`packages/`):

- `@clinebot/shared`: cross-package shared primitives (paths, common contracts, db/storage helpers)
- `@clinebot/llms`: model/provider selection and handler creation
- `@clinebot/scheduler`: scheduled runtime execution primitives and persistence
- `@clinebot/agents`: agent loop + tools + hooks + teams runtime primitives
- `@clinebot/rpc`: gRPC routing server for clients, sessions, tasks, tool approvals, and schedules
- `@clinebot/core`: stateful orchestration, sessions, storage, runtime assembly

Apps built with the Cline SDK (`apps/`):

- `@clinebot/cli`: Lightweight CLI that composes the SDK packages
- `@clinebot/code`: Tauri desktop app that embeds a Next.js UI and composes the SDK packages
- `@clinebot/desktop`: Tauri desktop app that embeds a Next.js UI and composes the SDK packages

`@clinebot/code` OAuth provider sign-in:

- Clicking a provider in settings opens its configuration view.
- Provider settings now load from `@clinebot/llms` provider registry IDs (instead of static seed data).
- Provider model lists are lazy loaded per provider when the detail panel is opened/refreshed.
- OAuth providers (`Cline`, `OCA`, `OpenAI Codex`) expose a `Login via Browser` action in the provider API key section.
- OAuth credentials are persisted by core storage in `~/.cline/data/settings/providers.json` through `ProviderSettingsManager`.
- Manual updates to provider fields in settings (toggle, API key, base URL) are persisted to the same provider settings file.
- In the `@clinebot/code` UI, selecting `Settings` from the left sidebar switches to `SettingsView`; closing settings returns to chat.
- Provider IDs from `@clinebot/llms` must be unique because they are used as React list keys and provider state identifiers.
- Chat model selection now remembers the last selected `modelId` per `providerId` in local app storage and restores it when switching providers or starting a new chat session.
- Chat provider/model selectors now prioritize providers enabled in settings (`list_provider_catalog`) and show models for those enabled providers; if provider settings are unavailable, selectors fall back to the full local catalog.
- Chat transcript tool entries now show expandable `Input` and `Result` payload sections in `apps/code/components/chat-messages.tsx`, including persisted `tool_result` payloads stored as JSON strings.
- Hydrated/reopened chat sessions continue applying live websocket `chat_event` updates (assistant text + tool events) even when no pre-seeded `activeAssistantMessageId` exists.

`@clinebot/code` MCP server settings:

- The `Settings -> MCP Servers` screen reads and writes the same MCP settings file used by CLI.
- Default path: `~/.cline/data/settings/cline_mcp_settings.json`
- Override path: `CLINE_MCP_SETTINGS_PATH`
- Supported actions in UI: list, enable/disable, add/edit, delete MCP server registrations, and open the config file from the path/button in settings.

`@clinebot/code` Rules settings lists:

- The `Settings -> Rules` screen now loads real config data through the CLI list pipeline (`list rules|workflows|skills|agents|hooks --json`).
- Tabs in this screen: `Rules`, `Workflows`, `Hooks`, `Skills`, and `Agents`.
- CLI list discovery for this screen resolves from the app `workspace_root` (not the Tauri process cwd).
- Data shown is read-only discovery output with file paths and summaries, plus refresh and partial-result warnings when any list source fails.

`@clinebot/code` core logger streaming:

- `apps/code/scripts/chat-runtime-bridge.ts` forwards runtime log/error chunks to Tauri as `chat_core_log` stream events.
- `apps/code/hooks/use-chat-session.ts` listens for `chat_core_log` and prints them with `console.debug|info|warn|error`.
- Keep regular `stdout` output in `chat-runtime-bridge.ts` JSON-only; emitting plain `console.log` there can corrupt stream parsing.

`@clinebot/code` + `@clinebot/desktop` shared chat runtime bridge design:

- Both app hosts use one persistent `chat-runtime-bridge.ts` process per app (`apps/code/scripts/chat-runtime-bridge.ts`, `apps/desktop/scripts/chat-runtime-bridge.ts`).
- Bridge command/control is shared via `@clinebot/rpc` `runRpcRuntimeCommandBridge(...)`.
- Bridge stream subscription handling remains shared via `@clinebot/rpc` runtime chat helpers.
- Runtime `send` commands in the shared bridge are now bounded (default `120000ms`, configurable by `CLINE_RPC_RUNTIME_SEND_TIMEOUT_MS`) so one stalled turn cannot wedge the bridge command loop.
- The code app host also bounds bridge command waits (`130000ms`) and returns a timeout error instead of remaining indefinitely in `running`.
- RPC runtime request parsing now normalizes invalid optional `maxIterations` values (especially JSON `null` from host serializers) to `undefined` to avoid immediate `max_iterations` exits at iteration `0`.
- RPC-backed sessions now share one persistent hook service per RPC runtime server process instead of spawning one hook worker per client/runtime session.

## Linting and Formatting (Biome)

This repo uses [Biome](https://biomejs.dev/) for both linting and formatting from the root workspace scripts:

- `bun run lint` - run lint-only checks
- `bun run format` - run formatter (without writing changes)
- `bun run fix` - apply safe Biome fixes and formatting with `--write`

Tip: run `bun run fix` before opening a PR, then `bun run lint` to verify everything passes cleanly.

## Testing (Vitest)

SDK/CLI packages in this workspace use Vitest for testing (`llms`, `agents`, `scheduler`, `core`, and `cli`).

- `bun run test` - run all package test suites from the repo root
- `bun run verify:routines` - run scheduler/routine smoke verification script

Package-level scripts also expose Vitest directly (for example `test:watch`, and in `cli`, `test:unit` and `test:e2e`).

Detailed testing strategy (including CLI e2e execution flow, current e2e coverage, and e2e-vs-unit guidance) is documented in `TESTING.md`.

## Workspace Import Boundaries

Allowed cross-workspace imports:

- `@clinebot/llms`
- `@clinebot/scheduler`
- `@clinebot/agents`
- `@clinebot/rpc`
- `@clinebot/core`
- `@clinebot/core/node` (intentional Node-runtime-only exception)

Disallowed:

- all other deep imports like `@clinebot/llms/*`, `@clinebot/agents/*`, `@clinebot/core/*` (except `@clinebot/core/node`)

Keep these boundaries in mind when adding imports — cross-boundary deep imports will cause build/type errors.

## Repository Structure

```text
.
├── README.md
├── AGENTS.md
├── ARCHITECTURE.md
├── DOC.md
├── package.json
├── biome.json
├── packages/
│   ├── shared/
│   │   ├── README.md
│   │   └── src/
│   ├── llms/
│   │   ├── README.md
│   │   ├── ARCHITECTURE.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── catalog.ts
│   │       ├── config.ts
│   │       ├── sdk.ts
│   │       ├── types.ts
│   │       ├── models/
│   │       └── providers/
│   ├── agents/
│   │   ├── README.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── agent.ts
│   │       ├── hooks.ts
│   │       ├── extensions.ts
│   │       ├── streaming.ts
│   │       ├── message-builder.ts
│   │       ├── tools/
│   │       ├── default-tools/
│   │       ├── teams/
│   │       └── prompts/
│   ├── scheduler/
│   │   ├── README.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── scheduler-service.ts
│   │       ├── schedule-store.ts
│   │       ├── resource-limiter.ts
│   │       └── cron.ts
│   ├── rpc/
│   │   ├── README.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts
│   │       ├── gateway-client.ts
│   │       ├── server.ts
│   │       ├── session-store.ts
│   │       └── proto/
│   └── core/
│       ├── README.md
│       └── src/
│           ├── index.ts
│           ├── types/
│           ├── runtime/
│           ├── session/
│           ├── storage/
│           ├── agents/
│           ├── adapters/
│           ├── auth/
│           ├── input/
│           ├── chat/
│           └── server/
└── apps/
    ├── cli/
    │   ├── README.md
    │   └── src/
    │       ├── index.ts
    │       └── utils/
    ├── code/
    │   ├── app/
    │   ├── components/
    │   ├── hooks/
    │   ├── lib/
    │   ├── styles/
    │   ├── public/
    │   └── src-tauri/
    └── desktop/
        ├── README.md
        ├── app/
        ├── components/
        ├── hooks/
        ├── lib/
        ├── styles/
        ├── public/
        └── src-tauri/
```

## Package Guide

### `packages/llms` (`@clinebot/llms`)

Purpose: config-driven LLM SDK.

Use this package to:

- define provider/model allowlists
- resolve model catalogs
- create provider handlers
- register custom provider/model extensions

Start with:

- `packages/llms/README.md`
- `packages/llms/ARCHITECTURE.md`
- `packages/llms/src/sdk.ts`
- `packages/llms/src/providers/index.ts`

Development notes:

- Public consumers should stay on the top-level `providers` and `models` exports; provider implementation internals under `handlers/*`, `transform/*`, and `utils/*` are not public API
- The package ships distinct default and browser entrypoints so hosts can consume browser-safe builds where needed
- Provider aliasing, known-model hydration, and generated model metadata are maintained centrally in `@clinebot/llms`; rebuild model artifacts after catalog-generation changes

### `packages/agents` (`@clinebot/agents`)

Purpose: runtime agent loop and tool/hook/team primitives.

Use this package to:

- run and continue agent loops
- define and execute tools
- intercept lifecycle with hooks/extensions
- coordinate sub-agents and teams

Start with:

- `packages/agents/README.md`
- `DOC.md` (`@clinebot/agents` section; API/export overview)
- `ARCHITECTURE.md` (`Agents Runtime` section)
- `packages/agents/src/agent.ts`
- `packages/agents/src/tools/`
- `packages/core/src/team/`

Development notes:

- Conversation resume flows should use `initialMessages` or `agent.restore(messages)` instead of mutating agent internals
- Runtime event consumers should use `onEvent` or `agent.subscribeEvents(...)`
- Each `Agent` instance allows only one active run at a time
- `maxParallelToolCalls` caps concurrent tool execution per iteration
- `@clinebot/agents` is runtime-agnostic; host default tools are provided by `@clinebot/core`, and Node-only subprocess hook helpers are exported from `@clinebot/agents/node`
- Team runtime in `@clinebot/agents` is in-memory; persistent team/session state belongs in `@clinebot/core`

### `packages/scheduler` (`@clinebot/scheduler`)

Purpose: reusable scheduled-agent execution service.

Use this package to:

- manage cron schedule definitions and execution history in SQLite
- enforce global and per-schedule concurrency/timeout controls
- run scheduled prompts through injected runtime handlers

Start with:

- `packages/scheduler/README.md`
- `packages/scheduler/src/scheduler-service.ts`
- `packages/scheduler/src/schedule-store.ts`

### `packages/rpc` (`@clinebot/rpc`)

Purpose: gRPC gateway for routing clients, sessions, tasks, tool approvals, and schedules.

Use this package to:

- start and connect to a local gRPC server (default `127.0.0.1:4317`)
- register clients and manage session lifecycle
- create/list/update/trigger schedules and query schedule executions/stats
- enqueue and claim spawn requests for sub-agents
- stream events and handle tool approval flows

Start with:

- `packages/rpc/README.md`
- `packages/rpc/src/server.ts`
- `packages/rpc/src/client.ts`
- `packages/rpc/src/proto/rpc.proto`

### `packages/core` (`@clinebot/core`)

Purpose: stateful orchestration layer over agents.

Use this package to:

- build runtime environments
- resolve credentials/config
- manage root + sub-session lifecycle
- persist state/transcripts via storage adapters
- load agent configs, rules, and workflows

Start with:

- `packages/core/README.md`
- `packages/core/src/runtime/`
- `packages/core/src/session/`
- `packages/core/src/storage/`
- `packages/core/src/agents/`
- `packages/core/src/server/`

Development notes:

- `@clinebot/core` owns stateful runtime assembly, storage, provider settings, and default host tools; keep the stateless agent loop in `@clinebot/agents`
- Host-oriented Node helpers belong under `@clinebot/core/node`
- RPC session persistence backends, team persistence, plugin loading, OAuth refresh, and hook/config discovery all belong in core rather than app packages

### `apps/cli` (`@clinebot/cli`)

Purpose: executable reference implementation of the SDK stack.

Use this package to see how the SDK packages are composed in a real app:

- argument parsing + runtime config (`apps/cli/src/index.ts`)
- provider/model refresh (`@clinebot/llms`)
- runtime assembly/session management (`@clinebot/core/node`)
- agent loop execution + tools + hooks (`@clinebot/agents`)
- gRPC server mode (`clite rpc start`) (`@clinebot/rpc`)

Docs:

- `apps/cli/README.md` (usage-oriented)
- `ARCHITECTURE.md` (`@clinebot/cli` section)

### `apps/code` (`@clinebot/code`)

Purpose: Tauri desktop app that wires the SDK packages into a local GUI.

The code app combines:

- Next.js frontend (`apps/code/app`, `apps/code/components`)
- Tauri host/runtime (`apps/code/src-tauri`)
- shared SDK packages (`@clinebot/llms`, `@clinebot/agents`, `@clinebot/core`)

Common commands:

- from repo root: `bun run dev` (recommended; builds SDK packages + CLI first, then starts code app dev)
- from repo root: `bun run code` (starts code app directly)
- from `apps/code/`: `bun run dev:web` (frontend-only Next.js dev server on port `3125`)
- from `apps/code/`: `bun run build` (build web assets)
- from `apps/code/`: `bun run build:binary` (build desktop binary with Tauri)

### `apps/desktop` (`@clinebot/desktop`)

Purpose: desktop reference app that wires the SDK packages into a local GUI.

The desktop package combines:

- Next.js frontend (`apps/desktop/app`, `apps/desktop/components`)
- Tauri host/runtime (`apps/desktop/src-tauri`)
- shared SDK packages (`@clinebot/llms`, `@clinebot/agents`, `@clinebot/core`)

Common commands:

- from repo root: `bun run desktop` (starts desktop app directly)
- from `apps/desktop/`: `bun run dev:web` (frontend-only Next.js dev server on port `3124`)
- from `apps/desktop/`: `bun run build` (build web assets)
- from `apps/desktop/`: `bun run build:binary` (build desktop binary with Tauri)
- from `apps/desktop/`: `bun run types` (or `bun run typecheck` within the package)
- from `apps/desktop/`: `bun run clean` (clears Next + Cargo artifacts)

## How Apps Compose `llms`, `agents`, `rpc`, and `core`

The CLI and desktop apps are the clearest end-to-end examples in this repo.

Flow:

1. `@clinebot/llms`:
   - fetches provider model metadata (`providers.getLiveModelsCatalog`)
   - picks provider/model defaults for the current run
2. `@clinebot/core`:
   - builds runtime environment (`DefaultRuntimeBuilder`)
   - composes team runtime/session-oriented behavior
3. `@clinebot/agents`:
   - constructs tools (`createBuiltinTools`, spawn tool helpers)
   - creates and runs the `Agent` loop (`agent.run`, `agent.continue`)
   - processes tool calls/hooks/streaming events
4. `@clinebot/rpc` (optional):
   - provides gRPC server for multi-client session routing
   - manages tool approval flows and event streaming

Desktop/code entry points to follow:

- frontend: `apps/code/app/` or `apps/desktop/app/`
- tauri backend/runtime bridge: `apps/code/src-tauri/` or `apps/desktop/src-tauri/`

Minimal composition sketch:

```ts
import { Agent, createBuiltinTools } from "@clinebot/agents"
import { DefaultRuntimeBuilder } from "@clinebot/core/node"
import { LlmsProviders } from "@clinebot/llms"

const catalog = await LlmsProviders.getLiveModelsCatalog()
const providerId = "anthropic"
const modelId = catalog[providerId]?.[0]?.id ?? "claude-sonnet-4-6"

const runtime = new DefaultRuntimeBuilder().build({
	config: { providerId, modelId, cwd: process.cwd(), enableTools: true },
})

const agent = new Agent({
	providerId,
	modelId,
	systemPrompt: "You are a helpful coding assistant.",
	tools: runtime.tools.length ? runtime.tools : createBuiltinTools({ cwd: process.cwd() }),
})

const result = await agent.run("<user_input mode="mode">Summarize this repository.</user_input>")
console.log(result.text)
```

## Navigation Tips

- Start with [`AGENTS.md`](/Users/beatrix/dev/clinee/sdk-wip/AGENTS.md), [`ARCHITECTURE.md`](/Users/beatrix/dev/clinee/sdk-wip/ARCHITECTURE.md), and [`DOC.md`](/Users/beatrix/dev/clinee/sdk-wip/DOC.md), then read package `README.md` files.
- Follow imports from `apps/cli/src/index.ts` and `apps/desktop/src-tauri/src/main.rs` to understand package boundaries.
- Prefer `src/` for implementation and `dist/` only for built output verification.
- Start debugging integration behavior from `apps/cli/src/index.ts`, then drill into `packages/core/src/runtime`, `packages/agents/src/agent.ts`, and `packages/llms/src/sdk.ts`.
