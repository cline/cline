---
id: code-style-audit
title: Code Style and Linting Audit
workspaceRoot: /absolute/path/to/repo
schedule: "0 3 * * WED"
tools: run_commands,read_files
mode: act
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 20
tags:
  - automation
  - quality
  - style
metadata:
  owner: development
  reportFormat: markdown
---
Run comprehensive code style and linting checks:

1. Run ESLint: `npm run lint` or `eslint .`
2. Run Prettier check: `prettier --check .` or equivalent
3. Check for common issues:
   - Unused variables or imports
   - Dead code
   - TODO/FIXME comments left in main branch
   - Console.log statements in production code
   - Magic numbers without explanation

Generate a report showing:
- Linting violations by rule (top 10)
- Files with most violations
- Formatting inconsistencies
- Pattern analysis (e.g., common TODO reasons, unused import patterns)

Provide statistics:
- Total violations found
- Fixable vs non-fixable violations
- Trend compared to previous week (if data exists)

Recommendations:
- Quick wins: violations that can be auto-fixed
- Standards improvements: patterns to establish
- Review-needed: complex issues requiring human judgment
