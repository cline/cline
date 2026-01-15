# BCline Build

Automated build process for BCline - merges upstream Cline updates, preserves BCline customizations (messaging system, voice implementation, bug fixes), and creates production VSIX package.

## Overview

This workflow automates the complete BCline build pipeline:
1. Fetch latest upstream Cline changes
2. Merge upstream with BCline (preserving customizations)
3. Resolve conflicts intelligently
4. Install/update dependencies
5. Generate protobuf types
6. Build webview and extension
7. Package VSIX
8. Report build status and installation instructions

## Prerequisites Check

First, verify the build environment:

```bash
echo "=== BCline Build Environment Check ==="
echo "Node.js:  $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "npm:      $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Git:      $(git --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "vsce:     $(vsce --version 2>/dev/null || echo 'NOT INSTALLED - run: npm install -g @vscode/vsce')"
echo ""
echo "Required: Node.js v20.11.1+, npm v10.2.4+, Git v2.40+, vsce v3.6.0+"
```

If vsce is missing, install it:

```bash
npm install -g @vscode/vsce
```

## Step 1: Prepare Repository

Check current git status and stash any uncommitted changes:

```bash
git status
```

If there are uncommitted changes, ask user if they want to:
- Stash them (`git stash`)
- Commit them first
- Abort the build

Ensure we're on the correct branch:

```bash
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"
```

**Ask user**: "You're on branch `$CURRENT_BRANCH`. Do you want to:
1. Continue on this branch
2. Switch to main branch
3. Switch to a different branch"

## Step 2: Fetch Upstream Changes

```bash
echo "=== Fetching upstream Cline changes ==="
git fetch upstream
```

Check what's new in upstream:

```bash
echo "Latest upstream commits:"
git log upstream/main --oneline -10
```

Show user what will be merged:

```bash
echo "Commits to be merged:"
git log HEAD..upstream/main --oneline
```

**Ask user**: "Ready to merge these upstream changes? This will update BCline with the latest Cline features."

## Step 3: Merge Upstream

Attempt to merge upstream main:

```bash
echo "=== Merging upstream/main into BCline ==="
git merge upstream/main -m "Merge upstream Cline with BCline customizations" || MERGE_FAILED=true
```

### If Merge Succeeds

Continue to Step 4.

### If Merge Has Conflicts

Check for conflicts:

```bash
git status | grep "both modified"
```

Common BCline conflict files:
- `src/core/api/providers/cline.ts` - BCline provider customizations
- `src/core/controller/index.ts` - BCline controller modifications
- `package.json` - Version numbers, BCline-specific dependencies
- `src/extension.ts` - BCline initialization, messaging system

**For each conflict file**, read the file and analyze the conflict markers:

```bash
cat <conflicted-file>
```

**Conflict Resolution Strategy**:

