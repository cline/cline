---
id: dead-code-finder
title: Find and Report Dead Code
workspaceRoot: /absolute/path/to/repo
schedule: "0 4 * * SUN"
tools: run_commands,read_files,search_codebase
mode: plan
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 2400
maxIterations: 30
tags:
  - automation
  - quality
  - refactoring
metadata:
  owner: development
  reportType: analysis
---
Scan the codebase for dead code and unused exports:

1. Identify unused exports:
   - Functions not called within the module or by external modules
   - Classes with no instantiations
   - Constants/variables not referenced
   - Type definitions not used

2. Detect unreachable code patterns:
   - Statements after return/throw
   - Unreachable branches in conditionals
   - Dead try-catch blocks
   - Unused catch parameters

3. Analyze file-level patterns:
   - Modules that are never imported
   - Test files without corresponding implementation
   - Example/demo code in main codebase
   - Deprecated or marked-for-removal code

Generate a comprehensive report with:
- Dead code segments (with file locations and line numbers)
- Confidence level for each finding (high/medium/low)
- Safe-to-remove vs requires-review items
- Estimated code reduction if cleanup is done

Safe removals candidates:
- Variables only assigned, never read
- Functions declared but never called
- Exported items with no external references

Requires review:
- Code that might be called dynamically
- Public APIs (check if external consumers exist)
- Backwards-compatibility concerns

Use plan mode to suggest removals without applying them.
