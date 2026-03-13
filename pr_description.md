## Summary
This PR implements 5 critical bug fixes identified through analysis of recent issues and code review.

## Changes

### 1. MCP Tool Auto-Approval Bug Fix (related to issue #8780)
- **File**: `src/core/task/tools/handlers/UseMcpToolHandler.ts`
- **Problem**: MCP tools were not respecting their individual `autoApprove` settings from MCP server configuration.
- **Solution**: Updated the `execute` method to check the tool's `autoApprove` property from the MCP server connection in addition to the global auto-approval settings.

### 2. BOM Preservation Bug Fix
- **File**: `src/integrations/editor/DiffViewProvider.ts`
- **Problem**: Byte Order Mark (BOM) was being stripped from files during the `update()` method but never added back when saving, causing encoding issues for files that originally had a BOM.
- **Solution**: 
  - Only strip BOM in `update()` if the original file didn't have BOM
  - Add BOM back in `saveChanges()` if original file had BOM

### 3. Race Condition in Update Method
- **File**: `src/integrations/editor/DiffViewProvider.ts`
- **Problem**: The `update()` method could be called multiple times in quick succession (during streaming), causing race conditions and overlapping updates.
- **Solution**: Added an `isUpdating` lock mechanism with `try/finally` block to ensure only one update operation runs at a time.

### 4. Inaccurate Line Count Calculation in revertChanges()
- **File**: `src/integrations/editor/DiffViewProvider.ts`
- **Problem**: The `revertChanges()` method used regex-based line counting which could be inaccurate, especially with mixed line endings or empty documents.
- **Solution**: Changed to use the abstract `getDocumentLineCount()` method which provides the actual document line count from the editor implementation.

### 5. Missing Await in scrollToFirstDiff()
- **File**: `src/integrations/editor/DiffViewProvider.ts`
- **Problem**: The `scrollToFirstDiff()` method called `this.scrollEditorToLine(lineCount)` without `await`, potentially causing the scroll operation to not complete before returning.
- **Solution**: Added `await` keyword to ensure the scroll operation completes.

## Testing
- All changes follow existing patterns and abstractions
- No breaking changes to public APIs
- Changes have been linted and formatted according to project standards

## Related Issues
- Issue #8780 (MCP tool auto-approval)
- Various encoding and file editing reliability issues

## Changeset
- Added patch changeset for version bump