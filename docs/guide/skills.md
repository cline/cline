---
description: AI-Hydro Skills — workflow playbooks that guide the agent through multi-step hydrological analyses, educational module creation, and domain-specific methodologies.
---

# Skills

Skills are **workflow playbooks** — structured instruction sets that tell the AI agent exactly how to approach a specific type of task. When a skill exists for what you need, the agent loads it before planning and follows its steps, format contracts, and quality checklists rather than improvising from general knowledge.

This is what makes AI-Hydro output production-grade: a skill for creating a learning module encodes the exact HTML cell format, branding rules, citation requirements, and the 15-item pre-publish checklist. The agent doesn't guess — it follows the playbook.

---

## How Skills Work

When you ask the agent to create a learning module, run a baseflow separation analysis, or perform any multi-step workflow, it runs a discovery protocol before forming a plan:

1. **`list_skills()`** — retrieve all installed skills and scan for a match
2. **`load_skill(name)`** — load the full skill content (steps, contracts, examples)
3. **Follow the skill** — the skill governs the plan; the agent does not freelance around it
4. **`save_skill()`** — after a *novel* workflow, the agent saves a new skill automatically

This mirrors how Claude Code uses slash commands: the skill is the ground truth, not the agent's prior knowledge.

---

## Skill Sources

Skills come from three places, each with a priority order (workspace overrides marketplace):

| Source | Location | How added |
|---|---|---|
| **Marketplace** | `~/.aihydro/skills/marketplace/` | Installed via the Skills panel or the agent |
| **Agent-created** | `~/.aihydro/skills/agent-created/` | Saved by the agent via `save_skill()` |
| **Manual** | `~/.aihydro/skills/manual/` | Added by you via the "Add Skill" button |
| **Workspace** | `<workspace>/.aihydrorules/skills/` | Project-specific overrides (highest priority) |

---

## VS Code Skills Panel

Open the Skills panel by clicking the **Skills icon** (mortar board / 🎓) in the AI-Hydro sidebar, or run `AI-Hydro: Open Skills` from the command palette.

### Configured tab

Shows all skills currently installed on your system across all four sources. Each card displays:

- **Skill name** — human-readable title
- **Description** — one-line summary of what the skill does
- **Domain** — `frequency-analysis`, `baseflow`, `modelling`, `interpretation`, `composition`, or `general`
- **Source badge** — Marketplace / Agent / Manual / Workspace
- **Tags** — searchable keywords
- **When to use** — the trigger phrase the agent matches against

From the Configured tab you can:
- **View** — expand to read the full skill content
- **Edit** — modify manually-added or agent-created skills
- **Delete** — remove from `~/.aihydro/skills/`

### Marketplace tab

Browses the AI-Hydro Skills marketplace at `github.com/AI-Hydro/Skills`. Each marketplace card shows the skill name, description, and an **Install** button. Installing downloads the `SKILL.md` to `~/.aihydro/skills/marketplace/` and makes it available to the agent immediately — no restart required.

---

## Available Marketplace Skills

| Skill name | Domain | What it does |
|---|---|---|
| `interactive-module-builder` | general | Create production-grade HTML learning modules with branded cells, peer-reviewed citations, and full provenance |
| `baseflow-separation` | baseflow | Lyne-Hollick recursive filter + Eckhardt method with BFI interpretation |
| `flood-frequency-analysis` | frequency-analysis | L-moments fitting to Bulletin 17C distributions with uncertainty bounds |
| `watershed-characterisation` | general | End-to-end study: delineation → forcing → signatures → geomorphic → TWI |
| `hydro-visualization` | general | Scientific figure production: FDC, hydrograph, signature scatter, TWI map |

Skills are community-contributed — see [Contributing a Skill](#contributing-a-skill) to add yours.

---

## Using Skills in Chat

You do not need to call `list_skills()` yourself. The agent discovers and loads skills automatically for any covered task. Simply describe what you want:

```
"Create an interactive learning module on baseflow separation for the Piscataquis River."
```

The agent will:
1. Call `list_skills()` — sees `interactive-module-builder` matches
2. Call `load_skill("interactive-module-builder")` — reads the 200-line skill
3. Follow the skill's standardization contract: 8 required sections, exact cell format, branded hero, provenance footer, references, checklist
4. Call `show_html_preview(file_path=...)` — auto-open in the HTML Preview panel

You'll see the skill load in the tool call log before the agent starts planning.

---

## Skill File Format

Each skill is a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: One-sentence description of what this skill does.
when_to_use: When the user asks to... (natural language trigger conditions).
domain: general
tools_used:
  - show_html_preview
  - get_researcher_profile
tags:
  - keyword1
  - keyword2
---

# My Skill Title

## When This Skill Applies

...

## Step 1 — ...

## Step 2 — ...

## Format Contract

...

## Pre-Publish Checklist

- [ ] Item 1
- [ ] Item 2
```

### Required frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique skill slug (used by `load_skill(name)`) |
| `description` | ✅ | One-sentence summary shown in the panel and used for matching |
| `when_to_use` | ✅ | Natural language trigger phrases the agent matches against |
| `domain` | ✅ | One of: `frequency-analysis`, `baseflow`, `modelling`, `interpretation`, `composition`, `general` |
| `tools_used` | optional | MCP tools this skill relies on |
| `tags` | optional | Keywords for filtering and discovery |

---

## MCP Tool Reference

The agent uses three MCP tools to interact with the skills system:

### `list_skills(domain?)`

Returns all installed skills. The agent calls this as a mandatory pre-flight before planning any multi-step task. Each entry includes `name`, `description`, `when_to_use`, `domain`, `tags`, and `source`.

```python
# Filter by domain
list_skills(domain="baseflow")
```

### `load_skill(name)`

Loads the full content of a skill by name. The agent reads the complete `SKILL.md` before forming its plan. The skill's steps and contracts are binding.

```python
load_skill("interactive-module-builder")
```

### `save_skill(name, description, content, domain, when_to_use, tags?, tools_used?)`

Saves a new skill to `~/.aihydro/skills/agent-created/`. The agent calls this automatically after completing a novel multi-step workflow.

```python
save_skill(
    name="Drought Index Analysis",
    description="Compute SPI and SPEI drought indices from forcing data.",
    content="## Steps\n\n1. ...",
    domain="general",
    when_to_use="When the user asks about drought, SPI, SPEI, or aridity."
)
```

---

## Contributing a Skill

Skills follow the [Agent Skills Open Standard](https://github.com/AI-Hydro/Skills). To contribute:

1. Fork `github.com/AI-Hydro/Skills`
2. Create `skills/<your-skill-name>/SKILL.md` following the format above
3. Add `skills/<your-skill-name>/manifest.json` with the skill metadata
4. Submit a pull request

Community skills appear in the VS Code Marketplace tab after the next marketplace sync.

---

## Workspace-Local Skills

Place a `SKILL.md` in `<workspace>/.aihydrorules/skills/<name>/` to override a marketplace skill or add a project-specific workflow. Workspace skills take priority over all other sources and are not shared — they stay in your project.

```
my-project/
└── .aihydrorules/
    └── skills/
        └── my-project-workflow/
            └── SKILL.md
```

These are ideal for project-specific data conventions, site-specific analysis steps, or in-progress skills you are developing before publishing to the marketplace.
