# Publish and Tag from Dev

Merge `dev` into `main`, update version, curate changelog, and tag the release.

## Overview

This workflow helps you:
1. Switch to `main` and merge `dev`
2. Let the user specify the tag version
3. Update `package.json` version
4. Curate `CHANGELOG.md` for the new version
5. Commit, tag, and push everything

## Process

### 1) Switch to main and merge dev

```bash
git checkout main
git pull origin main
git merge dev --no-edit
```

### 2) Ask user for the tag version

Use `ask_followup_question` to let the user specify the new version tag (e.g., `v3.82.3`).

### 3) Update package.json version

```bash
# Read current version first
cat package.json | grep '"version"'
```

Update the `"version"` field in `package.json` to match the user-specified tag (without the `v` prefix).

### 4) Update CHANGELOG.md

Add a new entry at the top of `CHANGELOG.md` for the new version. Follow the existing format:

```markdown
## [X.Y.Z]

### Added

- New feature description

### Fixed

- Bug fix description

### Changed

- Behavior change description
```

### 5) Commit the changes

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "v<version> Release Notes"
```

### 6) Tag and push

```bash
git push origin main
git tag v<version>
git push origin v<version>
```

### 7) Summary

Present to the user:
- New version tag: `v<version>`
- Main branch pushed: yes
- Tag pushed: yes
- CHANGELOG.md updated with curated notes