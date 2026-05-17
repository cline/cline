---
id: type-check-strict
title: Strict TypeScript Type Checking
workspaceRoot: /absolute/path/to/repo
schedule: "0 6 * * *"
tools: run_commands,read_files
mode: plan
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 20
tags:
  - automation
  - quality
  - typescript
metadata:
  owner: development
  strictLevel: strict
---
Run TypeScript type checking with strict compiler options:

1. Run `tsc --noEmit` with strict mode settings
2. Collect all type errors and warnings
3. Categorize errors:
   - Missing type annotations
   - Implicit any types
   - Null/undefined safety issues
   - Generic type issues
   - Import/export mismatches

Generate a detailed report showing:
- Total type errors
- Errors by category with counts
- Top 10 files with most type errors
- Specific recommendations for each category

Suggest improvements:
- Files that would benefit from JSDoc
- Places where explicit types would improve clarity
- Breaking changes if we made types more strict

Use plan mode to suggest fixes without applying them automatically.
