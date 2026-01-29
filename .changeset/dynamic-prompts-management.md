---
"@cline/cline": minor
---

Add comprehensive custom prompts system with automatic component merging and granular tool control.

### Features
- **Unified Prompt System**: Automatic merging of custom content with Cline's default components
- **Granular Tool Control**: 8 tool groups (@filesystem, @browser, @web, @terminal, @mcp, @communication, @task, @utility)
- **Advanced Tool Configuration**: Whitelist/blacklist modes, custom tool instructions, native tool calls
- **Component Flags**: 7 convenience flags for fine-tuning default sections
- **Dynamic Placeholders**: 6 standard placeholders (CWD, CURRENT_DATE, SUPPORTS_BROWSER, IDE, HAS_MCP, YOLO_MODE)
- **Enhanced YAML Parser**: Supports nested objects, arrays, and complex configurations

### Changes
- **Core Logic**: New SystemPromptsManager with ToolConfiguration interface
- **Tool Groups**: Added TOOL_GROUPS constant with 8 predefined tool categories
- **Parser Enhancement**: YAML parser handles nested objects for tools.enabled/disabled/customToolInstructions
- **Component Resolution**: Smart defaults for component inclusion based on context
- **Placeholder Processing**: Template engine integration for dynamic values
- **Documentation**: Complete implementation guide and verification documentation

### Technical Improvements
- **794 tests passing** (39 custom prompts tests)
- **Full backward compatibility** - existing prompts continue to work
- **Zero external dependencies** - custom YAML parser
- **Type safety** - comprehensive TypeScript interfaces
- **Performance optimized** - 500ms caching, lazy loading
- **Security maintained** - path traversal prevention, input validation

### Usage Examples
```yaml
---
name: "Read-Only Analyst"
tools:
  enabled: ["@filesystem", "@web"]
  disabled: ["write_to_file"]
---
```

### Documentation
- User README (auto-generated) in `~/.cline/system-prompts/README.md`
- Implementation guide in `docs/CUSTOM_PROMPTS_IMPLEMENTATION.md`
- Technical verification in `docs/IMPLEMENTATION_VERIFICATION.md`
