# Skill Anatomy

## Directory Structure

```
skill-name/
├── SKILL.md              (required)
│   ├── YAML frontmatter  (name, description required)
│   └── Markdown body     (instructions, workflow, gates)
├── references/           (optional — docs loaded into context as needed)
├── scripts/              (optional — executable code for deterministic tasks)
├── assets/               (optional)
│   └── templates/        (optional — markdown templates for output)
└── agents/               (optional — subagent instructions)
```

## YAML Frontmatter

```yaml
---
name: skill-name
description: What this skill does and when to trigger it. Include specific contexts and keywords to prevent under-triggering.
---
```

The description is the primary triggering mechanism. Make it slightly "pushy" — include both what the skill does AND specific contexts for when to use it.

## SKILL.md Body Structure

A well-structured SKILL.md typically includes:

1. **Overview**: One paragraph explaining the skill's purpose
2. **Start Here**: What to load before starting (references, context files)
3. **When To Use**: Trigger conditions
4. **Core Workflow**: Step-by-step instructions
5. **Completion Gates**: Checklist of what must be true before finishing
6. **Notes**: Edge cases, anti-patterns, tips

## Progressive Disclosure

Three-level loading system:

1. **Metadata** (name + description) — Always in context (~100 words)
2. **SKILL.md body** — In context when skill triggers (<500 lines)
3. **Bundled resources** — Loaded as needed (unlimited size)

Keep SKILL.md under 500 lines. If approaching this limit, move detailed guidance to references/ with clear pointers.

## Domain Organization

When a skill supports multiple domains or frameworks:

```
skill-name/
├── SKILL.md (workflow + selection logic)
└── references/
    ├── domain-a.md
    ├── domain-b.md
    └── domain-c.md
```

The AI reads only the relevant reference file based on context.

## Writing Patterns

### Output Format Definition

```markdown
## Report structure
Use this template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

### Examples

```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Integration with Other Skills

When a skill depends on or hands off to other skills:
- Document the handoff in the workflow
- List dependencies in `skills.json` under `dependsOnSkills` or `helperSkills`
- Include the expected input/output contract

## Safety

Skills must not contain malware, exploit code, or content that could compromise system security. A skill's contents should not surprise the user in their intent if described.
