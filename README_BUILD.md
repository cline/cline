# 🚀 BCline Build Instructions - START HERE

**Last Updated:** December 3, 2025
**Build Version:** BCline v3.39.2-complete

---

## ⚡ QUICK START (Most Common Case)

You already have a working VSIX! Skip the build if you just want to use BCline:

```bash
# The VSIX is already built and ready:
ls -lh bcline-3.39.2-complete.vsix

# To install:
# 1. Open VSCode
# 2. Extensions panel (Ctrl+Shift+X)
# 3. Click "..." → "Install from VSIX..."
# 4. Select bcline-3.39.2-complete.vsix
```

---

## 📚 BUILD DOCUMENTATION INDEX

### When You Need to Build

| Situation | Document to Use |
|-----------|-----------------|
| **Quick command reference** | → [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md) |
| **Full step-by-step build** | → [CORRECT_BUILD_PROCEDURE.md](./CORRECT_BUILD_PROCEDURE.md) |
| **Understanding errors** | → [BUILD_PROCESS_ANALYSIS.md](./BUILD_PROCESS_ANALYSIS.md) |
| **Version conflicts** | → [VERSION_FIXES_SUMMARY.md](./VERSION_FIXES_SUMMARY.md) |

### When You Have Problems

| Problem | Solution |
|---------|----------|
| "vite: command not found" | [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md#vite-command-not-found) |
| TypeScript errors | [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md#typescript-build-crash) |
| npm install fails | [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md#cannot-find-module-grpc-tools) |
| Build totally broken | [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md#emergency-recovery) |

---

## ⚠️ CRITICAL INFORMATION

### Version Requirements

**Your System:**
- Node.js: v20.11.1 ✅
- npm: v10.2.4 ✅

**Required Package Versions:**
```json
{
  "typescript": "^5.4.5",  // Both root AND webview
  "vite": "^5.4.11"        // Webview only - MUST be 5.x, NOT 7.x
}
```

**❌ DO NOT use Vite 7.x** - it requires Node 20.19+, you have 20.11.1

---

## 🔧 WHEN TO BUILD

### ✅ Build When:
- You changed TypeScript code
- You modified proto files
- You updated dependencies
- You pulled new commits from git

### ❌ Don't Build When:
- You just want to use BCline (VSIX is already built)
- You only changed README/docs
- You're just testing the extension

---

## 🚀 HOW TO BUILD

### Option 1: Automated Build (Recommended)
```bash
cd /c/Users/bob43/Downloads/Bcline
./build-bcline.sh
```

This script handles everything automatically.

### Option 2: Manual Build
If the script doesn't work, follow [CORRECT_BUILD_PROCEDURE.md](./CORRECT_BUILD_PROCEDURE.md)

### Option 3: Quick Rebuild (After small changes)
```bash
node esbuild.mjs --production
npx @vscode/vsce package --no-dependencies
```

---

## 🎯 WHAT'S IN THE VSIX

**BCline v3.39.2-complete** includes:

✅ **All 6 Critical Bug Fixes**
- Security: secrets.json permissions
- File paths with spaces support
- Terminal environment variables
- Mermaid text clipping
- CLI yolo mode auto-approve
- AWS Bedrock empty tool description

✅ **All Custom Features**
- Message queue system (PowerShell ↔ Cline)
- Grok model support
- Export metrics button
- Enhanced context management

✅ **Full Upstream Cline v3.39.2**
- All official v3.39.2 features
- All performance improvements
- All upstream bug fixes

**Total:** 11 bugs fixed, 8 new features, full upstream compatibility

See [COMPLETE_CHANGES_LIST.md](./COMPLETE_CHANGES_LIST.md) for full details.

---

## 📦 BUILD OUTPUT

After successful build:
```
✅ bcline-3.39.2-complete.vsix    (~32MB, 3700+ files)
✅ dist/extension.js               (~18MB)
✅ webview-ui/dist/                (webview bundle)
```

---

## 🆘 EMERGENCY HELP

### Build is Completely Broken?

```bash
cd /c/Users/bob43/Downloads/Bcline

# 1. Reset to clean state
git stash
git reset --hard

# 2. Verify package.json versions
cat webview-ui/package.json | grep '"vite":'
# MUST show: "vite": "^5.4.11"

cat webview-ui/package.json | grep '"typescript":'
# MUST show: "typescript": "^5.4.5"

# 3. Clean everything
rm -rf node_modules webview-ui/node_modules dist webview-ui/dist

# 4. Use existing VSIX
# You already have bcline-3.39.2-complete.vsix!
# Just install it in VSCode
```

### Still Stuck?

1. Read [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md) - Section: "Emergency Recovery"
2. Read [BUILD_PROCESS_ANALYSIS.md](./BUILD_PROCESS_ANALYSIS.md) - Section: "Common Errors"
3. Check [CORRECT_BUILD_PROCEDURE.md](./CORRECT_BUILD_PROCEDURE.md) - Section: "Troubleshooting"

---

## 🎓 UNDERSTANDING THE BUILD

### Why Vite 5.x?
- Vite 7.x requires Node 20.19+
- You have Node 20.11.1
- Vite 5.4.11 is the highest compatible version

See [BUILD_PROCESS_ANALYSIS.md](./BUILD_PROCESS_ANALYSIS.md) for full analysis.

### Why TypeScript Config Changes?
- `tsc -b` (build mode) was causing crashes
- Changed to `tsc --noEmit` for type checking
- Added `incremental: true` instead of `composite: true`

See [VERSION_FIXES_SUMMARY.md](./VERSION_FIXES_SUMMARY.md) for details.

---

## 📁 DOCUMENTATION MAP

```
BCline/
├── README_BUILD.md                      ⭐ YOU ARE HERE - START HERE
├── BUILD_QUICK_REFERENCE.md             🔧 Quick commands & solutions
├── CORRECT_BUILD_PROCEDURE.md           📖 Full step-by-step procedure
├── BUILD_PROCESS_ANALYSIS.md            🔍 Error analysis & versions
├── VERSION_FIXES_SUMMARY.md             📊 What was fixed & why
├── COMPLETE_CHANGES_LIST.md             📝 All features & bug fixes
├── build-bcline.sh                      🤖 Automated build script
└── bcline-3.39.2-complete.vsix         ✅ Ready-to-install extension
```

---

## ✅ VERIFICATION CHECKLIST

After build (or to verify existing VSIX):

```bash
# Check VSIX exists and correct size
ls -lh bcline-3.39.2-complete.vsix
# Should be ~32MB

# Check file count
unzip -l bcline-3.39.2-complete.vsix | wc -l
# Should be ~3700 files

# Verify integrity
unzip -t bcline-3.39.2-complete.vsix | grep -i error
# Should return nothing

# All good? Install it!
```

---

## 🎉 SUCCESS PATH

1. **Have VSIX?** → Install and use BCline (you're done!)
2. **Need to build?** → Use `./build-bcline.sh` (automated)
3. **Build failed?** → Check [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md)
4. **Still issues?** → Follow [CORRECT_BUILD_PROCEDURE.md](./CORRECT_BUILD_PROCEDURE.md)

---

## 💡 PRO TIPS

1. **Use the existing VSIX** - it's already built and tested
2. **Only rebuild when code changes** - saves time
3. **Check versions first** - prevents 90% of issues
4. **Use automated script** - consistent builds
5. **Read error messages** - usually tells you what's wrong

---

## 📞 NEED MORE HELP?

| Question | Answer |
|----------|--------|
| What versions do I need? | See "Version Requirements" above |
| How do I build? | Run `./build-bcline.sh` |
| Build failed? | [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md) |
| What changed? | [VERSION_FIXES_SUMMARY.md](./VERSION_FIXES_SUMMARY.md) |
| Full procedure? | [CORRECT_BUILD_PROCEDURE.md](./CORRECT_BUILD_PROCEDURE.md) |

---

## 🏆 BOTTOM LINE

**You have a working VSIX:** `bcline-3.39.2-complete.vsix` (32MB)

**To use it:** Install in VSCode via Extensions panel

**To rebuild:** Run `./build-bcline.sh`

**If stuck:** Read [BUILD_QUICK_REFERENCE.md](./BUILD_QUICK_REFERENCE.md)

---

**That's it! This is your master build reference. Bookmark this file.**

---

**Last Updated:** December 3, 2025
**Build Status:** ✅ COMPLETE
**VSIX Status:** ✅ READY TO INSTALL
