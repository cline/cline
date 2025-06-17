# 🎯 Install Cline v3.17.13 with Critical Fixes

This version contains important fixes for two critical issues that affect many users.

## ✅ What's Fixed

### 1. Issue #4257 - Rules Not Being Applied
- **Problem**: `.clinerules` files were not being read or applied
- **Solution**: Fixed the rule loading mechanism
- **Impact**: Your custom rules will now work properly

### 2. TypeScript Strict Mode Errors
- **Problem**: 57 TypeScript compilation errors in strict mode
- **Solution**: Implemented proper error handling patterns
- **Impact**: Clean compilation, better code quality

## 📦 Installation Instructions

### Method 1: Download from GitHub Release
1. Go to: https://github.com/a-ai-dev/aai/releases
2. Download `claude-dev-3.17.13.vsix`
3. In VSCode: `Extensions > ... > Install from VSIX...`
4. Select the downloaded file
5. Restart VSCode

### Method 2: Direct File Installation
If you have the VSIX file locally:
1. Open VSCode
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "Extensions: Install from VSIX..."
4. Select the `claude-dev-3.17.13.vsix` file
5. Restart VSCode

## 🧪 Testing the Fixes

### Test 1: Rules System
1. Create a `.clinerules` folder in your project
2. Add a rule file (e.g., `test-rule.md`)
3. Start a new Cline task
4. The rules should now be applied correctly

### Test 2: TypeScript Compilation
1. Run `npm run check-types` in the extension directory
2. Should complete with no errors

## 🔗 Related Links

- **Pull Request**: https://github.com/cline/cline/pull/4265
- **Original Issue**: https://github.com/cline/cline/issues/4257
- **Source Repository**: https://github.com/a-ai-dev/aai

## ⚠️ Important Notes

- This is a community-provided fix while waiting for official release
- All existing functionality is preserved
- You can safely switch back to the official version when it's updated
- Report any issues in the GitHub repository

## 🚀 Why Use This Version?

- **Immediate Fix**: Don't wait for the official release
- **Tested**: Both fixes have been verified to work
- **Safe**: No breaking changes, fully backward compatible
- **Community Benefit**: Help test the fixes before they go official

---

**Made with ❤️ by the Cline community**
