# Frontmatter Reference

## Supported Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Skill name and `/slash-command`. Defaults to directory name. |
| `description` | Yes | **Primary trigger mechanism.** What the skill does and when to use it. |
| `license` | No | Complete terms or reference to LICENSE.txt |

## The Description is Critical

The description is your primary triggering mechanism. The SKILL.md body only loads *after* triggering, so put all "when to use" guidance in the description field.

**Good description:**
```yaml
---
name: api-client
description: Generate TypeScript API clients from OpenAPI specs. Use when working with API definitions, generating client code, or updating API integrations.
---
```

**Bad description:**
```yaml
---
name: api-client
description: A helpful skill for APIs
---
```

The bad example is too vague - Claude won't know when to trigger it.

## Description Pattern

Include three elements:
1. What the skill does (brief)
2. Specific triggers/contexts
3. Complete "when to use" information

```yaml
description: Comprehensive X with Y support. Use when Claude needs to: (1) Action A, (2) Action B, (3) Action C.
```

## Complete Example

```yaml
---
name: database-migrations
description: Create and manage database schema migrations. Use when adding tables, modifying columns, creating indexes, or rolling back schema changes.
license: MIT - see LICENSE.txt
---
```
