---
id: daily-code-review
title: Daily Code Review
workspaceRoot: /absolute/path/to/repo
schedule: "0 9 * * MON-FRI"
tools: run_commands,read_files
mode: act
enabled: true
modelSelection:
  providerId: openai
  modelId: gpt-5.4
timeoutSeconds: 1800
systemPrompt: You are a precise automation agent that reports only actionable review findings.
maxIterations: 20
tags:
  - automation
  - review
metadata:
  owner: platform
notesDirectory: /absolute/path/to/notes
extensions:
  - rules
  - skills
  - plugins
source: user
---
Review the open pull requests, identify the highest-risk changes, run the
relevant checks if needed, and write a concise summary of findings.
