# Batch 2: Next 5 Fixable Bugs from Cline Repository

**Date:** December 2, 2025
**Source:** [Cline GitHub Issues](https://github.com/cline/cline/issues?q=is%3Aissue+is%3Aopen+label%3Abug)
**Priority:** High-impact fixable bugs (excluding already fixed #7778, #7789, #7793, #7398, #7788)

---

## 🔥 SELECTED FOR BATCH 2 - Top 5 Fixable Bugs

### 6. 🔍 Empty Tool Description Causes AWS Bedrock API Failure (#7696)

**Severity:** MEDIUM - Breaks AWS Bedrock integration
**Issue:** [#7696](https://github.com/cline/cline/issues/7696)
**Created:** Nov 26, 2025

**Problem:**
- Empty tool descriptions trigger API validation errors on AWS Bedrock
- Bedrock requires all tools to have non-empty description fields
- Other providers tolerate empty descriptions, but Bedrock strictly validates

**Error:**
```
ValidationException: Empty tool description not allowed
```

**Fix:**
```typescript
// Ensure all tool definitions have descriptions
function getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    read_file: "Read the contents of a file from the workspace",
    write_to_file: "Write or update content in a file",
    execute_command: "Execute a shell command in the terminal",
    // ... add descriptions for all tools
  }

  return descriptions[toolName] || `Execute ${toolName} operation`
}
```

**Files to Change:**
- `src/api/providers/bedrock.ts` - Tool definition builder
- `src/shared/tools.ts` - Tool schema definitions

**Difficulty:** ⭐⭐ Medium

---

### 7. 🪟 Quote Escaping Issue in Windows cmd.exe (#7587)

**Severity:** HIGH - All commands fail on Windows cmd.exe
**Issue:** [#7587](https://github.com/cline/cline/issues/7587)
**Created:** Nov 20, 2025

**Problem:**
- Windows cmd.exe doesn't handle quote escaping the same as PowerShell/bash
- Commands with quotes fail completely
- Issue specific to cmd.exe, not PowerShell

**Example:**
```bash
# PowerShell (works)
echo "Hello World"

# cmd.exe (fails with current escaping)
echo "Hello World"  # Interprets quotes literally

# cmd.exe (should be)
echo Hello World  # Or use different escaping
```

**Fix:**
```typescript
function escapeForWindows(command: string, shell: string): string {
  if (shell.includes('cmd.exe')) {
    // cmd.exe specific escaping
    return command.replace(/"/g, '""')  // Double quotes
  } else {
    // PowerShell/bash escaping
    return command
  }
}
```

**Files to Change:**
- `src/utils/shell.ts` - Shell command escaping
- `src/integrations/terminal/` - Command execution

**Difficulty:** ⭐⭐ Medium

---

### 8. 🎯 Cline Doesn't Recognize Act Mode is Active (#7462)

**Severity:** MEDIUM - Mode detection broken
**Issue:** [#7462](https://github.com/cline/cline/issues/7462)
**Created:** Nov 14, 2025

**Problem:**
- Extension fails to detect when Act mode has been enabled
- State not properly updated after mode toggle
- UI shows wrong mode indicator

**Fix:**
```typescript
// Ensure mode state is synchronized after toggle
async function toggleMode(newMode: 'plan' | 'act') {
  await this.stateManager.updateState({ mode: newMode })

  // Force UI refresh
  await this.postStateToWebview()

  // Emit mode change event
  this.onModeChanged.fire(newMode)
}
```

**Files to Change:**
- `src/core/controller/index.ts` - Mode toggle handler
- `src/core/storage/StateManager.ts` - State synchronization
- `webview-ui/src/components/` - UI mode indicator

**Difficulty:** ⭐⭐ Medium

---

### 9. 📊 Model Configuration UI Elements Missing in v1.1.6 (#7814)

**Severity:** MEDIUM - UI regression
**Issue:** [#7814](https://github.com/cline/cline/issues/7814)
**Created:** Dec 2, 2025

**Problem:**
- Model configuration section disappeared after v1.1.6 upgrade
- Context window progress bar not visible
- Worked in v1.1.5, broken in v1.1.6

**What's Missing:**
- Model selection dropdown
- Context window size setting
- Temperature slider
- Progress bar showing token usage

**Fix:**
Check for CSS/conditional rendering changes in v1.1.6:
```typescript
// Ensure components are rendered
<ModelConfiguration
  visible={true}
  model={currentModel}
  contextWindow={contextWindow}
/>

<ContextWindowProgressBar
  visible={true}
  current={tokensUsed}
  max={maxTokens}
/>
```

**Files to Change:**
- `webview-ui/src/components/settings/` - Model config component
- `webview-ui/src/App.tsx` - Component visibility logic
- CSS files that may have hidden elements

**Difficulty:** ⭐⭐ Medium

---

### 10. 🗑️ replace_in_file Tool Deletes Next Line After Replacement (#7600)

**Severity:** HIGH - Data loss bug
**Issue:** [#7600](https://github.com/cline/cline/issues/7600)
**Created:** Nov 21, 2025

**Problem:**
- Text editing operation inadvertently removes subsequent lines
- Happens in JetBrains plugin
- Causes unexpected code deletion

**Root Cause:**
Likely off-by-one error in line range calculation or improper newline handling

**Fix:**
```typescript
function replaceInFile(filePath: string, oldText: string, newText: string) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  // Find and replace, preserving line boundaries
  const startLine = findStartLine(lines, oldText)
  const endLine = findEndLine(lines, oldText, startLine)

  // Ensure we don't delete the line after
  const before = lines.slice(0, startLine).join('\n')
  const after = lines.slice(endLine + 1).join('\n')  // +1, not +2!

  fs.writeFileSync(filePath, before + '\n' + newText + '\n' + after)
}
```

**Files to Change:**
- JetBrains plugin file editing code
- `src/core/task/tools/handlers/` - Replace file handler

**Difficulty:** ⭐⭐⭐ Medium-Hard

---

## 🎯 Summary of Batch 2

### Selected Fixes:
1. **#7696** - Empty tool descriptions for AWS Bedrock (Provider fix)
2. **#7587** - Windows cmd.exe quote escaping (Cross-platform fix)
3. **#7462** - Act mode detection broken (State management fix)
4. **#7814** - UI elements missing in v1.1.6 (UI regression fix)
5. **#7600** - replace_in_file deletes next line (Data loss fix)

**Estimated Time:** 3-5 hours for all 5
**Impact:** Critical data loss prevention + cross-platform compatibility + UI fixes
**Difficulty:** Medium to Medium-Hard

---

## 📚 Sources

- [Cline GitHub Issues - Open Bugs](https://github.com/cline/cline/issues?q=is%3Aissue+is%3Aopen+label%3Abug)
- [Issue #7696 - AWS Bedrock Empty Tool Description](https://github.com/cline/cline/issues/7696)
- [Issue #7587 - Windows cmd.exe Quote Escaping](https://github.com/cline/cline/issues/7587)
- [Issue #7462 - Act Mode Detection](https://github.com/cline/cline/issues/7462)
- [Issue #7814 - UI Elements Missing](https://github.com/cline/cline/issues/7814)
- [Issue #7600 - replace_in_file Deletion Bug](https://github.com/cline/cline/issues/7600)

---

**Next Steps:**
1. Create new feature branch: `fix/batch-2-bugs`
2. Implement fixes one by one
3. Test each fix thoroughly
4. Commit with detailed messages
5. Create PR for review
