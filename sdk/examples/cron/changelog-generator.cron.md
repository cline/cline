---
id: changelog-generator
title: Auto-Generate Changelog from Commits
workspaceRoot: /absolute/path/to/repo
schedule: "0 18 * * FRI"
tools: run_commands,read_files,editor
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 20
tags:
  - automation
  - changelog
  - documentation
metadata:
  owner: development
  targetFile: apps/cli/CHANGELOG.md
  trackDirectory: apps/cli
---
Review recent commits in the `apps/cli` directory since the last CHANGELOG entry.
Generate a summary of significant changes (new features, bug fixes, breaking changes).
Update `apps/cli/CHANGELOG.md` with a new version entry at the top following this format:

## [VERSION] (YYYY-MM-DD)

- Feature: [description]
- Fix: [description]
- Breaking: [description]

Do NOT bump the version number in package.json.
Do NOT override existing entries.
Focus on user-facing changes, not internal refactors.

Follow the existing changelog style and format from previous entries.
