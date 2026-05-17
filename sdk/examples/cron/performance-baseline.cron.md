---
id: performance-baseline
title: Track Performance Metrics
workspaceRoot: /absolute/path/to/repo
schedule: "0 2 * * *"
tools: run_commands,read_files,editor
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 2400
maxIterations: 20
tags:
  - automation
  - performance
  - monitoring
metadata:
  owner: platform
  metricsFile: .perf-baseline.json
---
Measure and track performance baselines for the project:

1. Build the project and measure build time: `npm run build`
2. Bundle size analysis (if applicable): Run bundler with size reporting
3. Cold start time if this is a CLI/server tool
4. Run performance benchmarks if they exist

Create or update `.perf-baseline.json` with:
```json
{
  "timestamp": "ISO-8601",
  "buildTime": "milliseconds",
  "bundleSize": "bytes",
  "coldStart": "milliseconds",
  "metrics": {...}
}
```

Detect performance regressions:
- If build time increased by >10%, flag as warning
- If bundle size increased by >5%, flag as concern
- Compare to previous day's baseline

Report findings with recommendations for optimization if regressions detected.
