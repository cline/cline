# Agent Squad Plugin

Spin up background subagents from any Cline SDK agent. Each subagent runs as its own session with its own provider, model, and system prompt — useful for parallel recon, planning, implementation, and review.

## Quick start

```ts
import { ClineCore } from "@cline/core";

const cline = await ClineCore.create({ backendMode: "auto" });

await cline.start({
  config: {
    providerId: "cline",
    modelId: "anthropic/claude-sonnet-4.6",
    cwd: process.cwd(),
    enableTools: true,
    systemPrompt: "You are a coding assistant with access to subagents.",
    pluginPaths: ["./examples/plugins/agents-squad"],
  },
  prompt: "Use subagents to investigate and refactor this repo.",
  interactive: true,
});
```

Pass the plugin **directory** as the path. The loader reads `package.json` and discovers entry points from the `cline.plugins` field.

## Tools

| Tool | Purpose |
|---|---|
| `start_subagent` | Start a subagent in the background and return a session ID immediately. |
| `message_subagent` | Send a follow-up message to a running subagent. |
| `get_subagent` | Poll status, output, or error for a subagent session. |
| `list_agent_presets` | List bundled, global, and project agent presets. |
| `list_skills` / `get_skill` | Discover and load loadable skill instructions. |
| `save_handoff` / `read_handoff` | Share text between subagents in the same conversation. |

`start_subagent` accepts `preset` and/or `instructions`. When `preset` is omitted it defaults to `phantom` (configurable via `CLINE_SUBAGENT_DEFAULT_PRESET`).

## Bundled agents

| Agent | Model | Role |
|---|---|---|
| `phantom` | `google/gemini-3-flash-preview` | Fast codebase recon — maps structure, surfaces conventions, never implements. |
| `oracle` | `anthropic/claude-opus-4.6` | Opinionated planning — challenges assumptions and produces execution-ready plans. |
| `anvil` | `anthropic/claude-opus-4.6` | Surgical implementation — reads before writing, stays in scope, reports exact diffs. |
| `inquisitor` | `openai/gpt-5.5` | Adversarial review — finds bugs, severity-ranks findings. |

### Typical orchestration

```
parent → start_subagent(preset: "phantom", task: "Map the auth module")
       → phantom: save_handoff("auth/recon.md", ...)
       → start_subagent(preset: "oracle", task: "Plan refactor from auth/recon.md")
       → oracle: save_handoff("auth/plan.md", ...)
       → start_subagent(preset: "anvil", task: "Execute auth/plan.md")
       → start_subagent(preset: "inquisitor", task: "Review anvil's changes")
```

## Custom agents and skills

Drop a Markdown file with YAML frontmatter into one of these directories. Project overrides global, global overrides bundled (by `name`).

| Kind | Bundled | Global | Project |
|---|---|---|---|
| Agents | `agents/` next to `index.ts` | `~/.cline/data/settings/agents/` | `<cwd>/.cline/agents/` |
| Skills | `skills/` next to `index.ts` | `~/.cline/data/settings/skills/` | `<cwd>/.cline/skills/` |

Agent file:

```markdown
---
name: my-agent
description: One-line description shown in list_agent_presets
providerId: cline
modelId: anthropic/claude-sonnet-4.6
cwd: ./src
maxIterations: 25
---

You are a specialized agent that...
```

Skill file:

```markdown
---
name: my-skill
description: What this skill teaches
---

When performing this task, follow these steps...
```

Skills are reusable instructions any agent can pull in at runtime via `get_skill`. Bundled skills include `code-review`, `test-generation`, `refactoring`, `debugging`, `api-design`, `migration`, and `documentation`.

## Handoff store

Subagents in the same conversation share a small file store, scoped to the conversation ID:

- `save_handoff({ path, content })` — writes a file
- `read_handoff({ path })` — reads it back

Files live under `~/.cline/data/plugins/subagents/handoffs/<conversationId>/`. Paths are validated to prevent traversal.

## Configuration

All optional. Environment variables override defaults:

| Variable | Default |
|---|---|
| `CLINE_SUBAGENT_PROVIDER_ID` | `cline` |
| `CLINE_SUBAGENT_MODEL_ID` | `anthropic/claude-sonnet-4.6` |
| `CLINE_SUBAGENT_DEFAULT_PRESET` | `phantom` |
| `CLINE_SUBAGENTS_BACKEND_MODE` | `auto` (`auto` \| `hub` \| `local`) |
| `CLINE_SUBAGENT_CWD` | `process.cwd()` |
| `CLINE_DATA_DIR` | `~/.cline/data` |

## How it works

Each subagent is a full Cline SDK session created via `ClineCore.create(...)`. `start_subagent` resolves the preset, merges any overrides, starts a non-interactive session, and returns the session ID immediately. The first turn runs in the background; when it finishes (or fails) the result is stored and — unless `notifyParent: false` — pushed back to the parent session as a steer message. The parent can also poll with `get_subagent`.
