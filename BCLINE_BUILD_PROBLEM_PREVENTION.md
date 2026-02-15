# BCline Build Problem Prevention Guide

## Overview

This document outlines the comprehensive steps and checks needed to prevent build problems in BCline. It consolidates lessons learned from previous build failures and provides a systematic approach to ensure successful builds every time.

## Core Principles

1. **Maintain Original Branding**: VSIX must use `claude-dev` name, `Cline` display name, and `saoudrizwan` publisher for bot compatibility
2. **Include All BCline Features**: Windows voice fix, messaging system, PowerShell scripts must be included
3. **Follow Verified Build Process**: Use the modern build script with verification steps
4. **Verify Before and After**: Check source features before building, verify VSIX after building

## Pre-Build Verification Checklist

### ✅ Before Starting Any Build

- [ ] **Check Node.js version**: Must be v20 or higher
  ```bash
  node --version
  ```

- [ ] **Verify package.json branding**:
  ```bash
  grep '"name"' package.json  # Should be "claude-dev"
  grep '"displayName"' package.json  # Should be "Cline"
  grep '"publisher"' package.json  # Should be "saoudrizwan"
  ```

- [ ] **Check BCline features in source**:
  ```bash
  # Windows voice fix
  grep -n "featureEnabled: true" src/core/controller/index.ts
  grep -n "dictationEnabled: true" src/core/controller/index.ts
  
  # Messaging system
  ls -la src/services/MessageQueueService.ts
  
  # PowerShell scripts
  ls -la *.ps1
  ```

- [ ] **Clean previous builds**:
  ```bash
  rm -f *.vsix
  rm -rf dist webview-ui/dist webview-ui/build
  ```

## Build Process

### ✅ Recommended Build Method

**ALWAYS USE THE MODERN BUILD SCRIPT**:
```bash
./build-bcline-modern.sh
```

The modern build script (`build-bcline-modern.sh`) includes:
1. Prerequisite checks
2. BCline feature verification
3. Clean build process
4. VSIX verification
5. Summary with strategy reminder

### ✅ Manual Build Steps (If Script Fails)

If you must build manually, follow this exact sequence:

1. **Generate Protocol Buffers**:
   ```bash
   npm run protos
   ```

2. **Type Check**:
   ```bash
   npm run check-types
   ```

3. **Lint Code**:
   ```bash
   npm run lint
   ```

4. **Build Webview**:
   ```bash
   npm run build:webview
   ```

5. **Build Extension**:
   ```bash
   npm run package
   ```

6. **Package VSIX**:
   ```bash
   npx @vscode/vsce package --no-dependencies
   ```

## Post-Build Verification

### ✅ VSIX Verification Checklist

After building, verify the VSIX contains:

- [ ] **Correct branding**:
  ```bash
  python check_vsix_branding.py
  ```
  - Name: `claude-dev`
  - Display Name: `Cline`
  - Publisher: `saoudrizwan`

- [ ] **BCline features included**:
  ```bash
  python check_voice_and_messaging.py
  ```
  - Windows voice fix present (`featureEnabled: true`)
  - MessageQueueService in compiled JS
  - PowerShell scripts included

- [ ] **VSIX naming convention**:
  - File name: `claude-dev-{version}.vsix` (NOT `bcline-*.vsix`)
  - Version matches package.json

## Common Build Problems & Solutions

### ❌ Problem: VSIX shows as "BCline" in sidebar but commands don't work
**Cause**: Mixed branding - sidebar title set to "BCline" but extension ID is `claude-dev`
**Solution**: This is intentional for visual distinction. Commands use `bcline.*` prefix which is correct.

### ❌ Problem: Windows voice dictation not working
**Cause**: Original restrictive code (`process.platform === "darwin" || process.platform === "linux"`) in compiled JS
**Solution**: Ensure `src/core/controller/index.ts` has Windows fix:
  ```typescript
  featureEnabled: true,
  dictationEnabled: true,
  ```

### ❌ Problem: Messaging system missing from VSIX
**Cause**: `MessageQueueService.ts` not compiled into extension.js
**Solution**: Verify file exists at `src/services/MessageQueueService.ts` and is imported in build

### ❌ Problem: VSIX installs as separate "BCline" extension
**Cause**: VSIX has `name: "bcline"` in package.json
**Solution**: Always use `name: "claude-dev"` for bot compatibility

