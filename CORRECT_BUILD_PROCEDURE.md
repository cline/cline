# BCline Correct Build Procedure

**Version:** 1.0
**Date:** December 3, 2025
**System:** Windows with Git Bash / MinGW
**Node Version Required:** 20.11.1+ (20.19+ recommended)

---

## ⚠️ CRITICAL PREREQUISITES

### System Requirements

```bash
✅ Node.js v20.11.1 (minimum) or v20.19+ (recommended)
✅ npm v10.2.4+
✅ Git with Bash (MinGW)
✅ Python 3.12+ (for grpc-tools native modules)
✅ Visual Studio Build Tools (Windows)
✅ 50GB free disk space
```

### Verify Prerequisites

```bash
# Check Node version
node --version
# Should show: v20.11.1 or higher

# Check npm version
npm --version
# Should show: 10.2.4 or higher

# Check Python
python --version
# Should show: Python 3.12.x

# Check Git Bash
bash --version
# Should show: GNU bash version 5.x
```

---

## 📦 CORRECT PACKAGE VERSIONS

### Root package.json
```json
{
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/node": "^20.11.x"
  }
}
```

### webview-ui/package.json
```json
{
  "devDependencies": {
    "typescript": "^5.4.5",  // MUST match root
    "vite": "^5.4.11"        // MUST be 5.x for Node 20.11.1
  }
}
```

**⚠️ CRITICAL:**
- TypeScript versions MUST match between root and webview
- Vite MUST be 5.4.x for Node 20.11.1
- Vite 7.x requires Node 20.19+

---

## 🔧 STEP-BY-STEP BUILD PROCEDURE

### Step 0: Pre-Build Verification

```bash
# Navigate to project
cd /c/Users/bob43/Downloads/Bcline

# Verify you're on the correct branch
git branch --show-current
# Should show: bcline-3.39.2-complete or your working branch

# Verify package.json versions
echo "=== Checking versions ==="
cat package.json | grep '"typescript":'
cat webview-ui/package.json | grep '"typescript":'
cat webview-ui/package.json | grep '"vite":'

# All should show correct versions per table above
```

### Step 1: Complete Clean

```bash
echo "=== Step 1: Cleaning all build artifacts ==="

# Remove all node_modules
rm -rf node_modules
rm -rf webview-ui/node_modules

# Remove all build outputs
rm -rf dist
rm -rf webview-ui/dist
rm -rf webview-ui/build
rm -rf out

# Remove lock files for fresh install
rm -f package-lock.json
rm -f webview-ui/package-lock.json

# Remove generated files
rm -rf src/generated
rm -rf webview-ui/src/services/grpc-client.ts

# Remove any existing VSIX (except backups)
# DO NOT DELETE bcline-*.vsix backups!
rm -f claude-dev-*.vsix

echo "✅ Clean complete"
```

### Step 2: Install Root Dependencies

```bash
echo "=== Step 2: Installing root dependencies ==="

# Install with ignore-scripts to avoid husky circular dependency
npm install --ignore-scripts

# Verify installation
ls node_modules/ | wc -l
# Should show ~400+ packages

echo "✅ Root dependencies installed"
```

### Step 3: Setup grpc-tools Native Binaries

```bash
echo "=== Step 3: Building grpc-tools native binaries ==="

# Navigate to grpc-tools
cd node_modules/grpc-tools

# Install and build native modules
npm install

# Verify grpc_tools_node_protoc_plugin exists
ls bin/ | grep protoc
# Should show: grpc_tools_node_protoc_plugin.exe (Windows)

cd ../..

echo "✅ grpc-tools ready"
```

### Step 4: Run Husky Setup (Optional)

```bash
echo "=== Step 4: Setting up git hooks ==="

# This may fail if husky is not needed, that's OK
npm run prepare || echo "Husky setup skipped (optional)"

echo "✅ Git hooks configured"
```

### Step 5: Install Webview Dependencies

```bash
echo "=== Step 5: Installing webview dependencies ==="

cd webview-ui

# Install with legacy-peer-deps to handle peer dependency conflicts
npm install --legacy-peer-deps

# Verify vite is installed
ls node_modules/vite/bin/
# Should show: vite.js

# Verify installation count
ls node_modules/ | wc -l
# Should show ~600+ packages

cd ..

echo "✅ Webview dependencies installed"
```

### Step 6: Generate Protocol Buffer Files

```bash
echo "=== Step 6: Generating proto files ==="

npm run protos

# Verify generation
ls src/generated/hosts/vscode/ | grep hostbridge
# Should show: hostbridge-grpc-service-config.ts

ls webview-ui/src/services/ | grep grpc-client
# Should show: grpc-client.ts

echo "✅ Proto files generated"
```

