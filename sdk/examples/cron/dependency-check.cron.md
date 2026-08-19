---
id: dependency-check
title: Weekly Dependency Health Check
workspaceRoot: /absolute/path/to/repo
schedule: "0 10 * * MON"
tools: run_commands,read_files
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 15
tags:
  - automation
  - security
  - dependencies
metadata:
  owner: platform
---
Run a comprehensive dependency health check:

1. Check for outdated packages: `npm outdated` (or yarn/pnpm equivalent)
2. Check for security vulnerabilities: `npm audit` 
3. List packages with available major version upgrades
4. Identify unused dependencies (if possible)
5. Check for dependency conflicts or duplicate packages

Provide a summary report covering:
- Critical security vulnerabilities (if any)
- Count of outdated packages by severity (minor, patch, major)
- Recommended immediate actions
- Packages safe to update to latest versions

Focus on actionable insights. Ignore known false positives and dev-only dependencies.
