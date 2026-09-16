# Cline Support Agent Hub — Reference Documentation

Support-agent reference docs for helping customers configure and support Cline. Every claim is grounded in files on `main` of github.com/cline/cline.

**Grounding commit:** `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (main, 2026-09-16)

Where public docs (docs.cline.bot / `docs/` in this repo) conflict with code on main, these pages follow the code and note the conflict.

## Topics

| Page | One-line summary |
|---|---|
| [agent-plugins.md](./agent-plugins.md) | Portable Agent Plugins v1 packages (`plugin.json`, agent-plugins.org) discovered under `~/.agents/plugins`, contributing skills and MCP servers; Hub-owned enablement |
| [cline-plugins.md](./cline-plugins.md) | Installable TypeScript plugins (`AgentPlugin` API) that register tools/hooks/rules/providers; discovered in `.cline/plugins/` and installed via `cline plugin install` |
| [cline-sdk.md](./cline-sdk.md) | The SDK package stack — `@cline/sdk`, `@cline/core`, `@cline/agents`, `@cline/llms`, `@cline/shared`, `@cline/ui` — install, entrypoints, and when to use which |
| [cline-clients.md](./cline-clients.md) | The clients: CLI (npm `cline`), VS Code extension (`saoudrizwan.claude-dev`), desktop app (`@cline/code`), and the external JetBrains plugin; repo paths and SDK relationships |
| [cline-configuration.md](./cline-configuration.md) | The `~/.cline` layout and every config surface: providers, global settings, rules, skills, workflows, MCP, system prompts, connectors/channels, configured agents, hooks |
| [cline-hub.md](./cline-hub.md) | The Cline Hub: the shared local daemon in `@cline/core` (sessions, events, schedules, approvals) and the `apps/cline-hub` browser dashboard |
| [cline-provider.md](./cline-provider.md) | The `cline` provider ("Cline Usage-Billing"): pay-as-you-go credits, OAuth/`CLINE_API_KEY` auth, api.cline.bot endpoints, documented failure modes |
| [cline-pass.md](./cline-pass.md) | ClinePass: the $9.99/month subscription provider (`cline-pass`) with curated open coding models and 5-hour/weekly/monthly usage windows |

## Reading order for new support agents

1. [cline-clients.md](./cline-clients.md) — know which product the customer is using.
2. [cline-provider.md](./cline-provider.md) and [cline-pass.md](./cline-pass.md) — the two first-party billing/provider options.
3. [cline-configuration.md](./cline-configuration.md) — where everything lives on disk.
4. [cline-hub.md](./cline-hub.md) — the shared daemon behind multi-client behavior.
5. [cline-sdk.md](./cline-sdk.md), [cline-plugins.md](./cline-plugins.md), [agent-plugins.md](./agent-plugins.md) — for developer/extension questions.
