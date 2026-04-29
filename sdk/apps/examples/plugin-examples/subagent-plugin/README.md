# 🤖 Portable Agents Plugin

**Give your agent a team.** This plugin lets any Cline SDK session spin up background subagents — each with their own model, personality, and tools — then collect results and hand off context between them.

Think of it as `spawn()` for AI agents: fire off a recon agent to map a codebase, a planner to design the approach, an implementor to make the changes, and a reviewer to tear it all apart. They run in parallel, report back when done, and share notes through a built-in handoff store.

## Quick Start

```ts
import { ClineCore } from "@clinebot/core";

const cline = await ClineCore.create({});

await cline.start({
  config: {
    providerId: "cline",
    modelId: "anthropic/claude-sonnet-4.6",
    cwd: process.cwd(),
    enableTools: true,
    systemPrompt: "You are a coding assistant with access to subagents.",
    pluginPaths: ["./apps/examples/plugin-examples/subagent-plugin"],
  },
  prompt: "Use subagents to investigate and refactor this repo.",
  interactive: true,
});
```

Pass the **directory** as the plugin path. The runtime reads `package.json` and uses the `cline.plugins` field to discover entry points — no need to point at `index.ts` directly.

### Plugin discovery via `package.json`

When a directory is given as a plugin path, the loader looks for a `package.json` with a `cline.plugins` array:

```json
{
  "name": "my-cline-plugin",
  "type": "module",
  "cline": {
    "plugins": [
      { "paths": ["./index.ts"], "capabilities": ["tools"] }
    ]
  }
}
```

Each entry in `plugins` is a `PluginManifest` with a `paths` array of relative file paths and a `capabilities` array declaring what the plugin provides (`tools`, `hooks`, `commands`, `messageBuilders`, `providers`). All paths are resolved relative to the directory containing `package.json`.

If no `cline.plugins` field is present, the loader falls back to looking for `index.ts` or `index.js` at the directory root.

## Tools

| Tool | What it does |
|---|---|
| `start_subagent` | Kick off a background subagent and get a session ID back immediately. Fire and forget, or poll later. |
| `message_subagent` | Send a follow-up message to a running subagent — steer it, give it more context, or ask for a different angle. |
| `get_subagent` | Check on a subagent: is it still running? Did it finish? What did it say? |
| `list_agent_presets` | Browse available agent presets — bundled, global, and project-level. |
| `save_handoff` | Stash a file in the conversation's shared handoff store. Other agents in the same conversation can read it. |
| `read_handoff` | Pull a file back out of the handoff store. Great for passing research notes, plans, or intermediate results between agents. |
| `list_skills` | See what skills are available for agents to load. |
| `get_skill` | Load a skill's specialized instructions. Agents use these to adopt expert behaviors on demand. |

`start_subagent` accepts explicit `preset` and/or `instructions`, but if `preset` is omitted it now defaults to the bundled `phantom` preset. That makes natural calls like “start a subagent to inspect this repo” work without extra tool arguments.

## The Crew — Bundled Agents

Four agents ship out of the box, each tuned for a different phase of the development loop:

| Agent | Personality | Model | What it's for |
|---|---|---|---|
| 🔍 `phantom` | Fast, thorough scout | Gemini 3 Flash | Codebase recon — maps files, surfaces conventions, digs for intent behind odd code. Never implements, only reports. |
| 🧠 `oracle` | Opinionated challenger | Claude Opus 4.6 | Planning — challenges assumptions, compares approaches, estimates complexity, produces step-by-step execution plans. |
| ⚒️ `anvil` | Precise, disciplined builder | Claude Opus 4.6 | Implementation — reads before writing, stays in scope, verifies after each change, reports exact diffs. |
| 🔥 `inquisitor` | Adversarial stress-tester | GPT-5.4 | Review — finds bugs, challenges design decisions, severity-ranks every finding. Assumes it's responsible for everything that breaks. |

When no preset is specified, `start_subagent(...)` uses `phantom` by default.

### A typical orchestration flow

```
Parent agent receives task
  → start_subagent(preset: "phantom", task: "Map the auth module")
  → phantom saves findings via save_handoff("auth/recon.md", ...)
  → start_subagent(preset: "oracle", task: "Plan the refactor based on auth/recon.md")
  → oracle reads handoff, produces plan, saves via save_handoff("auth/plan.md", ...)
  → start_subagent(preset: "anvil", task: "Execute the plan in auth/plan.md")
  → start_subagent(preset: "inquisitor", task: "Review the changes anvil made")
  → Parent collects results and reports to user
```

### Bring your own agents

