# Release

Prepare and publish a release directly from `main`.

## Overview

This workflow helps you:
1. Select/confirm the target version
2. Curate `CHANGELOG.md` entries manually for end users
3. Ensure `apps/vscode/package.json` version matches the changelog
4. Create and push a release commit
5. Trigger publish workflow
6. Update GitHub release notes and share a summary

## Process

### 1) Sync and determine version

```bash
git checkout main
git pull origin main
node -p 'require("./apps/vscode/package.json").version'
```

Confirm the release version with the maintainer (patch/minor/major).

### 2) Curate changelog and version

- Edit `CHANGELOG.md` for the target version using human-friendly release notes.
- Ensure version headers use bracket format, e.g. `## [3.66.1]`.
- Update `apps/vscode/package.json` to the same version.

### 3) Commit

```bash
VERSION=$(node -p 'require("./apps/vscode/package.json").version')
git switch -c "dpc/release-v${VERSION}"
git add CHANGELOG.md apps/vscode/package.json
git commit -m "chore(vscode): release v${VERSION}"
git push -u origin HEAD
```

Open a release-preparation PR and merge it after its checks pass.

### 4) Trigger publish workflow

Tell the maintainer to run:
https://github.com/cline/cline/actions/workflows/ext-vscode-publish.yml

Use `<version>` without a `v` prefix and set `publish` to true. The workflow validates the version, tests and packages the exact dispatch commit, then publishes the prebuilt VSIX and creates the `v<version>` tag.

### 5) Update GitHub release notes

After publish completes:

```bash
VERSION=$(node -p 'require("./apps/vscode/package.json").version')
gh release view "v${VERSION}" --json body --jq '.body'
gh release edit "v${VERSION}" --notes-file /path/to/final-release-notes.md
```

### 6) Final summary

Provide:
- Released version/tag
- Link to release page
- Summary of top end-user changes
