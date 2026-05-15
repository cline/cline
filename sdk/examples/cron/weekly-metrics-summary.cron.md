---
id: weekly-metrics-summary
title: Weekly Project Metrics Summary
workspaceRoot: /absolute/path/to/repo
schedule: "0 17 * * FRI"
tools: run_commands,read_files,search_codebase
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 20
tags:
  - automation
  - metrics
  - team
metadata:
  owner: leadership
  reportFormat: markdown
---
Generate a fun and insightful weekly metrics summary for the team:

Collect metrics from the past 7 days:

1. **Code Activity:**
   - Total commits this week
   - Lines added/deleted
   - Most active contributors
   - Most modified files

2. **Quality Metrics:**
   - Test pass rate
   - Test coverage trend (up/down %)
   - New issues introduced vs. fixed
   - Type check errors (trend)

3. **Performance:**
   - Build time trend
   - Bundle size changes
   - Performance regressions detected

4. **Pull Requests:**
   - PRs opened vs. closed
   - Average review time
   - PRs by author
   - Most reviewed files

5. **Development Velocity:**
   - Story points completed (if using)
   - Bugs fixed vs. features added
   - On-schedule vs. blocked tasks

Create a fun markdown report with:
- 🏆 Top contributor of the week (most commits/reviews)
- 📈 Metrics trending up/down with arrows
- 🎯 Week's accomplishments summary
- ⚠️  Metrics needing attention
- 💡 Insights (e.g., "Performance improved 5% this week!")
- 🔥 "Hot spots" (most frequently modified files)

Include emoji indicators and fun facts:
- 🚀 Most commits in a single day
- 👀 Most reviewed PR
- 🐛 Most bug fixes by individual

Make it celebratory but data-driven. Perfect for team morale on Friday!
