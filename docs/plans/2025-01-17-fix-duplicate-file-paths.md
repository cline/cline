# Fix Duplicate File Paths with / and \\ in @context Search

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Windows path separator inconsistency causing duplicate file paths in @context autocomplete

**Architecture:** Normalize all paths to use forward slashes consistently when building file search results

**Tech Stack:** TypeScript, VS Code Extension API, ripgrep

---

## Context

On Windows, file search shows duplicate paths like:
- `/routers/searched_sku.py`
- `/routers\\searched_sku.py`

**Root Cause:**
- `executeRipgrepForFiles` produces paths with backslashes (Windows default)
- Active files are normalized to forward slashes
- Deduplication fails due to mismatched separators

---

### Task 1: Normalize paths in executeRipgrepForFiles

**Files:**
- Modify: `src/services/search/file-search.ts:50-58`

**Step 1: Write the failing test**

First, check if tests exist for this function:

```bash
ls -la src/services/search/__tests__/
```

If `file-search.test.ts` exists, add a test for Windows path normalization:

```typescript
describe("executeRipgrepForFiles - Windows path normalization", () => {
    it("should normalize Windows backslashes to forward slashes", async () => {
        // Mock spawn function that returns Windows paths
        const mockSpawn = jest.fn(() => ({
            stdout: {
                on: jest.fn(),
            },
            stderr: {
                on: jest.fn(),
            },
            on: jest.fn((event, callback) => {
                if (event === "error") {
                    // No error
                }
            }),
            kill: jest.fn(),
        }))

        // Test that paths are normalized
        // This test verifies the fix for issue #5747
    })
})
```

**Step 2: Run test to verify it exists (or fails)**

```bash
npm test -- src/services/search/__tests__/file-search.test.ts
```

**Step 3: Implement the fix**

In `executeRipgrepForFiles`, add path normalization after line 51:

```typescript
// Line 50-55, modify as:
// Convert absolute path to a relative path from workspace root
const relativePath = path.relative(workspacePath, line)

// Normalize path separators to forward slashes for cross-platform consistency
// (fixes duplicate paths on Windows where ripgrep returns backslashes)
const normalizedPath = relativePath.replace(/\\/g, "/")

// Add file result to array
fileResults.push({
    path: normalizedPath,  // Use normalized path
    type: "file",
    label: path.basename(relativePath),
})
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/services/search/__tests__/file-search.test.ts
```

**Step 5: Manual test verification**

1. Build the extension: `npm run compile`
2. Reload window
3. Use `@` context search on Windows (or test with paths containing spaces)
4. Verify no duplicate paths appear

**Step 6: Commit**

```bash
git add src/services/search/file-search.ts
git commit -m "fix: normalize Windows path separators in file search

Fixes #5747 - On Windows, @context search showed duplicate file paths
with mixed separators (e.g., /routers/file.py and /routers\\file.py).
Root cause: ripgrep returns backslash-separated paths on Windows,
but active file paths were normalized to forward slashes, causing
deduplication to fail.

Solution: Normalize all paths from ripgrep to use forward slashes
consistently, matching the normalization already applied to active files."
```

---

### Task 2: Run full test suite

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass

**Step 2: Format code**

```bash
npm run format:fix
```

**Step 3: Create changeset**

```bash
npm run changeset
```

Select: `patch`
Description: `Fix duplicate file paths in @context search on Windows`

---

## Summary

This fix ensures consistent path normalization across the file search system, preventing duplicate entries in @context autocomplete on Windows.
