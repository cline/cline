---
id: local-plugin-event
title: Local Plugin Event
workspaceRoot: /absolute/path/to/repo
cwd: /absolute/path/to/repo
event: local.plugin_event
filters:
  topic: plugin-demo
dedupeWindowSeconds: 5
cooldownSeconds: 5
maxParallel: 1
tags:
  - local
  - plugin
  - automation
metadata:
  source: apps/examples/cline-plugin/automation-events.ts
---
Summarize the local plugin event and report the event subject, topic, and
message payload.
