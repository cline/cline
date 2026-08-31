---
description: Development reference for the Cline SDK workspace.
globs: "*.ts,*.tsx,*.js,*.jsx,*.json,*.md"
alwaysApply: true
---

# Cline SDK — Development Reference

Quick-reference for active development. For onboarding, workspace setup, publishing, and detailed workflow see [CONTRIBUTING.md](./CONTRIBUTING.md). For architecture and runtime flows see [ARCHITECTURE.md](./ARCHITECTURE.md). For API details see [DOC.md](./DOC.md).

## Repository Scope

This file applies to the SDK workspace rooted at this directory (`sdk/`). In this repo, "root" means the SDK workspace root unless explicitly stated otherwise. Ignore the legacy repository root for SDK development except for Git operations or repo-wide searches that are explicitly needed.

Run SDK commands from `sdk/`, not from the legacy repository root. Do not run direct root-level commands such as `bun test sdk/...`; they bypass the SDK workspace setup and can fail to resolve `workspace:*` packages correctly.

## Package Boundaries

### Published SDK Packages

- `@cline/shared`: shared contracts, schemas, path helpers, hook engine, extension registry, low-level utilities. Owns the canonical UI protocol (`src/ui/`): `UiInboundMessage`/`UiOutboundMessage`/`UiConnection`, `TeamUiEvent`, `ClineSubscriptionPlan`
- `@cline/llms`: provider settings/config, model catalogs, provider manifests, gateway contracts, handler creation
- `@cline/agents`: stateless agent loop, tool orchestration, hook/extension runtime, event streaming
- `@cline/core`: stateful orchestration, session lifecycle, storage, config watching, plugin loading, default tools, telemetry. Exposes `@cline/core/hub` for discovery, the detached daemon entry, WebSocket clients, and session/UI client adapters, plus `@cline/core/hub/daemon-entry` for launching the shared daemon
- `@cline/ui`: shared presentation only — browser React primitives + theme (root entry), OpenTUI terminal UI (`./tui`, `./tui/formatting`), and UI protocol re-exports plus the transcript accumulator (`./protocol`). Never depends on `@cline/core`; hosts inject runtime behavior as plain data + callbacks

### Dependency Direction

```mermaid
flowchart TD
  shared["@cline/shared"] --> llms["@cline/llms"] & agents["@cline/agents"] & core["@cline/core"] & ui["@cline/ui"]
  llms --> agents & core & ui
  agents --> core
  core --> apps["CLI / VS Code / Desktop App"]
  ui --> apps
```

Rules:
- `shared` stays low-level and reusable
- `agents` stays stateless — no session/storage/config concerns
- `core` owns stateful orchestration, including the shared-hub daemon, server, and client adapters under `src/hub/`
- `ui` stays presentation-only: no `@cline/core` dependency, no session creation or persistence; hosts (e.g. `apps/cli`) adapt runtime state into its props and host-surface interfaces

## Change Routing

Route changes to the package that owns the concern:

- model/provider schemas or handler behavior: `@cline/llms`
- stateless loop, tool orchestration, streaming, hook/extension runtime: `@cline/agents`
- session lifecycle, storage, config watching, default tools, plugin loading, telemetry, hub runtime services, hub discovery, hub daemon spawn, and session-oriented client helpers (`HubSessionClient`, `HubUIClient`, `connectToHub`): `@cline/core` (hub pieces live under `src/hub/`)
- remote-config schemas, managed instruction materialization, blob upload metadata, and OpenTelemetry config normalization: `@cline/shared/src/remote-config`
- UI protocol message shapes shared by hosts: `@cline/shared/src/ui`
- reusable browser or terminal presentation (transcript rendering, prompt input, dialogs, theming, terminal formatting): `@cline/ui` (`components/` for web, `tui/` for terminal, `protocol/` for shared transcript accumulation)
- runtime-owned UX surfaces (provider auth, accounts, MCP management, session history, onboarding) and runtime→UI adapters: app package (e.g. `apps/cli/src/runtime/run-interactive.ts`, `apps/cli/src/tui/host-surfaces.tsx`)
- host-specific UX or shell behavior: app package

## Verifying Changes

Before testing in a fresh worktree, install SDK dependencies from the SDK workspace root:

```sh
cd sdk
bun install --frozen-lockfile
```

SDK package exports resolve sibling packages through compiled `dist/` files. If `dist/` is missing, build the SDK packages before running package tests:

```sh
bun run build:sdk
```

SDK-root commands for cross-package confidence:

```sh
bun run types       # typecheck all packages
bun run test        # run all tests
bun run check       # lint + build + typecheck + check-publish
```

For focused verification, prefer workspace package scripts from the SDK root:

```sh
bun -F @cline/shared test
bun -F @cline/llms test
bun -F @cline/agents test
bun -F @cline/core test:unit
bun -F @cline/cli test:unit
```

If a focused test command fails with a missing `@cline/*` export or missing `dist/` file, build the relevant dependency package or run `bun run build:sdk`, then rerun the same test command. Treat that as a workspace setup issue, not as evidence of a source-code bug.

If you touch hub/bootstrap/session flows, please update `ARCHITECTURE.md`.

## Practical Guidance

### Keep Boundaries Clean

- Don't move stateful logic down into `agents`
- For `@cline/llms` provider/model routing rules, follow [packages/llms/AGENTS.md](./packages/llms/AGENTS.md).
- Don't put app-specific behavior into `core` unless it is truly shared host behavior
- Keep remote-config primitives generic in `shared`; host-facing session integration belongs in `core`

### Refactor Standard

- Prefer direct architectural cleanup over compatibility shims
- Move code to the layer that owns the concern and update all call sites
- If a helper just projects watcher state, keep it with the config layer instead of creating thin runtime wrappers

## Documentation Responsibilities

- `README.md`: visitor-facing overview. Update when the repo story or package inventory changes.
- `CONTRIBUTING.md`: onboarding, workflow, publishing. Update when contributor setup or release process changes.
- `AGENTS.md` (this file): development reference. Update when package boundaries, dependency rules, or change routing changes.
- `ARCHITECTURE.md`: design, boundaries, runtime flows. Update when system design or architectural constraints change.
- `DOC.md`: API and behavior reference. Update when exported surfaces, lifecycle semantics, or runtime behavior changes.
