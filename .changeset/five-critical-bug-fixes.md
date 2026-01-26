---
"cline": patch
---

## Bug Fixes

### MCP Tool Auto-Approval
- Fix MCP tool auto-approval to respect individual tool `autoApprove` settings from MCP server connections (related to issue #8780)

### DiffViewProvider Improvements
- **BOM Preservation**: Preserve Byte Order Mark (BOM) for files that originally had it, preventing encoding issues
- **Race Condition Prevention**: Add lock mechanism to prevent concurrent updates during streaming in `update()` method
- **Line Count Accuracy**: Use `getDocumentLineCount()` instead of regex for accurate line count in `revertChanges()`
- **Async Operation Fix**: Add missing `await` in `scrollToFirstDiff()` to ensure scroll completes before returning