### Step 7: Type Check All Code

```bash
echo "=== Step 7: Type checking ==="

# Root type check
npx tsc --noEmit
echo "✅ Root types OK"

# Webview type check
cd webview-ui
npx tsc --noEmit
cd ..
echo "✅ Webview types OK"

echo "✅ All type checks passed"
```

### Step 8: Lint Code

```bash
echo "=== Step 8: Linting code ==="

npm run lint

echo "✅ Linting passed"
```

### Step 9: Build Webview

```bash
echo "=== Step 9: Building webview UI ==="

cd webview-ui
npm run build

# Verify build output
ls dist/
# Should show: assets/, index.html

# Check bundle size
du -sh dist/
# Should show: ~2-5MB

cd ..

echo "✅ Webview built"
```

### Step 10: Build Extension

```bash
echo "=== Step 10: Building extension ==="

node esbuild.mjs --production

# Verify build output
ls dist/
# Should show: extension.js (18-20MB)

# Check size
ls -lh dist/extension.js
# Should show: ~18M

echo "✅ Extension built"
```

### Step 11: Package VSIX

```bash
echo "=== Step 11: Packaging VSIX ==="

npx @vscode/vsce package --no-dependencies

# Verify VSIX created
ls -lh claude-dev-*.vsix
# Should show: ~30-35MB file

# Rename to bcline
mv claude-dev-3.39.2.vsix bcline-3.39.2-complete.vsix

echo "✅ VSIX packaged successfully!"
```

### Step 12: Verification

```bash
echo "=== Step 12: Final verification ==="

# Check VSIX size
ls -lh bcline-3.39.2-complete.vsix
# Should be 30-35MB

# Check file count
unzip -l bcline-3.39.2-complete.vsix | wc -l
# Should be 3000-4000 files

# Extract and verify key files exist
unzip -t bcline-3.39.2-complete.vsix extension/dist/extension.js
unzip -t bcline-3.39.2-complete.vsix extension/webview-ui/build/index.html

echo "✅ Build verification complete!"
```

---

## 🚨 COMMON ERRORS & SOLUTIONS

### Error 1: "vite: command not found"
**Cause:** Vite 7.x tried to install but failed due to Node version

**Solution:**
```bash
cd webview-ui
# Check version in package.json
cat package.json | grep '"vite":'
# Should show: "vite": "^5.4.11"

# If it shows 7.x, edit package.json to fix
# Then reinstall
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Error 2: "Cannot read properties of undefined (reading 'push')"
**Cause:** TypeScript build mode issue

**Solution:**
```bash
# Verify tsconfig files have incremental, NOT composite
cat webview-ui/tsconfig.app.json | grep -E "(composite|incremental)"
# Should show ONLY: "incremental": true

# If composite is present, edit to remove it
```

### Error 3: "husky: command not found"
**Cause:** Circular dependency during npm install

**Solution:**
```bash
# Always use --ignore-scripts on first install
npm install --ignore-scripts

# Then run prepare separately
npm run prepare || true
```

### Error 4: "grpc_tools_node_protoc_plugin not found"
**Cause:** Native binaries not built

**Solution:**
```bash
cd node_modules/grpc-tools
npm install
cd ../..
npm run protos
```

### Error 5: TypeScript version mismatch errors
**Cause:** Root and webview using different TypeScript versions

**Solution:**
```bash
# Check both versions
cat package.json | grep '"typescript":'
cat webview-ui/package.json | grep '"typescript":'

