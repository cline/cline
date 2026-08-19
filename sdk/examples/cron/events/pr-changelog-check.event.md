---
id: pr-changelog-check
title: Check for Changelog Updates in PRs
workspaceRoot: /absolute/path/to/repo
event: github.pull_request.opened
filters:
  repository: your-org/your-repo
  pullRequest:
    baseBranch: main
debounceSeconds: 10
cooldownSeconds: 60
maxParallel: 3
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
tags:
  - automation
  - github
  - documentation
metadata:
  owner: development
---
Automatically check if a PR that modifies code also updates the CHANGELOG:

1. Detect if the PR modifies source files (src/, lib/, etc.)
2. Check if the PR also includes changes to CHANGELOG.md or relevant changelogs
3. If significant code changes but no changelog update:
   - Extract a summary of the changes
   - Suggest what should be added to CHANGELOG
   - Request the author to add an entry

4. If CHANGELOG is updated:
   - Verify the format matches the project style
   - Check that entry is concise and user-facing
   - Ensure version number is appropriate

Provide feedback as a comment on the PR:
- ✅ CHANGELOG properly updated
- ⚠️  No CHANGELOG changes detected - please add an entry
- 🤔 CHANGELOG entry format seems off - consider [example]

This helps maintain an up-to-date CHANGELOG without manual reminders.
