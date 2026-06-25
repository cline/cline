---
id: local-manual-test
title: Local Manual Event Test
workspaceRoot: /absolute/path/to/repo
cwd: /absolute/path/to/repo
event: local.manual_test
filters:
  topic: cron-feature-2
debounceSeconds: 0
dedupeWindowSeconds: 60
cooldownSeconds: 0
maxParallel: 1
mode: act
enabled: true
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 300
maxIterations: 5
tags:
  - automation
  - local-test
metadata:
  owner: platform
  source: local-smoke-test
---
Use the normalized trigger event context to confirm event-driven automation is
working locally. Summarize the event id, subject, topic, and payload message.
