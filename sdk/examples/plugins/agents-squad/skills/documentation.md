---
name: documentation
description: Write clear technical documentation — READMEs, API docs, architecture guides, and inline comments.
---

# Documentation Skill

When writing or improving documentation, follow these principles:

## 1. Know Your Audience

- **README**: New developers evaluating or onboarding to the project.
- **API docs**: Developers integrating with the API.
- **Architecture docs**: Team members understanding system design.
- **Inline comments**: Future maintainers (including yourself in 6 months).

## 2. README Structure

A good README answers these questions in order:

1. **What is this?** One paragraph. What problem does it solve?
2. **Quick start**: The fastest path from zero to working. Copy-pasteable commands.
3. **Installation**: Prerequisites, install steps, configuration.
4. **Usage**: Common use cases with code examples.
5. **API reference**: If small enough; otherwise link to generated docs.
6. **Configuration**: All options with defaults and descriptions.
7. **Contributing**: How to set up dev environment, run tests, submit changes.
8. **License**: One line.

## 3. API Documentation

For each endpoint, function, or method:

```
### functionName(param1, param2, options?)

Brief description of what it does.

**Parameters:**
- `param1` (string, required) — What this parameter controls.
- `param2` (number, optional, default: 10) — What this parameter controls.
- `options.verbose` (boolean, default: false) — Enable verbose output.

**Returns:** `Promise<Result>` — Description of the return value.

**Throws:**
- `ValidationError` — When input is invalid.
- `NotFoundError` — When the resource doesn't exist.

**Example:**
```ts
const result = await functionName("input", 5);
```
```

## 4. Architecture Documentation

- Start with a high-level diagram (Mermaid, ASCII, or image).
- Describe each component's responsibility in one sentence.
- Document data flow for the most important operations.
- List key design decisions and their rationale.
- Note known limitations and planned improvements.

## 5. Inline Comments

Write comments that explain **why**, not **what**:

- ✅ `// Retry 3 times because the upstream API has transient 503s during deploys`
- ❌ `// Retry 3 times`
- ✅ `// Sort descending so the most recent entry is first for the dashboard`
- ❌ `// Sort the array`

Never comment obvious code. If code needs a comment to explain what it does, refactor the code to be self-explanatory first.

## 6. Quality Checklist

Before finalizing documentation:
- [ ] All code examples compile and run.
- [ ] No broken links.
- [ ] Consistent formatting and terminology.
- [ ] No outdated information from previous versions.
- [ ] Spelling and grammar checked.
- [ ] Table of contents for documents longer than 3 sections.
