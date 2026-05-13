---
name: refactoring
description: Safe, incremental refactoring — extract, rename, simplify, and restructure code without changing behavior.
---

# Refactoring Skill

When refactoring code, follow this disciplined process:

## 1. Establish Safety Net

Before changing anything:
- Confirm existing tests pass. If no tests exist, write characterization tests first.
- Identify all callers and consumers of the code being refactored.
- Document the current behavior as your contract — refactoring must not change it.

## 2. Plan the Refactoring

Choose the smallest transformation that makes progress:

### Common Refactorings
- **Extract function**: Pull a block into a named function when it has a clear purpose.
- **Inline function**: Remove a function that adds indirection without clarity.
- **Rename**: Change names to communicate intent (variables, functions, types, files).
- **Extract type/interface**: Pull inline types into named declarations.
- **Simplify conditionals**: Replace nested if/else with early returns, guard clauses, or lookup tables.
- **Remove dead code**: Delete unreachable code, unused imports, and commented-out blocks.
- **Reduce parameters**: Group related parameters into an options object.
- **Split module**: Break a large file into focused modules with clear responsibilities.

### Decision Criteria
- Does this reduce cognitive load for the next reader?
- Does this make the code easier to test?
- Does this reduce the blast radius of future changes?
- If none of the above: don't refactor it.

## 3. Execute Incrementally

- Make one refactoring at a time.
- After each change, verify tests still pass.
- Commit or checkpoint after each successful step.
- If a step breaks something, revert it and try a smaller step.

## 4. Verify

After all changes:
- Run the full test suite.
- Check that all callers still compile and work correctly.
- Verify no behavior has changed (same inputs → same outputs).
- Review the diff: is the code genuinely simpler, or just different?

## 5. Report

Summarize:
- What was refactored and why.
- Which files changed.
- Any behavior that looks different but is equivalent.
- Anything left incomplete or worth refactoring next.
