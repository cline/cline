---
name: cline-sdk
description: Comprehensive Cline SDK skill for building AI agents. Covers the Agent runtime, ClineCore sessions, custom tools, plugins, events, LLM providers, scheduling, multi-agent teams, and production deployment. Use for any task involving @cline/sdk or its sub-packages.
metadata:
   references: agent, clinecore
---

# Cline SDK Skill

Consolidated skill for building AI agents with the Cline SDK. Use the decision trees below to find the right entry point and API surface, then load detailed references.

## Critical Rules

Follow these rules in all Cline SDK code:

1. Install with `npm install @cline/sdk`. The `@cline/sdk` package re-exports everything from `@cline/core`, `@cline/agents`, `@cline/llms`, and `@cline/shared`.
2. Requires Node.js 22 or later.
3. Use `createTool()` from `@cline/sdk` (or `@cline/shared`) to define tools. Tool names must be `snake_case`.
4. Return errors as structured data from tool `execute` functions. Throwing counts as a "mistake" against the agent's mistake limit.
5. Use `lifecycle: { completesRun: true }` on tools that should end the agent loop (e.g. a "submit answer" tool).
6. When using `ClineCore`, always call `dispose()` when done to clean up resources.
7. The standalone `Agent` and `ClineCore` have different event systems. For `Agent`: use `agent.subscribe()` to get `AgentRuntimeEvent` types (text streaming is `"assistant-text-delta"`, result text is `result.outputText`). For `ClineCore`: use `cline.subscribe()` to get `CoreSessionEvent` types (text streaming is `"chunk"` with `payload.type === "text"`, result text is `result.text`). There is no top-level `onEvent` field on `AgentRuntimeConfig` -- use `agent.subscribe()` or `hooks.onEvent` instead. Do not use event types like `"content_update"` or `"content_start"` with `agent.subscribe()` -- those are internal legacy types from the ClineCore adapter layer.

## How to Use This Skill

### Reference File Structure

The two main API surfaces (`Agent` and `ClineCore`) follow a 4-file pattern. Cross-cutting concepts are single-file guides.

Each main API surface in `./references/<api>/` contains:

| File | Purpose | When to Read |
|------|---------|--------------|
| `REFERENCE.md` | Overview, when to use, quick start | Always read first |
| `api.md` | Full API: classes, methods, config, types | Writing code |
| `patterns.md` | Common patterns, best practices | Implementation guidance |
| `gotchas.md` | Pitfalls, limitations, debugging | Troubleshooting |

Cross-cutting concepts in `./references/<concept>/` have `REFERENCE.md` as the entry point.

### Reading Order

1. Start with `REFERENCE.md` for your chosen API surface
2. Then read additional files relevant to your task:
   - Writing agent code -> `api.md`
   - Common patterns -> `patterns.md`
   - Creating tools -> `tools/REFERENCE.md`
   - Adding plugins/hooks -> `plugins/REFERENCE.md`
   - Configuring LLM providers -> `providers/REFERENCE.md`
   - Streaming events -> `events/REFERENCE.md`
   - Deploying to production -> `production/REFERENCE.md`
   - Scheduling agents -> `scheduling/REFERENCE.md`
   - Multi-agent orchestration -> `multi-agent/REFERENCE.md`
   - Debugging -> `gotchas.md`

### Example Paths

```
./references/agent/REFERENCE.md           # Start here for lightweight agents
./references/clinecore/REFERENCE.md       # Start here for full runtime
./references/agent/api.md                 # Agent class, config, methods
./references/tools/REFERENCE.md           # Creating and using tools
./references/plugins/REFERENCE.md         # Plugin system
./references/providers/REFERENCE.md       # LLM provider configuration
```

## Quick Decision Trees

### "Which API surface should I use?"

```
Which API?
+-- I want a simple, stateless agent with custom tools
|   +-- agent/ (Agent class from @cline/agents)
+-- I need session persistence, built-in tools, config discovery
|   +-- clinecore/ (ClineCore from @cline/core)
+-- I want built-in file/shell/search/web tools
|   +-- clinecore/ (has built-in tools; Agent does not)
+-- I want scheduled or recurring agents
|   +-- clinecore/ (automation API)
+-- I need multi-process or multi-client session sharing
|   +-- clinecore/ (hub-backed runtime)
+-- I'm building a browser-compatible agent
|   +-- agent/ (no Node.js dependencies)
```

### "I need to create tools"

```
Tools?
+-- Define a custom tool with schema -> tools/REFERENCE.md
+-- Use built-in tools (bash, editor, read_files) -> tools/REFERENCE.md (built-in section)
+-- Control tool approval/policies -> tools/REFERENCE.md (policies section)
+-- Tool that ends the agent loop -> tools/REFERENCE.md (completion tools)
+-- Package tools as a reusable plugin -> plugins/REFERENCE.md
```

