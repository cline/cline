---
id: pr-test-coverage
title: Analyze Test Coverage Impact of PR
workspaceRoot: /absolute/path/to/repo
event: github.pull_request.synchronize
filters:
  repository: your-org/your-repo
  pullRequest:
    baseBranch: main
debounceSeconds: 30
cooldownSeconds: 120
maxParallel: 2
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
tags:
  - automation
  - github
  - testing
metadata:
  owner: qa
  checkMetrics:
    - lineCoverage
    - branchCoverage
    - newFilesCoverage
---
Analyze test coverage impact when a PR is updated:

1. Checkout the PR branch
2. Run test coverage: `npm run test:coverage`
3. Compare coverage to main branch:
   - Lines added with coverage
   - Lines added without coverage
   - Files with decreased coverage
   - New files with low coverage

4. Generate a coverage impact report showing:
   - Coverage change percentage
   - Files with added uncovered code
   - Critical gaps in new functionality
   - Suggestions for missing tests

5. Post results as PR comment with:
   - Overall coverage impact (↑ or ↓)
   - File-by-file breakdown
   - Specific line ranges needing tests
   - Recommendations for test additions

Color code the feedback:
- 🟢 Coverage improved
- 🟡 Coverage maintained
- 🔴 Coverage decreased
- ⚫ New code without tests

Help maintain test quality standards without blocking the PR.
