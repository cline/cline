# Fix History Button State After Side Icon Delete

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where the "Delete selected history" button text doesn't revert to "Delete all history" when a selected history item is deleted using the side delete icon.

**Architecture:** The issue is in `webview-ui/src/components/history/HistoryView.tsx`. When deleting a history item via the side icon, the `selectedItems` state is not updated to remove the deleted item, causing the button text to remain in "selected" mode.

**Tech Stack:** React, TypeScript, gRPC

---

## Task 1: Update handleDeleteHistoryItem to clean selectedItems

**Files:**
- Modify: `webview-ui/src/components/history/HistoryView.tsx:154-161`

**Step 1: Update handleDeleteHistoryItem callback**

The `handleDeleteHistoryItem` function needs to remove the deleted item from `selectedItems` if it was selected.

Current code:
```typescript
const handleDeleteHistoryItem = useCallback(
    (id: string) => {
        TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] }))
            .then(() => fetchTotalTasksSize())
            .catch((error) => console.error("Error deleting task:", error))
    },
    [fetchTotalTasksSize],
)
```

Updated code:
```typescript
const handleDeleteHistoryItem = useCallback(
    (id: string) => {
        TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] }))
            .then(() => fetchTotalTasksSize())
            .catch((error) => console.error("Error deleting task:", error))
        // Remove deleted item from selected items if it was selected
        setSelectedItems((prev) => prev.filter((itemId) => itemId !== id))
    },
    [fetchTotalTasksSize],
)
```

**Step 2: Run TypeScript compiler**

```bash
npm run compile
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
git add webview-ui/src/components/history/HistoryView.tsx
git commit -m "fix: update button text after deleting selected history via side icon

When a selected history item is deleted using the delete icon beside it,
the selected items state was not being updated. This caused the button
to remain in \"Delete selected\" mode even when no items were selected.

Fixes #6033"
```

**Step 7: Create changeset**

```bash
npm run changeset
```

Select:
- Type: `patch` (bug fix)
- Description: "Fix history delete button state not updating when deleting via side icon"

---

## Testing

**Manual verification:**
1. Navigate to History section
2. Select one or more history items
3. Verify button text changes to "Delete selected history"
4. Click the delete icon beside one of the selected items
5. Verify the button text updates back to "Delete all history" if no items remain selected

## Related Issues

Fixes #6033