Drop a Markdown file with YAML frontmatter into any of these directories:

- **Global**: `~/.cline/agents/`
- **Project**: `.cline/agents/` (relative to your working directory)

That global path still works. In the current implementation, agent presets are loaded from:

- bundled presets in `agents/` alongside the plugin
- `~/.cline/agents/`
- `<cwd>/.cline/agents/`

```markdown
---
name: my-agent
description: One-line description shown in list_agent_presets
providerId: cline
modelId: anthropic/claude-sonnet-4.6
tools:
  - read_files
  - search_codebase
  - skills
skills:
  - code-review
  - refactoring
maxIterations: 25
cwd: ./src
---

You are a specialized agent that...
```

When `skills` is defined in an agent config, that list acts as an allowlist for the runtime `skills` tool:

- The `skills` tool description only advertises the listed skills.
- Invocations are scoped to that set. Asking for a non-listed skill returns not found.
- If `skills` is omitted, the agent can access all discovered enabled skills.

Project agents override global ones, and global ones override bundled ones (by name).

## Skills — Loadable Expertise

Skills are reusable instruction sets that any agent can load at runtime. Instead of baking specialized knowledge into every agent's system prompt, agents call `get_skill` to pick up exactly the expertise they need for the current task.

| Skill | What it teaches |
|---|---|
| `code-review` | Structured review: security, correctness, performance, maintainability — with severity-ranked findings |
| `test-generation` | Comprehensive test suites with mocking strategies and edge case coverage |
| `refactoring` | Safe, incremental refactoring without behavior changes |
| `debugging` | Systematic bug reproduction, isolation, and root-cause analysis |
| `api-design` | Clean API design for REST, RPC, and library interfaces |
| `migration` | Data and schema migration planning with rollback strategies |
| `documentation` | Technical docs — READMEs, API references, architecture guides |

Skills are composable. An agent can load `refactoring` + `test-generation` for a safe refactor with test coverage, or `debugging` + `code-review` to investigate a bug and audit the surrounding code.

### Add your own skills

Same pattern as agents — drop a Markdown file:

- **Global**: `~/.cline/data/settings/skills/`
- **Project**: `.cline/skills/`

In the current implementation, skills are loaded from:

- bundled skills in `skills/` alongside the plugin
- `~/.cline/data/settings/skills/`
- `<cwd>/.cline/skills/`

```markdown
---
name: my-skill
description: What this skill teaches
---

# My Skill

When performing this task, follow these steps...
```

## Handoff Store

Agents in the same conversation can pass files to each other through a shared handoff store. This is how `phantom` passes recon notes to `oracle`, or how `oracle` passes a plan to `anvil`.

- **`save_handoff`** writes a file: `save_handoff(path: "research/notes.md", content: "...")`
- **`read_handoff`** reads it back: `read_handoff(path: "research/notes.md")`

Paths are relative and scoped to the conversation. Files are stored under `~/.cline/data/plugins/subagents/handoffs/<conversationId>/`. Conversation IDs are validated to prevent path traversal.

## Configuration

All optional. Environment variables override defaults:

| Variable | Default | Description |
|---|---|---|
| `CLINE_SUBAGENT_PROVIDER_ID` | `cline` | Default provider for new subagent sessions |
| `CLINE_SUBAGENT_MODEL_ID` | `anthropic/claude-sonnet-4.6` | Default model for new subagent sessions |
| `CLINE_SUBAGENT_DEFAULT_PRESET` | `phantom` | Default bundled preset used by `start_subagent` when `preset` is omitted |
| `CLINE_SUBAGENTS_BACKEND_MODE` | `auto` | Session backend: `auto`, `local`, or `rpc` |
| `CLINE_SUBAGENT_CWD` | `process.cwd()` | Base working directory for subagent sessions |
| `CLINE_DATA_DIR` | `~/.cline/data` | Root data directory (affects all path resolution) |

## How It Works

Under the hood, each subagent is a full Cline SDK session created via `ClineCore.create(...)`. When you call `start_subagent`:

1. The plugin resolves the agent preset. If none is provided, it uses `phantom` by default, then merges provider/model/instruction overrides and creates a new session.
2. The first user message is sent to the session in the background — the tool returns the session ID immediately.
3. When the subagent finishes (or fails), the result is stored in memory and optionally pushed back to the parent session as a "steer" message.
4. The parent agent can poll with `get_subagent` or just wait for the notification.

The runtime host connection is resilient: if the initial connection fails, subsequent calls retry instead of permanently failing. Malformed agent/skill definition files are skipped gracefully without crashing the plugin.
