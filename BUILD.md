# BCline Build Guide

This document provides complete instructions for merging BCline with upstream Cline, applying customizations, and building a production VSIX. **Designed for use with Claude Code** - just point Claude at this file.

## Quick Start (Claude Code)

Tell Claude Code:
```
Read BUILD.md and execute the full build process to create a new BCline VSIX
```

Or for specific steps:
```
Read BUILD.md and merge latest upstream Cline into BCline
```

---

## Prerequisites

### Required Tool Versions

These are the **tested and verified versions** used for BCline builds:

| Tool | Required Version | Check Command | Install |
|------|-----------------|---------------|---------|
| **Node.js** | v20.11.1+ | `node --version` | [nodejs.org](https://nodejs.org/) |
| **npm** | v10.2.4+ | `npm --version` | Comes with Node.js |
| **Git** | v2.40+ | `git --version` | [git-scm.com](https://git-scm.com/) |
| **VS Code** | v1.93.0+ | `code --version` | [code.visualstudio.com](https://code.visualstudio.com/) |
| **vsce** | v3.7.0 | `vsce --version` | `npm install -g @vscode/vsce` |
| **Python** | v3.10+ (optional) | `python --version` | For node-gyp native modules |

### Key npm Package Versions (auto-installed)

These are installed via `npm install` - listed for reference:

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.4.5 | TypeScript compiler |
| `@biomejs/biome` | ^2.1.4 | Linting and formatting |
| `esbuild` | ^0.25.12 | JavaScript bundler |
| `@vscode/vsce` | ^3.6.0 | VS Code extension packaging |
| `@grpc/grpc-js` | ^1.9.15 | gRPC communication |
| `nice-grpc` | ^2.1.12 | gRPC client utilities |
| `@playwright/test` | ^1.55.1 | E2E testing |
| `ts-node` | ^10.9.2 | TypeScript execution |
| `rimraf` | ^6.0.1 | Cross-platform rm -rf |
| `cross-env` | ^10.1.0 | Cross-platform env vars |
| `npm-run-all` | ^4.1.5 | Run multiple npm scripts |

### VS Code Engine Requirement

The extension requires VS Code `^1.93.0` or higher (defined in `package.json` engines).

### Verify Your Environment

Run this script to check all prerequisites:

```bash
echo "=== BCline Build Environment Check ==="
echo ""
echo "Node.js:  $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm:      $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Git:      $(git --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "VS Code:  $(code --version 2>/dev/null | head -1 || echo 'NOT INSTALLED or not in PATH')"
echo "vsce:     $(vsce --version 2>/dev/null || echo 'NOT INSTALLED - run: npm install -g @vscode/vsce')"
echo "Python:   $(python --version 2>/dev/null || python3 --version 2>/dev/null || echo 'NOT INSTALLED (optional)')"
echo ""
echo "=== Minimum Required Versions ==="
echo "Node.js:  v20.11.1+"
echo "npm:      v10.2.4+"
echo "Git:      v2.40+"
echo "VS Code:  v1.93.0+"
echo "vsce:     v3.6.0+"
```

### Windows-Specific Requirements

- **Git Bash** or **WSL2** recommended for running bash scripts
- **Windows Build Tools** may be needed for native modules:
  ```powershell
  npm install -g windows-build-tools
  ```
- PowerShell 5.1+ for BCline messaging scripts

### First-Time Setup

```bash
# Clone the BCline repository
git clone https://github.com/bob10042/Bcline.git
cd Bcline

# Add upstream remote (if not already configured)
git remote add upstream https://github.com/cline/cline.git

# Install all dependencies
npm run install:all
```

---

## Build Process Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BCline Build Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│  1. Fetch upstream Cline changes                            │
│  2. Merge upstream into BCline branch                       │
│  3. Resolve any merge conflicts                             │
│  4. Install/update dependencies                             │
│  5. Generate protobuf types                                 │
│  6. Build webview UI                                        │
│  7. Compile TypeScript                                      │
│  8. Package VSIX                                            │
│  9. Test installation                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Step 1: Fetch Upstream Changes

```bash
# Fetch latest from upstream Cline
git fetch upstream

# Check what version upstream is at
git log upstream/main --oneline -5
```

## Step 2: Merge Upstream into BCline

```bash
# Ensure you're on your BCline branch
git checkout main
# Or your feature branch:
# git checkout bcline-3.41.0-complete

# Merge upstream main
git merge upstream/main -m "Merge upstream Cline vX.XX.X with BCline customizations"
```

### Handling Merge Conflicts

Common conflict areas in BCline:
- `package.json` - Version numbers, BCline-specific dependencies
- `src/extension.ts` - BCline initialization code
- `webview-ui/` - UI customizations
- `.changeset/` - Version tracking files

**Resolution strategy:**
1. Keep BCline customizations where they exist
2. Accept upstream changes for new features
3. Manually merge where both sides have changes

```bash
# After resolving conflicts
git add .
git commit -m "Resolve merge conflicts from upstream vX.XX.X"
```

## Step 3: Install Dependencies

```bash
# Clean install all dependencies
npm run clean:deps
npm run install:all

# Or just update
npm install
cd webview-ui && npm install && cd ..
```

## Step 4: Generate Protobuf Types

BCline uses gRPC/protobuf for extension-webview communication:

```bash
npm run protos
```

This generates types in:
- `src/shared/proto/`
- `src/generated/grpc-js/`
- `src/generated/nice-grpc/`
- `src/generated/hosts/`

## Step 5: Build the Extension

### Development Build
```bash
npm run compile
```

### Production Build (for VSIX)
```bash
npm run package
```

This runs:
1. Type checking (without webview)
2. Linting
3. Webview build
4. esbuild production bundle

## Step 6: Create VSIX Package

```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package the extension
vsce package --allow-package-secrets sendgrid

# Output: bcline-X.X.X.vsix in the root directory
```

### Custom VSIX Name
```bash
vsce package --allow-package-secrets sendgrid --out bcline-custom-build.vsix
```

## Step 7: Install and Test

```bash
# Install the VSIX in VS Code
code --install-extension bcline-X.X.X.vsix

# Or via VS Code UI:
# 1. Open VS Code
# 2. Ctrl+Shift+P → "Extensions: Install from VSIX..."
# 3. Select the .vsix file
```

---

## Full Automated Build Script

For Claude Code to execute the complete process:

```bash
#!/bin/bash
# BCline Full Build Script

set -e  # Exit on error

echo "=== BCline Build Process ==="

# Step 1: Fetch upstream
echo "[1/7] Fetching upstream..."
git fetch upstream

# Step 2: Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

# Step 3: Merge upstream (may require manual conflict resolution)
echo "[2/7] Merging upstream/main..."
git merge upstream/main -m "Merge upstream Cline with BCline customizations" || {
    echo "⚠️  Merge conflicts detected. Resolve manually and run build again."
    exit 1
}

# Step 4: Install dependencies
echo "[3/7] Installing dependencies..."
npm run install:all

# Step 5: Generate protos
echo "[4/7] Generating protobuf types..."
npm run protos

# Step 6: Production build
echo "[5/7] Building for production..."
npm run package

# Step 7: Create VSIX
echo "[6/7] Packaging VSIX..."
vsce package --allow-package-secrets sendgrid

# Step 8: Report
echo "[7/7] Build complete!"
VSIX_FILE=$(ls -t *.vsix | head -1)
echo "================================================"
echo "VSIX created: $VSIX_FILE"
echo "Size: $(ls -lh $VSIX_FILE | awk '{print $5}')"
echo "================================================"
echo ""
echo "To install:"
echo "  code --install-extension $VSIX_FILE"
```

---

## BCline-Specific Customizations

When merging, preserve these BCline customizations:

### Core Files
| File | BCline Customization |
|------|---------------------|
| `package.json` | Name: "bcline", publisher, version |
| `src/extension.ts` | BCline initialization, messaging system |
| `CLAUDE.md` | BCline-specific documentation |
| `scripts/Invoke-BclineMessaging.ps1` | CLI messaging system |
| `.message-queue/` | Inter-CLI communication |

### Messaging System Files (Do Not Overwrite)
- `scripts/Invoke-BclineMessaging.ps1`
- `scripts/Send-ClineMessage.ps1`
- `scripts/BCLINE_MESSAGING_CONTEXT.md`
- `CLI_MESSAGING.md`

### UI Customizations
- Any BCline branding in `webview-ui/`
- Custom icons or themes

---

## Troubleshooting

### Build Fails: Type Errors
```bash
# Regenerate protos and retry
npm run protos
npm run check-types
```

### Build Fails: Lint Errors
```bash
# Auto-fix lint issues
npm run fix:all
```

### Webview Build Fails
```bash
cd webview-ui
npm install
npm run build
cd ..
```

### VSIX Package Fails
```bash
# Check for missing files in .vscodeignore
# Ensure all required files are built
ls -la dist/
ls -la webview-ui/build/
```

### Clean Rebuild
```bash
npm run clean:all
npm run install:all
npm run package
vsce package --allow-package-secrets sendgrid
```

---

## Version Management

### Update Version
```bash
# Create a changeset for version bump
npm run changeset

# Apply version changes
npm run version-packages
```

### Check Current Version
```bash
node -p "require('./package.json').version"
```

---

## Git Workflow

### Before Starting
```bash
git status
git stash  # if needed
```

### After Successful Build
```bash
git add .
git commit -m "BCline vX.X.X - Merged upstream Cline vY.Y.Y"
git push origin main
```

### Create Release Tag
```bash
git tag -a vX.X.X -m "BCline vX.X.X release"
git push origin vX.X.X
```

---

## Claude Code Instructions

When Claude Code reads this file, execute these commands in order:

### For Full Build:
1. `git fetch upstream`
2. `git merge upstream/main -m "Merge upstream Cline with BCline"`
3. `npm run install:all`
4. `npm run protos`
5. `npm run package`
6. `vsce package --allow-package-secrets sendgrid`

### For Quick Rebuild (no merge):
1. `npm run package`
2. `vsce package --allow-package-secrets sendgrid`

### For Testing Only:
1. `npm run compile`
2. Press F5 in VS Code to launch Extension Development Host

---

## Repository Information

- **BCline Fork**: https://github.com/bob10042/Bcline
- **Upstream Cline**: https://github.com/cline/cline
- **Main Branch**: `main`
- **Current Dev Branch**: `bcline-3.41.0-complete`

---

## Contact

For issues with this build process, check:
1. GitHub Issues: https://github.com/bob10042/Bcline/issues
2. Upstream Cline docs: https://github.com/cline/cline/wiki
