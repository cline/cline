# Cline+ DAG-Aware Agent — Deployment Guide

## Overview

This guide covers deploying Cline+ to production, including publishing to the VS Code Marketplace and PyPI. The extension runs entirely locally on user machines, so "deployment" means packaging and publishing rather than server infrastructure.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [ ] Release steps not executed in this repo (treat this document as a checklist)

## Prerequisites

- VS Code Marketplace publisher account
- PyPI account with 2FA enabled
- GitHub repository with release permissions
- All tests passing locally
- `CHANGELOG.md` updated with release notes

### Account Setup

**VS Code Marketplace:**
1. Create a Microsoft account if needed
2. Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
3. Create a publisher (e.g., `cline-dag`)
4. Generate a Personal Access Token (PAT) with `Marketplace (Manage)` scope

**PyPI:**
1. Create account at [pypi.org](https://pypi.org)
2. Enable 2FA
3. Generate an API token with upload permissions

## Step 1: Pre-Release Checklist

Before releasing, verify:

```bash
# Clean build
rm -rf dist node_modules
npm install
npm run build

# Run all tests
npm test
cd dag-engine && pytest && cd ..

# Lint checks
npm run lint
cd dag-engine && ruff check . && mypy cline_dag && cd ..

# Package extension (dry run)
npx vsce package --dry-run

# Build Python wheel (dry run)
cd dag-engine && python -m build --no-isolation && cd ..
```

Verify the following manually:
- [ ] `CHANGELOG.md` has entry for new version
- [ ] `README.md` is up to date
- [ ] All new features are documented
- [ ] Screenshots/GIFs updated if UI changed
- [ ] Minimum VS Code version is correct in `package.json`

## Step 2: Version Bump

Update version numbers consistently:

### package.json
```json
{
  "version": "0.2.0"
}
```

### dag-engine/pyproject.toml
```toml
[project]
version = "0.2.0"
```

### CHANGELOG.md
```markdown
## [0.2.0] - 2026-02-15

### Added
- Feature X
- Feature Y

### Changed
- Improvement Z

### Fixed
- Bug fix A
```

Commit the version bump:
```bash
git add package.json dag-engine/pyproject.toml CHANGELOG.md
git commit -m "chore: bump version to 0.2.0"
```

## Step 3: Build Release Artefacts

### VS Code Extension Package

```bash
# Clean previous builds
rm -rf dist *.vsix

# Production build
npm run build

# Package extension
npx vsce package

# This creates: cline-dag-0.2.0.vsix
```

### Python Wheel

```bash
cd dag-engine

# Clean previous builds
rm -rf dist build *.egg-info

# Build wheel and source distribution
python -m build

# This creates:
# - dist/cline_dag_engine-0.2.0-py3-none-any.whl
# - dist/cline_dag_engine-0.2.0.tar.gz

cd ..
```

## Step 4: Test Release Artefacts

### Test Extension Package Locally

```bash
# Uninstall any existing version
code --uninstall-extension cline-dag.cline-dag

# Install the new package
code --install-extension cline-dag-0.2.0.vsix

# Open VS Code and verify:
# 1. Extension activates
# 2. Commands appear in palette
# 3. DAG engine starts
# 4. Basic functionality works
```

### Test Python Package Locally

```bash
# Create a fresh virtual environment
python3 -m venv /tmp/test-env
source /tmp/test-env/bin/activate

# Install from local wheel
pip install dag-engine/dist/cline_dag_engine-0.2.0-py3-none-any.whl

# Test import and basic functionality
python -c "from cline_dag.server import DAGServer; print('OK')"

# Cleanup
deactivate
rm -rf /tmp/test-env
```

## Step 5: Publish to VS Code Marketplace

### Option A: Command Line (Recommended)

```bash
# Set your PAT as environment variable
export VSCE_PAT="your-personal-access-token"

# Publish to marketplace
npx vsce publish

# Or publish a specific version
npx vsce publish 0.2.0
```

### Option B: Manual Upload

1. Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Select your publisher
3. Click "New Extension" → "VS Code"
4. Upload `cline-dag-0.2.0.vsix`
5. Fill in metadata if prompted
6. Submit for review

### Verify Marketplace Publication

After publishing (allow 5-10 minutes for processing):
1. Search for "Cline+ DAG" in VS Code Extensions
2. Verify version number is correct
3. Check that description and screenshots display correctly
4. Install from Marketplace and test

## Step 6: Publish to PyPI

### Option A: Using Twine (Recommended)

```bash
cd dag-engine

# Install twine if needed
pip install twine

# Upload to PyPI
twine upload dist/*

# You'll be prompted for:
# - Username: __token__
# - Password: your-pypi-api-token
```

### Option B: Using PyPI Token File

Create `~/.pypirc`:
```ini
[pypi]
username = __token__
password = pypi-your-api-token-here
```

Then:
```bash
cd dag-engine
twine upload dist/*
```

### Verify PyPI Publication

```bash
# Wait a few minutes, then test installation
pip install cline-dag-engine==0.2.0

# Verify
python -c "import cline_dag; print(cline_dag.__version__)"
```

## Step 7: Create GitHub Release

```bash
# Tag the release
git tag -a v0.2.0 -m "Release 0.2.0"

# Push tag
git push origin v0.2.0
```

Create release on GitHub:
1. Go to repository → Releases → "Draft a new release"
2. Select tag `v0.2.0`
3. Title: "v0.2.0"
4. Description: Copy from `CHANGELOG.md`
5. Attach artefacts:
   - `cline-dag-0.2.0.vsix`
   - `cline_dag_engine-0.2.0-py3-none-any.whl`
6. Publish release

## Step 8: Post-Release Tasks

### Update Documentation

- Update any version references in docs
- Update installation instructions if needed
- Add migration guide if breaking changes

### Announce Release

- Post to relevant Discord/Slack channels
- Tweet/post on social media
- Update project website if applicable

### Monitor for Issues

- Watch GitHub Issues for bug reports
- Monitor VS Code Marketplace reviews
- Check PyPI download statistics

## Rollback Procedure

### VS Code Marketplace

The Marketplace doesn't support direct rollback. Instead:

1. Immediately publish a new patch version with the fix
2. Or unpublish the extension (nuclear option):
   ```bash
   npx vsce unpublish cline-dag.cline-dag
   ```

### PyPI

PyPI doesn't allow re-uploading the same version. Options:

1. Yank the bad version (marks it as not recommended):
   ```bash
   pip install twine
   twine upload --skip-existing  # Won't help if already uploaded
   # Use PyPI web interface to yank
   ```

2. Release a new patch version with the fix

### GitHub Release

1. Go to the release on GitHub
2. Click "Edit"
3. Check "This is a pre-release" to de-emphasise
4. Or delete the release entirely

## Continuous Integration Setup

For automated releases, add to `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          
      - name: Install dependencies
        run: |
          npm ci
          cd dag-engine && pip install build twine
          
      - name: Run tests
        run: |
          npm test
          cd dag-engine && pytest
          
      - name: Build extension
        run: npm run build && npx vsce package
        
      - name: Build Python package
        run: cd dag-engine && python -m build
        
      - name: Publish to VS Code Marketplace
        run: npx vsce publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
          
      - name: Publish to PyPI
        run: cd dag-engine && twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
          
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            *.vsix
            dag-engine/dist/*
          body_path: CHANGELOG.md
```

Required secrets:
- `VSCE_PAT`: VS Code Marketplace Personal Access Token
- `PYPI_TOKEN`: PyPI API token

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `vsce publish` fails with auth error | Regenerate PAT; ensure `Marketplace (Manage)` scope |
| Extension rejected by Marketplace | Check error email; common issues: missing license, inappropriate content |
| PyPI upload fails with 403 | Check API token permissions; ensure 2FA is enabled |
| Version already exists on PyPI | Cannot re-upload; bump patch version instead |
| Extension doesn't appear in search | Wait 15-30 minutes; check spelling of search terms |
| Users report missing DAG engine | Ensure wheel is published and version matches |

---

**Document Version:** 1.0  
**Last Updated:** 28 January 2026
