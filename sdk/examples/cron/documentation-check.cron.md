---
id: documentation-check
title: Documentation Coverage Audit
workspaceRoot: /absolute/path/to/repo
schedule: "0 5 * * THU"
tools: run_commands,read_files,search_codebase
mode: plan
enabled: false
modelSelection:
  providerId: cline
  modelId: anthropic/claude-opus-4.7
timeoutSeconds: 1800
maxIterations: 25
tags:
  - automation
  - documentation
  - quality
metadata:
  owner: documentation
  checkAreas:
    - publicAPIs
    - complexFunctions
    - typeDefinitions
    - modules
---
Audit documentation coverage across the codebase:

1. Check public API documentation:
   - Functions exported from public modules
   - Classes and interfaces
   - Type definitions and generics
   - Decorators and annotations

2. Identify missing documentation:
   - Public functions without JSDoc comments
   - Complex functions without explanation
   - Public types without descriptions
   - Exported modules without README or header comments

3. Evaluate existing documentation quality:
   - JSDoc comments without @param or @return tags
   - Comments that are outdated or misleading
   - Code samples in docs that may be broken
   - Links in documentation that point to removed code

4. Analyze documentation structure:
   - Main README quality and completeness
   - Architecture documentation
   - Contributing guide existence
   - API reference documentation
   - Changelog maintenance

Generate report with sections:
- Documentation coverage percentage by module
- Top 10 undocumented public APIs
- Types with missing descriptions
- Files with complex logic needing explanation
- Outdated documentation instances

Recommendations:
- High-priority items (public APIs without docs)
- Documentation style improvements
- Template suggestions for JSDoc
- Links that need updating

Use plan mode to suggest improvements without applying changes.
