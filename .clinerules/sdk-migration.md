# SDK Migration

When working on the SDK migration (branch `sdk-migration-v3`), start by
reading `sdk-migration/README.md` in full. It contains the step-by-step
plan, core principles, and operational procedure.

Key documents:
- `sdk-migration/README.md` — Entry point, plan, steps
- `sdk-migration/ARCHITECTURE.md` — Design decisions, features, SDK capabilities
- `sdk-migration/SDK-REFERENCE/OAUTH.md` — SDK OAuth reference
- `sdk-migration/SDK-REFERENCE/MCP.md` — SDK MCP reference
- `sdk-migration/PROBLEMS.md` — Issue tracker with verification status
- `src/dev/debug-harness/README.md` — Debug harness API

## Critical Rules

1. **Always use `kb_search(name="sdk", query="...")` before implementing**
   SDK features. Don't guess at APIs.
2. **Never mark a problem 🟢 without evidence.** Write the test first.
3. **Delete and document.** When replacing a classic module, delete it
   immediately and add `// Replaces classic src/core/... (see origin/main)`.
   Use `kb_search(name="cline", commit="origin/main")` or
   `git show origin/main:path` to reference the classic implementation.
4. **Single entry point.** No `CLINE_SDK` env variable. There is one
   codepath — the SDK adapter.
5. **Use `{appBaseUrl}`**, never hardcode `app.cline.bot`.
6. **Avoid `as` casts.** Use explicit conversion functions with tests.
7. **Dismiss the Kanban overlay** before any debug harness interaction.
8. **Use command palette** to navigate tabs in the debug harness.
