# Cline SDK Packages

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline, `sdk/` workspace).

The Cline SDK is "a TypeScript framework for building AI agents that can edit files, run shell commands, browse the web, call APIs, and use any custom tool you give them. It's the same engine that powers Cline, packaged as a library" (`sdk/README.md`). It lives in the `sdk/` workspace of the monorepo, with packages under `sdk/packages/`.

## Package inventory

All agent-runtime packages are versioned together (0.0.83 on main); `@cline/ui` has its own version line.

| npm package | Repo path | Version | What it does |
|---|---|---|---|
| `@cline/sdk` | `sdk/packages/sdk` | 0.0.83 | User-facing alias for `@cline/core`; single install that re-exports the full API |
| `@cline/core` | `sdk/packages/core` | 0.0.83 | Stateful orchestration: sessions, persistence, built-in tools, config discovery, plugin loading, hub daemon/clients, telemetry, scheduling |
| `@cline/agents` | `sdk/packages/agents` | 0.0.83 | Browser-safe stateless agent loop with tool orchestration, streaming, hook/extension runtime |
| `@cline/llms` | `sdk/packages/llms` | 0.0.83 | LLM provider gateway: provider settings/config, model catalogs, handler creation (Anthropic, OpenAI, Google, Bedrock, Mistral, OpenAI-compatible, and more) |
| `@cline/shared` | `sdk/packages/shared` | 0.0.83 | Low-level contracts: types/schemas, `createTool`, hook engine, extension registry, path helpers, remote-config primitives |
| `@cline/ui` | `sdk/packages/ui` | 0.2.0-next.9 | Shared Cline web theme and reusable agent UI components (React); used by web clients, not part of the agent runtime stack |

Dependency direction (`sdk/AGENTS.md`, `sdk/ARCHITECTURE.md`):

```
@cline/shared → @cline/llms → @cline/agents → @cline/core → host apps (CLI / VS Code / Desktop)
@cline/sdk    → re-exports @cline/core (its only dependency)
@cline/ui     → depends only on @cline/shared
```

Publish order in release automation is `shared → llms → agents → core → sdk` (`sdk/scripts/release.ts`). `@cline/ui` releases on its own cycle and is marked `internal: true` in its `package.json`; its README calls the API "pre-stable".

## Install

- Default: `npm install @cline/sdk` (`sdk/README.md`). Requires Node >= 22.
- Minimal footprint alternatives: `npm install @cline/core`, or `npm install @cline/agents @cline/shared @cline/llms` for the stateless stack (per-package READMEs).
- SDK skill for coding agents: `npx skills add cline/sdk-skill` (`sdk/README.md`); the same skill content lives in-repo at `.agents/skills/cline-sdk/`.

## The two API surfaces

### `Agent` (from `@cline/agents`, re-exported by `@cline/sdk`)

Lightweight, stateless agent loop. Implemented in `sdk/packages/agents/src/agent-runtime.ts` (`Agent` is an alias of `AgentRuntime`). No session storage, no built-in tools, browser-compatible.

```typescript
import { Agent } from "@cline/sdk"
const agent = new Agent({ providerId: "cline", modelId: "...", systemPrompt: "...", tools: [] })
const result = await agent.run("...")
```

Use when: simple stateless agent with custom tools, or browser environments (skill decision tree in `.agents/skills/cline-sdk/SKILL.md`).

### `ClineCore` (from `@cline/core`)

Full runtime: `ClineCore.create(...)` then `cline.start({ prompt, config })`. Defined in `sdk/packages/core/src/ClineCore.ts`. Provides:

- Built-in tools: `bash`, `editor`, `read_files`, `apply_patch`, `search`, `fetch_web` (`sdk/README.md`)
- Session persistence to SQLite; config discovery from `.cline/` directories
- Hub-backed and remote runtimes (`RuntimeHost` boundary: `LocalRuntimeHost`, `HubRuntimeHost`, `RemoteRuntimeHost` — `sdk/ARCHITECTURE.md`)
- Scheduling/automation (`cline.automation.*`, cron specs under `~/.cline/cron/`)
- Sessions with no `cwd`/`workspaceRoot` land in the shared chat workspace `~/.cline/data/workspaces/chat`

