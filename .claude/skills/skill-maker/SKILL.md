---
name: skill-maker
description: Create Claude Code skills - modular packages that transform Claude from general-purpose to specialised agent. Use when creating, scaffolding, packaging, or improving skills.
---

# Skill Creation

Skills provide procedural knowledge, domain expertise, and reusable assets. They extend Claude's capabilities for specific domains.

## Core Principle

**Context is a shared resource.** Default assumption: Claude already knows most things. Only add what Claude genuinely lacks.

## Directory Structure

```
skill-name/
├── SKILL.md              # Required - under 500 lines
├── scripts/              # Executable Python/Bash for deterministic tasks
├── references/           # Documentation loaded as needed
└── assets/               # Output templates, images, boilerplate
```

## Progressive Disclosure

Three-level loading:
1. **Metadata** (name + description) - always in context (~100 words)
2. **SKILL.md body** - when skill triggers (<5k words)
3. **Bundled resources** - loaded as needed

## Creation Workflow

1. **Understand examples** - Get concrete usage examples first
2. **Plan contents** - Identify scripts, references, assets needed
3. **Build contents** - Create and test scripts before SKILL.md
4. **Write SKILL.md** - Imperative form, reference bundled resources
5. **Iterate** - Use on real tasks, notice inefficiencies, update

## Resources

- [frontmatter.md](frontmatter.md) - Description is the primary trigger
- [degrees-of-freedom.md](degrees-of-freedom.md) - When to use scripts vs instructions
- [bundled-resources.md](bundled-resources.md) - Scripts, references, assets
- [patterns.md](patterns.md) - Workflow and conditional patterns
- [anti-patterns.md](anti-patterns.md) - What to avoid
