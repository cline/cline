---
id: test-coverage-report
title: Generate Test Coverage Report
workspaceRoot: /absolute/path/to/repo
schedule: "0 22 * * *"
tools: run_commands,read_files
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 2400
maxIterations: 25
tags:
  - automation
  - testing
  - quality
metadata:
  owner: qa
  reportFormat: markdown
---
Run test suite and generate a coverage report:

1. Run the full test suite: `npm test` or equivalent
2. Generate coverage report in JSON format: `npm run test:coverage`
3. Parse the coverage data to identify:
   - Overall coverage percentage (lines, branches, functions, statements)
   - Files with coverage below 80%
   - Files with coverage below 50% (critical)
   - Coverage trends (if previous reports exist)

Create a markdown summary showing:
- Overall coverage metrics with visual progress bars
- Top 5 files needing coverage improvements
- Test results: total tests, passed, failed, skipped
- Recommendations for improving test coverage

Include emoji indicators for health status:
- 🟢 Excellent (>90%)
- 🟡 Good (70-90%)
- 🔴 Needs attention (<70%)
