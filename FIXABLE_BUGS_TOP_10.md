# Top 10+ Fixable Operational Bugs from Cline Main Repository

**Date:** December 2, 2025
**Source:** [Cline GitHub Issues](https://github.com/cline/cline/issues)
**Priority:** Operational bugs that can be fixed in code

---

## 🔥 HIGH PRIORITY - Security & Critical Issues

### 1. 🔐 Security: secrets.json File is World Readable (#7778)

**Severity:** CRITICAL - Security Vulnerability
**Issue:** [#7778](https://github.com/cline/cline/issues/7778)

**Problem:**
- `secrets.json` file created with permissions `-rw-rw-r--` (0644)
- API keys and tokens readable by all users on the system
- Critical security exposure on multi-user systems

**Current:**
```bash
-rw-rw-r-- (0644)  # Anyone can read
```

**Should Be:**
```bash
-rw------- (0600)  # Only owner can read/write
```

**Fix:**
```typescript
// When creating secrets.json
fs.writeFileSync(secretsPath, content, {
  encoding: 'utf8',
  mode: 0o600  // Restrictive permissions
});
```

**Files to Change:**
- `src/services/` - Wherever secrets.json is written
- CLI initialization code

**Difficulty:** ⭐ Easy (one-line fix)

---

### 2. 📁 Add to Cline Doesn't Quote File Paths with Spaces (#7789)

**Severity:** HIGH - Breaks functionality
**Issue:** [#7789](https://github.com/cline/cline/issues/7789)

**Problem:**
- Right-click "Add to Cline" on files with spaces in path
- Inserted as: `c:\Folder Name\file.txt`
- Should be: `"c:\Folder Name\file.txt"`
- LLM only reads `c:\Folder` → file not found

**Expected vs Actual:**
```typescript
// WRONG (current)
const path = "c:\\Folder Name\\file.txt"

// RIGHT (should be)
const path = "\"c:\\Folder Name\\file.txt\""
```

**Fix:**
```typescript
function addFileToContext(filePath: string): string {
  // Check if path contains spaces
  if (filePath.includes(' ')) {
    return `"${filePath}"`
  }
  return filePath
}
```

**Files to Change:**
- Context menu handler for "Add to Cline"
- `src/core/` - File path insertion logic

**Difficulty:** ⭐ Easy

---

### 3. 🖥️ VSCode Terminal Profile Environment Variables Not Respected (#7793)

**Severity:** MEDIUM - Feature not working
**Issue:** [#7793](https://github.com/cline/cline/issues/7793)

**Problem:**
- User configures custom terminal profile with env vars (e.g., `GIT_PAGER`)
- Cline reads shell path but ignores `env` properties
- Environment variables don't carry over to Cline terminals

**What's Missing:**
```typescript
// VSCode terminal profile config
{
  "terminal.integrated.profiles.windows": {
    "PowerShell for AI": {
      "path": "pwsh.exe",
      "env": {                    // ← This is ignored!
        "GIT_PAGER": "cat"
      }
    }
  }
}
```

**Fix:**
```typescript
// When creating terminal, also apply env vars
function createTerminal(profile: TerminalProfile) {
  const terminal = vscode.window.createTerminal({
    name: profile.name,
    shellPath: profile.path,
    env: profile.env || {}  // ← Add this!
  })
  return terminal
}
```

**Files to Change:**
- `src/integrations/terminal/` - Terminal creation logic
- Profile reading code

**Difficulty:** ⭐⭐ Medium

---

## 🐛 MEDIUM PRIORITY - Functional Bugs

### 4. 🔄 Auto Compact Fails on Certain Local Models (llama-server) (#7772)

**Severity:** MEDIUM - Feature broken for specific models
**Issue:** [#7772](https://github.com/cline/cline/issues/7772)

**Problem:**
- Auto compact doesn't trigger on GPT OSS 120B, GLM 4.5 Air
- Works fine on Qwen3 Next
- Conversation exceeds context window
- Manual compact then fails with "too many tokens"

**Models Affected:**
- ❌ GPT OSS 120B (131k context)
- ❌ GLM 4.5 Air (131k context)
- ✅ Qwen3 Next (262k context)

**Root Cause:**
Likely context window detection issue for OpenAI-compatible endpoints

**Fix:**
```typescript
// Ensure context window is read from settings
function shouldTriggerAutoCompact(currentTokens: number, model: string): boolean {
  const contextWindow = getContextWindowForModel(model)
  const threshold = contextWindow * 0.8  // Trigger at 80%

  if (currentTokens >= threshold) {
    console.log(`Auto-compact triggered: ${currentTokens}/${contextWindow}`)
    return true
  }
  return false
}
```

**Files to Change:**
- `src/api/providers/openai-compatible.ts` - Token counting
- Auto compact trigger logic

**Difficulty:** ⭐⭐⭐ Medium-Hard

---

### 5. ⏸️ CLI: cline -o Waits for Approval and Doesn't Exit (#7788)

**Severity:** MEDIUM - CLI hangs
**Issue:** [#7788](https://github.com/cline/cline/issues/7788)

**Problem:**
- `cline -o` (offline mode) should never wait for user input
- Hangs at "### Cline has a question"
- Process doesn't exit, requires manual kill

**Expected:**
```bash
cline -o "do task"
# Should auto-approve or skip, then exit
```

**Actual:**
```bash
cline -o "do task"
### Cline has a question
# ← HANGS HERE FOREVER
```

**Fix:**
```typescript
// In offline mode, auto-approve all questions
if (isOfflineMode && requiresApproval) {
  console.log('[Offline Mode] Auto-approving request...')
  return { approved: true, autoMode: true }
}

// Exit when task complete
if (isOfflineMode && taskComplete) {
  process.exit(0)
}
```

**Files to Change:**
- CLI offline mode handling
- Approval request logic

**Difficulty:** ⭐⭐ Medium

---

### 6. 👁️ Model Configuration & Context Window Progress Bar Not Visible (#7814)

**Severity:** MEDIUM - UI regression
**Issue:** [#7814](https://github.com/cline/cline/issues/7814)

**Problem:**
- After upgrade to v1.1.6, UI elements disappeared
- Missing: Model configuration section (context window size, temperature)
- Missing: Context window progress bar
- Worked fine in v1.1.5

**Affected:**
- VSCode extension
- JetBrains extension

**Fix:**
Check for CSS/layout changes or conditional rendering bugs introduced in v1.1.6

```typescript
// Ensure these components render
<ModelConfiguration visible={true} />
<ContextWindowProgressBar visible={true} tokens={currentTokens} max={maxTokens} />
```

**Files to Change:**
- `webview-ui/src/components/` - UI component visibility
- Version 1.1.6 changeset

**Difficulty:** ⭐⭐ Medium

---

### 7. 🔌 CLI Error: Failed to Start Auth Instance (#7811)

**Severity:** MEDIUM - CLI won't start
**Issue:** [#7811](https://github.com/cline/cline/issues/7811)

**Problem:**
```
failed to start auth instance: failed to start instance:
operation failed after 12 attempts: instance not found in registry:
database not available
```

**Root Cause:**
- Database connection issue in Cline Core service
- gRPC service on `localhost:50052` not accessible
- Persists across Node versions 20-24

**Fix:**
```typescript
// Add better error handling and retries
async function startAuthInstance(retries = 3): Promise<AuthInstance> {
  try {
    const instance = await connectToAuthService()
    return instance
  } catch (err) {
    if (retries > 0) {
      console.log(`Retrying auth connection... (${retries} attempts left)`)
      await sleep(1000)
      return startAuthInstance(retries - 1)
    }
    throw new Error(`Failed to start auth: ${err.message}`)
  }
}
```

**Files to Change:**
- CLI auth initialization
- gRPC connection handling

**Difficulty:** ⭐⭐⭐ Medium-Hard

---

## 📊 LOWER PRIORITY - UI/UX Issues

### 8. 🧊 Cline Freezes After Running a Command (#4049)

**Severity:** LOW-MEDIUM - Intermittent
**Issue:** [#4049](https://github.com/cline/cline/issues/4049)

**Problem:**
- Command executes successfully
- Cline UI freezes with no continue button
- User stuck, can't proceed

**Likely Causes:**
- Response parsing error
- State not updating after command completion
- Missing "continue" button trigger

**Fix:**
```typescript
// After command execution, always update state
async function executeCommand(cmd: string) {
  const result = await runCommand(cmd)

  // Ensure state update
  setState({
    commandComplete: true,
    showContinueButton: true,
    output: result
  })
}
```

**Files to Change:**
- Command execution handler
- UI state management

**Difficulty:** ⭐⭐ Medium

---

### 9. 🔀 Unparsable API Response (Empty/Malformed XML) (#7201)

**Severity:** LOW-MEDIUM - Provider-specific
**Issue:** [#7201](https://github.com/cline/cline/issues/7201)

**Problem:**
- Model returns empty or malformed tool call responses
- System error: "a tool was not used"
- "provider returned an empty or unparsable response"

**Example Bad Response:**
```xml
<tool_calls>
  <tool_use>
    <!-- Empty or invalid -->
  </tool_use>
</tool_calls>
```

**Fix:**
```typescript
// Add better XML parsing with fallbacks
function parseToolCalls(response: string): ToolCall[] {
  try {
    const parsed = parseXML(response)
    if (!parsed || !parsed.tool_calls) {
      console.warn('Empty tool_calls, retrying...')
      return null  // Trigger retry
    }
    return parsed.tool_calls
  } catch (err) {
    console.error('XML parse error:', err)
    return null  // Trigger retry with clearer prompt
  }
}
```

**Files to Change:**
- API response parser
- Error recovery logic

**Difficulty:** ⭐⭐⭐ Medium-Hard

---

### 10. 🎨 Mermaid Node Text Labels Incomplete or Clipped After Zooming (#7398)

**Severity:** LOW - Visual bug
**Issue:** [#7398](https://github.com/cline/cline/issues/7398)

**Problem:**
- Click Mermaid diagram to enlarge
- Node text labels missing or clipped on right/bottom edges
- Affects readability

**Fix:**
```css
/* Ensure proper overflow and sizing */
.mermaid-node {
  overflow: visible !important;
  white-space: normal;
}

.mermaid-enlarged {
  padding: 20px;  /* Add padding for edge labels */
  max-width: 100%;
}
```

**Files to Change:**
- Mermaid rendering component
- CSS for enlarged view

**Difficulty:** ⭐ Easy

---

## 🆕 BONUS BUGS (11-15)

### 11. 🎯 Can't Open Large Tasks (Above 8MB) (#2079, #3818)

**Problem:** Tasks above 8MB won't open when clicked in history

**Fix:** Implement lazy loading or pagination for large tasks

**Difficulty:** ⭐⭐⭐ Hard

---

### 12. 🗂️ Git Folder Renamed to .git_disabled on Checkpoint (#2868)

**Problem:** Checkpoint system renames `.git` to `.git_disabled`, breaks git

**Fix:** Don't rename .git directory, use different checkpoint mechanism

**Difficulty:** ⭐⭐⭐ Hard

---

### 13. 🔌 CLINE Cannot Load in IntelliJ IDEA 2025.2.4 (#7258)

**Problem:** `Cannot find module 'better-sqlite3'` after update

**Fix:** Bundle better-sqlite3 or add to dependencies

**Difficulty:** ⭐⭐ Medium

---

### 14. 💳 Cannot Buy Additional Credits (#4722)

**Problem:** After buying credits twice, can't purchase more

**Fix:** Check payment API limits, implement proper credit tracking

**Difficulty:** ⭐⭐⭐ Hard (requires backend changes)

---

### 15. 🎨 JetBrains Panel Content Too Large (#6702)

**Problem:** Side panel content oversized in JetBrains IDE

**Fix:** Add responsive sizing for JetBrains UI constraints

**Difficulty:** ⭐⭐ Medium

---

## 🎯 Recommended Fixes for Next PR

### Top 5 Easiest High-Impact Fixes:

1. **#7778** - Security: Fix secrets.json permissions (1 line change)
2. **#7789** - Quote file paths with spaces (simple string check)
3. **#7398** - Fix Mermaid clipping (CSS padding)
4. **#7793** - Pass terminal env vars (add env property)
5. **#7788** - CLI offline mode auto-exit (add exit logic)

**Estimated Time:** 2-4 hours for all 5
**Impact:** High security + critical functionality
**Difficulty:** Easy to Medium

---

## 📚 Sources

- [Cline GitHub Issues](https://github.com/cline/cline/issues)
- [Issue #7778 - secrets.json security](https://github.com/cline/cline/issues/7778)
- [Issue #7789 - File path quoting](https://github.com/cline/cline/issues/7789)
- [Issue #7793 - Terminal env vars](https://github.com/cline/cline/issues/7793)
- [Issue #7772 - Auto compact](https://github.com/cline/cline/issues/7772)
- [Issue #7788 - CLI hanging](https://github.com/cline/cline/issues/7788)
- [Issue #7814 - UI visibility](https://github.com/cline/cline/issues/7814)
- [Issue #7811 - Auth instance](https://github.com/cline/cline/issues/7811)
- [Issue #4049 - Cline freezes](https://github.com/cline/cline/issues/4049)
- [Issue #7201 - Unparsable response](https://github.com/cline/cline/issues/7201)
- [Issue #7398 - Mermaid clipping](https://github.com/cline/cline/issues/7398)

---

**Next Steps:**
1. Review these bugs with the team
2. Pick top 5 easiest fixes
3. Create feature branch
4. Fix, test, commit
5. Submit PR to upstream

**Total Fixable Bugs Found:** 15+
**Recommended for Next PR:** Top 5 (Security + Critical)