# Should BOTH show: "typescript": "^5.4.5"
# If not, edit webview-ui/package.json to match
```

### Error 6: "error TS5069: Option 'tsBuildInfoFile' cannot be specified"
**Cause:** Missing incremental option

**Solution:**
Add to tsconfig:
```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  }
}
```

---

## 🔍 TROUBLESHOOTING CHECKLIST

If build fails, run through this checklist:

### 1. Version Check
```bash
□ Node.js version >= 20.11.1
□ npm version >= 10.2.4
□ TypeScript versions match (root & webview)
□ Vite version is 5.4.x (not 7.x) for Node 20.11.1
```

### 2. Dependency Check
```bash
□ node_modules/ exists in root
□ webview-ui/node_modules/ exists
□ grpc-tools binaries built (check node_modules/grpc-tools/bin/)
□ vite binary exists (check webview-ui/node_modules/vite/bin/)
```

### 3. Generated Files Check
```bash
□ src/generated/hosts/vscode/hostbridge-grpc-service-config.ts exists
□ webview-ui/src/services/grpc-client.ts exists
□ Proto files generated successfully
```

### 4. Build Output Check
```bash
□ webview-ui/dist/ directory exists
□ webview-ui/dist/index.html exists
□ dist/extension.js exists (~18MB)
□ dist/extension.js is recent (check timestamp)
```

### 5. Configuration Check
```bash
□ tsconfig files have "incremental": true
□ tsconfig files do NOT have "composite": true
□ package.json scripts use "tsc --noEmit" not "tsc -b"
□ webview-ui build script uses "tsc --noEmit && vite build"
```

---

## 📊 BUILD TIME ESTIMATES

| Step | Time (Normal) | Time (Clean Build) |
|------|---------------|---------------------|
| Clean | 10 seconds | 30 seconds |
| Root npm install | 30 seconds | 2 minutes |
| grpc-tools build | 20 seconds | 1 minute |
| Webview npm install | 45 seconds | 3 minutes |
| Proto generation | 5 seconds | 5 seconds |
| Type checking | 15 seconds | 30 seconds |
| Webview build | 10 seconds | 30 seconds |
| Extension build | 5 seconds | 10 seconds |
| VSIX packaging | 10 seconds | 15 seconds |
| **TOTAL** | **~2-3 minutes** | **~8-10 minutes** |

---

## 🎯 VALIDATION TESTS

After build completes, run these tests:

### Test 1: VSIX Structure
```bash
unzip -l bcline-3.39.2-complete.vsix | head -20
# Should show extension.vsixmanifest and extension/ directory
```

### Test 2: Extension Bundle
```bash
unzip -p bcline-3.39.2-complete.vsix extension/dist/extension.js | head -1
# Should show JavaScript code (not error)
```

### Test 3: Webview Bundle
```bash
unzip -p bcline-3.39.2-complete.vsix extension/webview-ui/build/index.html | grep -i "claude"
# Should show HTML with references to assets
```

### Test 4: File Count
```bash
unzip -l bcline-3.39.2-complete.vsix | wc -l
# Should show 3000-4000 files
```

### Test 5: Size Check
```bash
ls -lh bcline-3.39.2-complete.vsix
# Should be 30-35MB
```

---

## 📝 MAINTENANCE NOTES

### When to Rebuild
- ✅ After pulling new commits
- ✅ After changing TypeScript code
- ✅ After modifying proto files
- ✅ After updating dependencies
- ⚠️ NOT needed for README/docs changes

### Partial Rebuild Commands

**Only rebuild extension:**
```bash
node esbuild.mjs --production
npx @vscode/vsce package --no-dependencies
```

**Only rebuild webview:**
```bash
cd webview-ui && npm run build && cd ..
npx @vscode/vsce package --no-dependencies
```

**Only regenerate protos:**
```bash
npm run protos
node esbuild.mjs --production
npx @vscode/vsce package --no-dependencies
```

---

## 🔄 UPGRADING DEPENDENCIES

### Safe Upgrade Path

1. **Check compatibility first**
2. **Update one package at a time**
3. **Test build after each update**
4. **Document changes**

### Upgrading Vite (Example)

```bash
# Check Node version
node --version

# If >= 20.19.0, can upgrade to Vite 7.x
cd webview-ui
npm install vite@^7.1.11 --save
cd ..

# Test build
npm run check-types
cd webview-ui && npm run build && cd ..

# If successful, commit change
git add webview-ui/package.json
git commit -m "chore: upgrade vite to 7.1.11"
```

---

## 📚 REFERENCES

- [BUILD_PROCESS_ANALYSIS.md](./BUILD_PROCESS_ANALYSIS.md) - Detailed error analysis
- [COMPLETE_CHANGES_LIST.md](./COMPLETE_CHANGES_LIST.md) - All custom changes
- [INSTALLATION_VERIFICATION.md](./INSTALLATION_VERIFICATION.md) - Testing guide

---

## ✅ SUCCESS CRITERIA

Your build is successful when:

1. ✅ All steps complete without errors
2. ✅ VSIX file created (~30-35MB)
3. ✅ VSIX contains 3000-4000 files
4. ✅ extension.js is ~18MB
5. ✅ webview/build/ directory exists in VSIX
6. ✅ No console errors during package
7. ✅ All type checks pass
8. ✅ All lint checks pass

---

**IMPORTANT:** Always run `git status` before building to ensure you're on the correct branch and have the right code checked out!

**Last Updated:** December 3, 2025
**Build Version:** BCline v3.39.2-complete
**Procedure Version:** 1.0
