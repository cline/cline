---
name: debugging
description: Systematic debugging — reproduce, isolate, diagnose, and fix bugs with root-cause analysis.
---

# Debugging Skill

When debugging an issue, follow this systematic process:

## 1. Understand the Bug

- Read the error message, stack trace, and any logs carefully.
- Reproduce the issue. If you can't reproduce it, you can't verify a fix.
- Identify the expected behavior vs. actual behavior.
- Note the environment: OS, runtime version, configuration, input data.

## 2. Isolate

Narrow the scope using binary search:

- **Which file?** Trace the stack trace or data flow to the origin.
- **Which function?** Add logging or breakpoints at entry/exit of suspect functions.
- **Which line?** Check variable values before and after the suspect operation.
- **Which input?** Find the minimal input that triggers the bug.

### Common Isolation Techniques
- Comment out code blocks to find the trigger.
- Add temporary `console.log` / `console.error` with labeled values.
- Use a debugger to step through execution.
- Write a minimal reproduction test case.

## 3. Diagnose

Once isolated, determine the root cause:

### Common Root Causes
- **Type mismatch**: Runtime value doesn't match expected type (null, undefined, wrong shape).
- **State mutation**: Shared state modified unexpectedly by another code path.
- **Race condition**: Timing-dependent behavior in async or concurrent code.
- **Off-by-one**: Loop bounds, array indexing, or string slicing errors.
- **Missing error handling**: Unhandled promise rejection, uncaught exception, or swallowed error.
- **Stale reference**: Closure capturing a variable that changes, or cached data that's outdated.
- **Environment difference**: Works locally but fails in CI/production due to config, permissions, or versions.

Ask: "Why did this happen?" at least twice to get past symptoms to the root cause.

## 4. Fix

- Write a test that fails because of the bug (before fixing it).
- Make the minimal change that fixes the root cause.
- Verify the test now passes.
- Check for the same pattern elsewhere in the codebase.
- Run the full test suite to confirm no regressions.

## 5. Report

Document:
- What the bug was (symptoms and root cause).
- How it was reproduced.
- What the fix was and why it's correct.
- Whether the same pattern exists elsewhere.
- What test was added to prevent regression.
