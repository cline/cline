---
"@cline/cline": minor
---

Add custom system prompts with automatic component merging and granular tool control.

### Features
- **Custom Prompts**: Define AI role/behavior while inheriting Cline's capabilities
- **Tool Groups**: 8 predefined groups (@filesystem, @browser, @web, @terminal, @mcp, @communication, @task, @utility)
- **Component Control**: 7 flags for fine-tuning default sections (tools, editing, browser, MCP, rules, etc.)
- **Placeholders**: Dynamic values (CWD, CURRENT_DATE, SUPPORTS_BROWSER, IDE, HAS_MCP, YOLO_MODE)

### Architecture
- **Backend**: `SystemPromptsManager` singleton manages prompts in `~/.cline/system-prompts/`
- **gRPC**: 8 handlers via `PromptsService` (list, get, create, update, delete, activate, getActiveId, openDirectory)
- **Frontend**: `SystemPromptsSection` tab in Settings with full CRUD UI
- **Integration**: `getSystemPrompt()` merges custom content with default components

### Technical Details
- Reuses `parseYamlFrontmatter` from `@core/context/instructions/user-instructions/frontmatter.ts`
- Reuses `isLocatedInPath` from `@/utils/path` for security
- Uses `ClineDefaultTool` enum from `@/shared/tools.ts` for tool groups
- Proto uses common types (`String`, `StringRequest`, `BooleanResponse`, `Empty`, `EmptyRequest`)
- 44 module tests passing

### Usage
```yaml
---
name: "Read-Only Analyst"
tools:
  enabled: ["@filesystem", "@web"]
  disabled: ["write_to_file"]
includeToolInstructions: true
---
# Your custom prompt content here
```
