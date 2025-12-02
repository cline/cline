# TODO - Remaining Bcline Issues

## ✅ Completed (2/5)

- [x] **Issue #7470** - Terminal double quotes in Background Exec
  - Branch: `fix-terminal-double-quotes`
  - PR: https://github.com/cline/cline/pull/7483
  - Status: ✅ Submitted, awaiting review

- [x] **Issue #7468** - Ollama API not cancelled
  - Branch: `fix-ollama-cancellation`
  - PR: https://github.com/cline/cline/pull/7484
  - Status: ✅ Submitted, awaiting review

---

## 🔄 Next Up (1/5)

- [ ] **Issue #7474** - MCP server names show as GitHub URLs in Staging
  - **URL**: https://github.com/cline/cline/issues/7474
  - **Difficulty**: ⭐⭐ MEDIUM
  - **Estimate**: 30-45 minutes
  - **Branch**: `fix-mcp-server-names` (create)

  **Problem**: When switching to Staging, MCP server names display as repo URLs

  **Files to Check**:
  - MCP configuration UI
  - Server state management
  - Display name logic

  **Expected Fix**: Use `server.name` instead of `server.url` for display

---

## ⏭️ Remaining (2/5)

- [ ] **Issue #7469** - Tool name exceeds 64-char limit
  - **URL**: https://github.com/cline/cline/issues/7469
  - **Difficulty**: ⭐⭐ MEDIUM
  - **Estimate**: 20-30 minutes
  - **Branch**: `fix-tool-name-length` (create)

  **Problem**: `tools[30].name` is 68 chars, OpenAI limit is 64

  **Files to Check**:
  - Tool definitions
  - Tool name generation

  **Expected Fix**: Truncate or rename tool to ≤64 chars

---

- [ ] **Issue #7476** - Windows ARM64 not supported (JetBrains)
  - **URL**: https://github.com/cline/cline/issues/7476
  - **Difficulty**: ⭐⭐⭐ HARD
  - **Estimate**: 1-2 hours
  - **Branch**: `fix-windows-arm64` (create)

  **Problem**: Plugin crashes on Windows ARM64 devices (Surface Laptop)

  **Error**:
  ```
  Caused by: java.lang.IllegalStateException: Unsupported platform: windows 11 aarch64
  at bot.cline.intellij.ClineDirs.PLATFORM_NAME_delegate
  ```

  **Files to Check**:
  - `ClineDirs.kt` (JetBrains plugin)
  - Platform detection logic
  - Build configuration

  **Expected Fix**:
  - Add Windows ARM64 to supported platforms
  - Handle x64 emulation fallback

---

## Quick Commands

### Start Next Issue (#7474)
```bash
cd "c:\Users\bob43\Downloads\Bcline"
git checkout main
git checkout -b fix-mcp-server-names

# Find the code
grep -r "MCP.*server" src/ | grep -i "name\|display"
```

### Check PR Status
```bash
gh pr list --repo cline/cline --author bob10042
gh pr view 7483 --repo cline/cline
gh pr view 7484 --repo cline/cline
```

### Resume Session
```bash
cat RESUME_SESSION.md
```

---

## Session Files

- **RESUME_SESSION.md** - Quick recovery guide
- **ISSUE_FIX_SESSION.md** - Detailed session log
- **CONTRIBUTING_WORKFLOW.md** - Full workflow documentation
- **TODO.md** - This file (task checklist)

---

## Progress

```
╔══════════════════════════════════════╗
║  BCLINE ISSUE FIXES                  ║
║  Progress: 2 / 5 (40%)              ║
╚══════════════════════════════════════╝

[████████░░░░░░░░░░░░] 40%

✅ Terminal quotes (PR #7483)
✅ Ollama cancel (PR #7484)
🔄 MCP server names ← NEXT
⏭️ Tool name length
⏭️ Windows ARM64
```

---

**Last Updated**: 2025-11-15
**Status**: Ready to continue with #7474