### "I need to handle events"

```
Events?
+-- Stream text/reasoning in real time -> events/REFERENCE.md
+-- Track token usage and costs -> events/REFERENCE.md
+-- Watch tool calls -> events/REFERENCE.md
+-- Detect completion/errors -> events/REFERENCE.md
+-- Hook into lifecycle stages -> plugins/REFERENCE.md
```

### "I need to configure a model provider"

```
Providers?
+-- Anthropic (Claude) -> providers/REFERENCE.md
+-- OpenAI (GPT) -> providers/REFERENCE.md
+-- Google (Gemini/Vertex) -> providers/REFERENCE.md
+-- AWS Bedrock -> providers/REFERENCE.md
+-- Mistral -> providers/REFERENCE.md
+-- OpenAI-compatible (vLLM, Together, etc.) -> providers/REFERENCE.md
+-- Custom/self-hosted provider -> providers/REFERENCE.md
```

### "I need plugins or hooks"

```
Plugins?
+-- Package tools + hooks together -> plugins/REFERENCE.md
+-- Observe tool calls (logging, metrics) -> plugins/REFERENCE.md
+-- Intercept lifecycle events -> plugins/REFERENCE.md
+-- Add system prompt rules -> plugins/REFERENCE.md
+-- Distribute via npm/git -> plugins/REFERENCE.md
```

### "I need multi-agent coordination"

```
Multi-agent?
+-- Spawn one-off background agents -> multi-agent/REFERENCE.md (sub-agents)
+-- Persistent cross-session teams -> multi-agent/REFERENCE.md (teams)
+-- Parent-child delegation -> multi-agent/REFERENCE.md (sub-agents)
+-- Peer-to-peer task board -> multi-agent/REFERENCE.md (teams)
```

### "I need scheduling or automation"

```
Scheduling?
+-- Recurring cron jobs -> scheduling/REFERENCE.md
+-- One-off scheduled tasks -> scheduling/REFERENCE.md
+-- Event-driven triggers -> scheduling/REFERENCE.md
+-- CLI schedule management -> scheduling/REFERENCE.md
```

### "I need to go to production"

```
Production?
+-- Error handling and status checks -> production/REFERENCE.md
+-- Cost control and token limits -> production/REFERENCE.md
+-- Observability (OpenTelemetry) -> production/REFERENCE.md
+-- Security and sandboxing -> production/REFERENCE.md
+-- Deployment patterns -> production/REFERENCE.md
```

### Troubleshooting Index

- Agent loop not stopping -> `tools/REFERENCE.md` (completion tools)
- Tool errors crashing the agent -> `agent/gotchas.md` or `clinecore/gotchas.md`
- Provider auth failures -> `providers/REFERENCE.md`
- Session not persisting -> `clinecore/gotchas.md`
- Token usage too high -> `production/REFERENCE.md` (cost control)
- Hub connection issues -> `clinecore/gotchas.md`
- Plugin not loading -> `plugins/REFERENCE.md`
- Events not firing -> `events/REFERENCE.md`

## Product Index

### API Surfaces
| API | Entry File | Description |
|-----|------------|-------------|
| Agent | `./references/agent/REFERENCE.md` | Lightweight stateless agent loop |
| ClineCore | `./references/clinecore/REFERENCE.md` | Full runtime with sessions, persistence, built-in tools |

### Cross-Cutting Concepts
| Concept | Entry File | Description |
|---------|------------|-------------|
| Tools | `./references/tools/REFERENCE.md` | Built-in and custom tool creation |
| Plugins | `./references/plugins/REFERENCE.md` | Extension system with hooks |
| Events | `./references/events/REFERENCE.md` | Real-time streaming events |
| Providers | `./references/providers/REFERENCE.md` | LLM provider configuration |
| Production | `./references/production/REFERENCE.md` | Deployment, security, observability |
| Scheduling | `./references/scheduling/REFERENCE.md` | Cron jobs and automation |
| Multi-Agent | `./references/multi-agent/REFERENCE.md` | Teams and sub-agents |

### Package Map
| Package | Purpose |
|---------|---------|
| `@cline/sdk` | Everything you need, install this one |
| `@cline/core` | Sessions, persistence, built-in tools, config, hub |
| `@cline/agents` | Stateless agent loop, tool orchestration, streaming |
| `@cline/llms` | LLM provider gateway |
| `@cline/shared` | Types, tool helpers, hook engine |

## Resources

Repository: https://github.com/cline/cline
SDK Source: https://github.com/cline/cline/tree/main/sdk
Documentation: https://docs.cline.bot/sdk/overview
Discord: https://discord.gg/cline
