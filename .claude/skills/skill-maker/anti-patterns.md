# Anti-Patterns to Avoid

## Over-Explaining Fundamentals

Claude already knows most things. Don't explain basic concepts.

**Bad:**
```markdown
## What is a Function?

A function is a reusable block of code that performs a specific task.
Functions can accept parameters and return values...
```

**Good:**
```markdown
## Function Guidelines

- Use type hints on all parameters and return values
- Keep functions under 20 lines
- Single responsibility per function
```

## Duplicating Information

Information should live in one place only.

**Bad:**
- Same API docs in SKILL.md AND references/api.md
- Repeating patterns already in a script

**Good:**
- SKILL.md references the detailed docs: "See [references/api.md](references/api.md)"
- SKILL.md explains when to run script, script handles the how

## Wrong Placement of "When to Use"

The body only loads after triggering. Put triggers in the description.

**Bad:**
```yaml
---
description: API client generator
---

# API Client Generator

Use this skill when you need to generate TypeScript clients...
```

**Good:**
```yaml
---
description: Generate TypeScript API clients from OpenAPI specs. Use when working with API definitions, generating client code, or updating integrations.
---
```

## Monolithic SKILL.md

Keep under 500 lines. Split into references.

**Bad:**
- 1500-line SKILL.md with embedded documentation

**Good:**
- 200-line SKILL.md that references bundled docs
- Large reference files loaded only when needed

## Untested Scripts

Always test scripts before packaging.

**Bad:**
- Including scripts that might fail
- Assuming scripts work without running them

**Good:**
- Run every script manually
- Test with various inputs
- Handle error cases

## Extraneous Documentation

Only include what Claude needs to do the job.

**Don't create:**
- README.md
- INSTALLATION_GUIDE.md
- CHANGELOG.md
- CONTRIBUTING.md

The skill directory is not a traditional project - it's instructions for Claude.

## Vague Descriptions

The description must trigger correctly.

**Bad:**
```yaml
description: A helpful skill
description: Does stuff with code
description: Useful tool
```

**Good:**
```yaml
description: Generate database migration files for schema changes. Use when adding tables, modifying columns, creating indexes, or managing foreign keys.
```

## Hardcoded Paths

Use relative paths within the skill directory.

**Bad:**
```markdown
Run `/home/user/skills/my-skill/scripts/validate.py`
```

**Good:**
```markdown
Run `scripts/validate.py`
```

## Missing Context in References

For large reference files, include search guidance.

**Bad:**
```markdown
See references/api.yaml for details.
```

**Good:**
```markdown
See [references/api.yaml](references/api.yaml).

Key endpoints (search terms):
- User creation: `POST /api/users`
- Order listing: `GET /api/orders`
```
