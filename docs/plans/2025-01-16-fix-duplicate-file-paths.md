# Fix Duplicate File Paths in @context Search (Windows)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Windows path normalization bug that causes duplicate file paths to appear in @context search (e.g., `/routers/searched_sku.py` and `\routers\searched_sku.py` shown as separate entries).

**Architecture:** The issue is in `src/services/search/file-search.ts` where ripgrep output uses backslashes on Windows but active files are normalized to forward slashes. The fix normalizes all paths from ripgrep to use forward slashes for consistent comparison.

**Tech Stack:** TypeScript, Node.js path module, ripgrep

---

## Task 1: Add path normalization to ripgrep output

**Files:**
- Modify: `src/services/search/file-search.ts:55`

**Step 1: Update executeRipgrepForFiles function**

In the `executeRipgrepForFiles` function around line 54-58, normalize the path from ripgrep to use forward slashes consistently:

Current code:
```typescript
// Add file result to array
fileResults.push({
    path: relativePath,
    type: "file",
    label: path.basename(relativePath),
})
```

Updated code:
```typescript
// Add file result to array
fileResults.push({
    path: relativePath.replace(/\\/g, "/"), // Normalize Windows backslashes to forward slashes
    type: "file",
    label: path.basename(relativePath),
})
```

**Step 2: Also normalize directory paths**

Similarly around line 84-88, normalize directory paths:

Current code:
```typescript
const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
    path: dirPath,
    type: "folder",
    label: path.basename(dirPath),
}))
```

Updated code:
```typescript
const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
    path: dirPath.replace(/\\/g, "/"), // Normalize Windows backslashes to forward slashes
    type: "folder",
    label: path.basename(dirPath),
}))
```

**Step 3: Run linter**

```bash
npm run lint
```

**Step 4: Run format**

```bash
npm run format:fix
```

**Step 5: Run tests**

```bash
npm run test
```

**Step 6: Commit**

```bash
git add src/services/search/file-search.ts
git commit -m "fix: normalize Windows path separators in file search to prevent duplicates

On Windows, ripgrep returns paths with backslashes while active files
use forward slashes, causing the same file to appear twice in @context
search. This fix normalizes all paths from ripgrep to use forward
slashes for consistent comparison and deduplication.

Fixes #5747"
```

**Step 7: Create changeset**

```bash
npm run changeset
```

Select:
- Type: `patch` (bug fix)
- Description: "Fix duplicate file paths in @context search on Windows by normalizing path separators"

---

## Testing

**Manual verification on Windows (if available):**
1. Create a workspace with files in subdirectories
2. Type @ in the chat followed by a partial filename
3. Verify each file appears only once in the search results

**Automated test consideration:**
The file search logic is tested in the E2E tests. The normalization should work transparently with existing tests.

## Related Issues

Fixes #5747