### ❌ Problem: Build fails with TypeScript errors
**Cause**: TypeScript version mismatch or missing proto files
**Solution**:
  1. Run `npm run protos` first
  2. Check TypeScript versions match in root and webview-ui
  3. Run `npm run check-types` to identify issues

### ❌ Problem: Webview build fails
**Cause**: Vite or React dependencies issues
**Solution**:
  1. `cd webview-ui && npm install --legacy-peer-deps`
  2. Check Vite version compatibility
  3. Clear cache: `rm -rf webview-ui/node_modules webview-ui/dist`

## Maintenance Procedures

### ✅ Regular Maintenance Checklist

- [ ] **Merge upstream changes**:
  ```bash
  git fetch upstream
  git merge upstream/main
  ```
  - Preserve BCline modifications during merge
  - Resolve conflicts favoring BCline features

- [ ] **Update dependencies**:
  ```bash
  npm update
  cd webview-ui && npm update
  ```

- [ ] **Test all BCline features** after each build:
  1. Windows voice dictation settings
  2. Messaging system: `powershell.exe -File .\Test-ClineMessaging.ps1`
  3. CLI integration: `powershell.exe -File .\Send-ClineMessage.ps1`

### ✅ Version Management

- **Source Version**: Follow upstream Cline versioning
- **VSIX Version**: Match source version in package.json
- **Changelog**: Document BCline-specific changes separately

## Emergency Recovery

### ✅ If Build is Completely Broken

1. **Full clean rebuild**:
   ```bash
   ./rebuild-bcline.sh
   ```

2. **Restore from backup**:
   ```bash
   git stash
   git checkout main
   git pull origin main
   ```

3. **Use last known good VSIX**:
   - Keep a backup of `claude-dev-*.vsix` that works
   - Reinstall: `code --install-extension claude-dev-3.53.1-fixed.vsix`

## Verification Scripts

Use these scripts to verify builds:

1. `check_vsix_branding.py` - Verify extension identity
2. `check_voice_and_messaging.py` - Check BCline features
3. `check_vsix_for_bcline_changes.py` - Compare VSIX with source
4. `extract_and_check_vsix.py` - Detailed VSIX analysis

## Troubleshooting Runtime Issues

### ❌ Messaging System: Gets stuck in "ack/nack" loops
**Symptoms**: Messages bounce back and forth between acknowledgment and negative acknowledgment states
**Possible Causes**:
1. Message processing errors causing retry loops
2. File watcher and polling system conflicts
3. Response files not being cleaned up properly

**Solutions**:
1. Check `.message-queue/` directory for stuck messages
2. Clear all files in `.message-queue/inbox/`, `.message-queue/outbox/`, `.message-queue/responses/`
3. Restart VSCode to reset the MessageQueueService
4. Check PowerShell script timeouts and response handling

### ❌ Voice Dictation: Microphone icon not showing/not displaying transcribed text
**Symptoms**:
- Microphone icon missing or not visible
- Clicking activates listening but no visual feedback
- Speech processed but not displayed in chat

**Possible Causes**:
1. Dictation settings not properly enabled in controller
2. UI component rendering issues
3. Audio transcription service errors

**Solutions**:
1. Verify dictation settings in VSCode settings:
   - Search for "Cline" settings
   - Ensure "Enable dictation" is checked
   - Check "Feature enabled" is true
2. Restart VSCode extension
3. Check browser console for UI errors (F12 in webview)
4. Verify audio permissions in system settings

### ❌ General Debugging Steps
1. **Check extension logs**:
   ```bash
   # Open VSCode Developer Tools (Help → Toggle Developer Tools)
   # Check Console tab for errors
   ```

2. **Reset extension state**:
   ```bash
   # Uninstall and reinstall extension
   code --uninstall-extension saoudrizwan.claude-dev
   code --install-extension claude-dev-*.vsix
   ```

3. **Clear cache**:
   - Delete `.message-queue/` directory
   - Clear VSCode extension storage

## Summary

To prevent build problems:

1. **ALWAYS** use `./build-bcline-modern.sh` for builds
2. **ALWAYS** verify VSIX branding and features after build
3. **ALWAYS** maintain `claude-dev` name for bot compatibility
4. **ALWAYS** test Windows voice fix and messaging system
5. **NEVER** rename VSIX to `bcline-*.vsix`

Following this guide ensures BCline builds work correctly every time, maintaining both original extension compatibility and BCline enhancements.

---
*Last Updated: $(date)*  
*BCline Build Problem Prevention Guide v1.1*
