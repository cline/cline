---
name: code-review
description: Structured code review — security, correctness, performance, and maintainability analysis with severity-ranked findings.
---

# Code Review Skill

When reviewing code, follow this structured process:

## 1. Scope the Review

- Identify all changed files and their relationships.
- Understand the intent: what problem does this change solve?
- Note any files that *should* have changed but didn't.

## 2. Correctness Pass

- Trace data flow through every changed path.
- Check edge cases: null/undefined, empty collections, boundary values.
- Verify error handling: are errors caught, propagated, and surfaced correctly?
- Look for off-by-one errors, race conditions, and state mutation bugs.
- Confirm types match runtime expectations (especially `any`, casts, and assertions).

## 3. Security Pass

- Flag unvalidated user input reaching sensitive operations (SQL, shell, file paths, URLs).
- Check authentication and authorization on every new endpoint or handler.
- Look for secrets in code, logs, or error messages.
- Verify CORS, CSP, and other security headers if applicable.
- Check for timing attacks in comparison operations.

## 4. Performance Pass

- Identify N+1 queries, unbounded loops, and unnecessary allocations.
- Check for missing indexes on new database queries.
- Look for blocking operations on hot paths.
- Verify pagination and limits on list operations.
- Note any operations that scale poorly with input size.

## 5. Maintainability Pass

- Evaluate naming: do names communicate intent?
- Check abstraction boundaries: is coupling introduced or reduced?
- Look for duplicated logic that should be shared.
- Verify tests cover the new behavior and edge cases.
- Note missing documentation for public APIs.

## 6. Report Format

Organize findings by severity:

- **Critical**: Must fix before merge. Bugs, security issues, data loss risks.
- **Major**: Should fix. Design problems, missing error handling, performance issues.
- **Minor**: Worth noting. Style, naming, minor improvements.
- **Positive**: Non-obvious good decisions worth calling out (keep brief).

For each finding, include:
1. File and line reference
2. What the issue is
3. Why it matters
4. Suggested fix (concrete, not vague)
