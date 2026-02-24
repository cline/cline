# Windows Hooks PowerShell Support Spec

## Purpose

Define the implementation plan for robust Windows hook support with PowerShell, including support for both:

- canonical extensionless hook names (`PreToolUse`)
- PowerShell-native names (`PreToolUse.ps1`)

This spec is intended to drive implementation for both CLI and VSCode extension hook behavior.

---

## Background / Current State

Recent branch changes established foundational Windows support:

- hook execution on Windows uses:
  - `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <hookPath>`
- hook discovery no longer blocks Windows globally
- UI reflects Windows-specific behavior (no chmod-style toggling)
- templates return PowerShell script content on Windows

However, management/discovery paths still assume only extensionless filenames in key places.

---

## Goals

1. Support **both** `HookName` and `HookName.ps1` on Windows.
2. Keep behavior deterministic when both files exist.
3. Ensure create/toggle/delete/refresh APIs work with either filename style.
4. Maintain backward compatibility with current extensionless naming.

## Non-goals

- No support for `.ps2` / `.ps3` naming conventions.
- No wildcard execution (`HookName.*`).
- No semantic changes to Unix/macOS hook discovery/execution.

---

## Functional Design

### 1) Windows discovery candidate order

For each valid hook type on Windows, resolve candidates in this order:

1. `<hooksDir>/<HookName>`
2. `<hooksDir>/<HookName>.ps1`

Return the first existing regular file.

This preserves parity with existing Linux-style naming while adding PowerShell-native `.ps1` support.

### 2) Conflict behavior (`HookName` and `HookName.ps1` both present)

- Execution uses `HookName` (higher precedence).
- Refresh/API surfaces one active hook entry for that hook type.
- Emit a warning log noting both files exist and which was selected.

### 3) Windows enable/disable semantics

- On Windows, `enabled` is file-existence based (already implemented in `refreshHooks` with `isExecutable()` returning true on win32).
- `toggleHook` remains no-op for chmod on Windows, but must validate existence using filename resolver (not fixed extensionless path only).

### 4) Create behavior

- `createHook` default remains extensionless canonical filename (`HookName`) for parity.
- If canonical file already exists, creation fails as it does today.
- Future enhancement (not in this phase): optional “create as `.ps1`” UX.

### 5) Delete behavior

- On Windows, delete should target the resolved active file (`HookName` preferred, else `.ps1`).
- Error if neither exists.

---

## Required Code Changes

### A. Hook resolution core

**File:** `src/core/hooks/hook-factory.ts`

Add/adjust Windows resolution logic:

- Update `findWindowsHook(hookName, hooksDir)` to try both candidates in priority order.
- Optionally add helper:
  - `private static async resolveWindowsHookCandidate(hookName, hooksDir): Promise<string | undefined>`

### B. Hook refresh listing

**File:** `src/core/controller/file/refreshHooks.ts`

Current behavior checks only `path.join(dir, hookName)`.

Update Windows path resolution so each hook entry can resolve to either:

- `.../<HookName>` or
- `.../<HookName>.ps1`

and return the selected path in `HookInfo.absolutePath`.

### C. Toggle endpoint compatibility

**File:** `src/core/controller/file/toggleHook.ts`

Current behavior validates existence at extensionless path only.

Update on Windows to resolve candidate using shared resolver, then:

- if found: return refreshed state (no chmod)
- if not found: throw “does not exist” error

### D. Delete endpoint compatibility

**File:** `src/core/controller/file/deleteHook.ts`

Current behavior deletes extensionless path only.

Update on Windows to resolve candidate and delete selected path.

### E. Docs update

**File:** `docs/customization/hooks.mdx`

Add explicit note:

- Windows supports hook files named either `HookName` or `HookName.ps1`.
- If both exist, `HookName` takes precedence.
- Hook scripts must contain valid PowerShell syntax.

---

## Test Plan

### Unit tests: `hook-factory`

Add/adjust tests for Windows platform mocking:

1. finds extensionless hook when present
2. finds `.ps1` when extensionless absent
3. prefers extensionless when both exist

### Unit tests: management endpoints

Update/add tests in:

- `src/test/hook-management.test.ts`
- `src/test/hook-management-integration.test.ts`

Windows-specific expectations:

1. `refreshHooks` reports hooks for `.ps1`-only files
2. `toggleHook` succeeds for `.ps1`-only files
3. `deleteHook` deletes `.ps1`-only files
4. precedence behavior when both files exist

### Execution tests

Update/expand:

- `src/test/hook-executor.test.ts`
- `src/core/hooks/__tests__/hook-factory.test.ts`

to cover Windows execution path using PowerShell and extensionless/`.ps1` script files.

### Remove outdated skip assumptions

Several test files still include Windows skip text (“hooks are not supported on Windows yet”).
Replace with platform-aware assertions now that support exists.

---

## Edge Cases / Risk Notes

1. **Path with spaces / unicode**
   - Ensure `spawn(..., shell: false)` argument passing remains intact for `-File <path>`.

2. **PowerShell availability**
   - docs already mention `powershell.exe` must be on PATH.
   - keep explicit troubleshooting guidance.

3. **Non-PowerShell contents in extensionless file**
   - still fails at runtime; document clearly that content must be valid PowerShell on Windows.

4. **Dual file confusion**
   - deterministic precedence + warning log minimizes ambiguity.

---

## Acceptance Criteria

Implementation is complete when all are true:

1. On Windows, hooks execute when either `HookName` or `HookName.ps1` exists.
2. If both exist, `HookName` is consistently selected.
3. `refreshHooks`, `toggleHook`, and `deleteHook` work for `.ps1`-only hooks.
4. Tests no longer globally skip Windows for core hook management/execution paths.
5. Docs explicitly describe naming support and precedence.

---

## Suggested Implementation Order

1. Hook resolver (`hook-factory.ts`)
2. `refreshHooks` integration
3. `toggleHook` + `deleteHook` integration
4. Unit tests
5. Docs update
6. Integration/CI verification on Windows runner
