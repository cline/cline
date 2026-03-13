# BCline Build Strategy

## Overview

This document outlines the build strategy for BCline, a customized fork of Cline with additional features while maintaining compatibility with the original extension ecosystem.

## Core Principle

**Maintain original extension identity while including BCline enhancements:**

1. **Extension Identity**: Keep `name: "claude-dev"`, `displayName: "Cline"`, `publisher: "saoudrizwan"`
2. **BCline Features**: Include all BCline modifications (messaging system, Windows voice fix, etc.)
3. **VSIX Naming**: Output VSIX as `claude-dev-{version}.vsix` (original naming)
4. **Installation Behavior**: Replaces/upgrades original Cline extension (same ID)

## Why This Strategy?

1. **Bot Compatibility**: The Claude bot expects extension ID `saoudrizwan.claude-dev`
2. **User Experience**: Users see "Cline" in extensions list (familiar)
3. **Marketplace Rules**: Cannot publish fork as separate extension with same publisher
4. **Seamless Updates**: Users get BCline features when updating Cline

## BCline-Specific Features

### Included in Build:
1. **Messaging System** (`MessageQueueService.ts`)
   - File-based communication with Claude Code
   - CLI integration via PowerShell scripts
   - Pipeline orchestration (claude→codex→gemini)
   - Model switching, usage tracking

2. **Windows Voice Activation Fix**
   - Original: `featureEnabled: process.platform === "darwin" || process.platform === "linux"`
   - BCline Fix: `featureEnabled: true, dictationEnabled: true` (all platforms)

3. **Logger Service Integration**
   - Uses `Logger.log()` instead of `console.log()`
   - Better logging consistency

4. **PowerShell Scripts**
   - `Send-ClineMessage.ps1`
   - `Test-ClineMessaging.ps1`
   - `Test-MessagingIntegration.ps1`

### Build Verification Checklist:
- [ ] VSIX name: `claude-dev-{version}.vsix` (not `bcline-*.vsix`)
- [ ] Package.json: `name: "claude-dev"`, `displayName: "Cline"`
- [ ] Messaging system present in compiled JS
- [ ] Windows voice fix enabled (`featureEnabled: true`)
- [ ] PowerShell scripts included in VSIX

## Build Process

### Recommended Build Command:
```bash
# Clean build
npm run clean:build

# Install dependencies
npm install
cd webview-ui && npm install && cd ..

# Generate protos
npm run protos

# Type check
npm run check-types

# Build webview
npm run build:webview

# Build extension
npm run package

# Result: claude-dev-{version}.vsix
```

### Automated Script (Updated):
Use `build-bcline-modern.sh` which follows this strategy.

## VSIX Analysis Tools

Created verification scripts:
1. `check_vsix_branding.py` - Verify extension identity
2. `check_voice_and_messaging.py` - Check BCline features
3. `extract_and_check_vsix.py` - Detailed VSIX analysis

## Common Issues & Solutions

### Issue: VSIX shows as "BCline" in sidebar
**Cause**: `viewsContainers.activitybar.title` set to "BCline"
**Solution**: Acceptable - visual distinction while maintaining extension ID

### Issue: Windows voice dictation not working
**Cause**: Original restrictive code in compiled JS
**Solution**: Ensure `src/core/controller/index.ts` has Windows fix

### Issue: Messaging system missing
**Cause**: `MessageQueueService.ts` not compiled in
**Solution**: Verify file exists and is imported in build

## Version Management

- **Source Version**: Follow upstream Cline versioning (currently 3.53.1)
- **VSIX Version**: Match source version
- **Changelog**: Document BCline-specific changes in `CHANGELOG-BCLINE.md`

## Testing After Build

1. Install VSIX: `code --install-extension claude-dev-{version}.vsix`
2. Verify extension shows as "Cline" in extensions list
3. Test messaging: `powershell.exe -File .\Test-ClineMessaging.ps1`
4. Verify Windows voice dictation settings

## Maintenance

- Regularly merge upstream Cline changes
- Preserve BCline modifications during merges
- Update build scripts for new versions
- Test all BCline features after each build

---

*Last Updated: $(date)*
*BCline Build Strategy v1.0*