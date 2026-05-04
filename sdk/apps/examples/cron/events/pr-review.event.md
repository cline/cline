---
id: pr-review
title: Review New Pull Requests
workspaceRoot: /absolute/path/to/repo
cwd: /absolute/path/to/repo
event: github.pull_request.opened
filters:
  repository: acme/api
  pullRequest:
    baseBranch: main
debounceSeconds: 30
dedupeWindowSeconds: 600
cooldownSeconds: 120
maxParallel: 2
mode: act
enabled: true
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 20
tags:
  - automation
  - github
  - review
metadata:
  owner: platform
  source: normalized-event-ingress
---
Review the opened pull request from the trigger event context. Summarize the
highest-risk changes, call out missing tests or migration risks, and recommend
the next action for the author.