Use when: session persistence, built-in tools, config discovery, multi-process/multi-client session sharing, or scheduled agents.

Key subpath exports of `@cline/core`: `./hub` (hub discovery, `NodeHubClient`, `HubSessionClient`, `HubUIClient`, `connectToHub`), `./hub/daemon-entry` (launch the shared daemon), `./telemetry`, `./remote/helper` (SSH remote environments).

### Event-system difference (frequent support issue)

Per `.agents/skills/cline-sdk/SKILL.md`: `Agent` and `ClineCore` have different event systems. For `Agent`, use `agent.subscribe()` (`AgentRuntimeEvent`; text streaming is `"assistant-text-delta"`, result text is `result.outputText`). For `ClineCore`, use `cline.subscribe()` (`CoreSessionEvent`; text streaming is `"chunk"` with `payload.type === "text"`, result text is `result.text`). There is no top-level `onEvent` field on `AgentRuntimeConfig`.

## Tools

Tools are created with `createTool()` from `@cline/sdk` or `@cline/shared` (`sdk/packages/shared/src/tools/create.ts`): name (snake_case), model-facing description, JSON Schema `inputSchema`, and an `execute` function. Tools that should end the agent loop use `lifecycle: { completesRun: true }`. Return errors as structured data — throwing counts against the agent's consecutive-mistake limit (skill Critical Rules).

## When to use which package

| Need | Use |
|---|---|
| Just building an agent app | `@cline/sdk` (one install, full API) |
| Stateless loop, custom tools, browser | `@cline/agents` (+ `@cline/shared`, `@cline/llms`) |
| Sessions, built-in tools, `.cline/` config, hub, schedules | `@cline/core` (or `@cline/sdk`) |
| Provider/model layer only | `@cline/llms` |
| Types, `createTool`, hook contracts | `@cline/shared` |
| React chat/theme components for a web client | `@cline/ui` |

## Where the clients fit

`apps/cli`, `apps/vscode`, and `apps/examples/desktop-app` are hosts built on `@cline/core` (see [cline-clients.md](./cline-clients.md)). The apps are internal workspace packages and are not published as SDK packages (`sdk/ARCHITECTURE.md`, "Publishability Constraint").

## In-repo documentation map

- `sdk/README.md` — overview, install, examples, package table
- `sdk/ARCHITECTURE.md` — package boundaries, runtime flows (local / hub-backed / remote-config), design seams; the architecture source of truth
- `sdk/AGENTS.md` — development reference (package boundaries, change routing)
- `sdk/CONTRIBUTING.md` — onboarding and publishing
- `.agents/skills/cline-sdk/` — the SDK skill with reference trees: `references/agent/`, `references/clinecore/`, `references/tools/`, `references/plugins/`, `references/providers/`, `references/events/`, `references/production/`, `references/scheduling/`, `references/multi-agent/`
- Public docs: docs.cline.bot/sdk (source under `docs/sdk/` in this repo)

## Known documentation drift on main (main wins)

- `sdk/DOC.md` is only ~67 lines (SSH remote environments) despite `ARCHITECTURE.md` referring to it as the API reference.
- `sdk/ARCHITECTURE.md` "Key Type Locations" lists `packages/agents/src/agent.ts` for `Agent` and `packages/shared/src/plugin/` for `AgentPlugin`; the actual locations are `sdk/packages/agents/src/agent-runtime.ts` and `sdk/packages/shared/src/agents/types.ts` (+ `src/extensions/contribution-registry.ts`).
- The SDK skill says `@cline/sdk` re-exports four packages; its `package.json` depends only on `@cline/core` (which re-exports the rest), so the effect is the same but the mechanism differs.
- `@cline/llms` README documents subpath imports (`/runtime`, `/providers`, `/models`) that are not present in its `package.json` `exports` (only `.` and `./browser`).