1. **package.json conflicts**:
   - Keep BCline name: `"name": "bcline"`
   - Keep BCline publisher
   - Use upstream version number (we'll update BCline version later)
   - Merge dependencies (keep both BCline and upstream deps)

2. **src/core/api/providers/cline.ts**:
   - Preserve BCline API customizations
   - Accept upstream feature additions
   - If both modified same function, manually merge logic

3. **src/core/controller/index.ts**:
   - Preserve BCline messaging system hooks
   - Accept upstream controller improvements
   - Ensure BCline voice implementation calls are preserved

4. **src/extension.ts**:
   - Preserve BCline initialization code
   - Preserve messaging system registration
   - Accept upstream extension lifecycle improvements

5. **Other files**:
   - If BCline has custom code, preserve it
   - If upstream has new features, accept them
   - If both modified, merge carefully

**For automated resolution**, use this approach:

```bash
# For files where we want to keep BCline version entirely
git checkout --ours <file>
git add <file>

# For files where we want upstream version entirely
git checkout --theirs <file>
git add <file>

# For manual merge (when both have important changes)
# Edit the file to resolve conflicts, then:
git add <file>
```

After resolving all conflicts:

```bash
git status
git commit -m "Resolve merge conflicts - preserved BCline customizations (messaging, voice, fixes)"
```

## Step 4: Verify BCline Customizations Preserved

Critical BCline files that must exist after merge:

```bash
echo "=== Verifying BCline customizations ==="

# Check messaging system
test -f "scripts/Invoke-BclineMessaging.ps1" && echo "✓ Messaging system preserved" || echo "✗ MISSING: Invoke-BclineMessaging.ps1"

# Check BUILD.md
test -f "BUILD.md" && echo "✓ BUILD.md present" || echo "✗ MISSING: BUILD.md"

# Check CLAUDE.md customizations
grep -q "BCline" CLAUDE.md && echo "✓ CLAUDE.md has BCline docs" || echo "⚠ CLAUDE.md may need BCline section"

# Verify package.json name
grep -q '"name": "bcline"' package.json && echo "✓ Package name is bcline" || echo "✗ ERROR: Package name is not bcline!"
```

If any critical files are missing, **STOP** and alert the user.

## Step 5: Install Dependencies

```bash
echo "=== Installing dependencies ==="
npm run install:all
```

If this fails, try:

```bash
# Clean install
rm -rf node_modules webview-ui/node_modules
npm install
cd webview-ui && npm install && cd ..
```

## Step 6: Generate Protobuf Types

BCline uses gRPC for extension-webview communication:

```bash
echo "=== Generating protobuf types ==="
npm run protos
```

Verify protos generated:

```bash
test -d "src/generated/grpc-js" && echo "✓ Protobuf types generated" || echo "✗ Protobuf generation failed"
```

## Step 7: Build Extension

Run production build:

```bash
echo "=== Building BCline for production ==="
npm run package
```

This runs:
1. Type checking
2. Linting
3. Webview build (React app)
4. esbuild production bundle

### If Build Fails

**Type errors:**
```bash
npm run check-types
```

Show errors to user and ask if they want to:
- Continue anyway (some type errors may be warnings)
- Abort to fix manually

**Lint errors:**
```bash
npm run fix:all
```

**Webview build errors:**
```bash
cd webview-ui
npm run build
cd ..
```

## Step 8: Package VSIX

Create the VSIX installer:

```bash
echo "=== Creating VSIX package ==="
vsce package --allow-package-secrets sendgrid
```

### If VSIX Packaging Fails

Check for missing files:

```bash
ls -la dist/
ls -la webview-ui/build/
```

Try with verbose output:

```bash
vsce package --allow-package-secrets sendgrid --verbose
```

Common fixes:
- Ensure `dist/extension.js` exists
- Ensure `webview-ui/build/` exists and has files
- Check `.vscodeignore` isn't excluding required files

## Step 9: Verify VSIX Created

```bash
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)

if [ -n "$VSIX_FILE" ]; then
    echo "================================================"
    echo "✓ BUILD SUCCESS!"
    echo "================================================"
    echo "VSIX created: $VSIX_FILE"
    echo "Size: $(ls -lh $VSIX_FILE | awk '{print $5}')"

    # Extract version
    VERSION=$(echo $VSIX_FILE | grep -oP '\d+\.\d+\.\d+')
    echo "Version: $VERSION"

    echo ""
    echo "To install BCline:"
    echo "  code --install-extension $VSIX_FILE"
    echo ""
    echo "Or via VS Code UI:"
    echo "  1. Ctrl+Shift+P → 'Extensions: Install from VSIX...'"
    echo "  2. Select: $VSIX_FILE"
    echo "================================================"
else
    echo "✗ BUILD FAILED: No VSIX file created"
    exit 1
fi
```

## Step 10: Commit Build

**Ask user** if they want to commit the changes:

```bash
git status
```

If yes:

```bash
# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

git add .
git commit -m "BCline v$VERSION - Merged upstream Cline with BCline customizations

- Merged latest upstream Cline features
- Preserved BCline messaging system
- Preserved BCline voice implementation
- Preserved BCline bug fixes
- Built and tested VSIX package"

# Ask user if they want to push
git push origin $(git branch --show-current)
```

## Step 11: Final Summary

Present complete summary to user:

```
╔══════════════════════════════════════════════════════════╗
║              BCline Build Complete                        ║
╚══════════════════════════════════════════════════════════╝

VSIX Package: <filename>
Version: <version>
Size: <size>

✓ Upstream Cline merged
✓ BCline customizations preserved:
  • Messaging system (Invoke-BclineMessaging.ps1)
  • Voice implementation
  • Bug fixes
✓ Dependencies installed
✓ Protobuf types generated
✓ Production build successful
✓ VSIX packaged

Installation:
  code --install-extension <filename>

Git Status:
  Branch: <branch>
  Committed: <yes/no>
  Pushed: <yes/no>

Next Steps:
  1. Install the VSIX in VS Code
  2. Test BCline features (messaging, voice, fixes)
  3. Create release tag if ready: git tag -a v<version> -m "BCline v<version>"
```

## Troubleshooting

If the build fails at any step:

1. **Check build.log**: `tail -100 build.log`
2. **Clean rebuild**:
   ```bash
   npm run clean:all
   npm run install:all
   npm run protos
   npm run package
   vsce package --allow-package-secrets sendgrid
   ```
3. **Check Node.js version**: Must be v20.11.1+
4. **Check for missing global packages**: `npm list -g --depth=0`

## Quick Rebuild (No Merge)

If you just want to rebuild without merging upstream:

```bash
npm run package
vsce package --allow-package-secrets sendgrid
```

## Emergency: Abort Build

If something goes wrong:

```bash
# Abort merge
git merge --abort

# Restore from stash
git stash pop

# Reset to origin
git reset --hard origin/$(git branch --show-current)
```
