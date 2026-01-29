# Custom Prompts Implementation

## Overview

The custom prompts system allows users to personalize Cline's behavior while automatically inheriting essential capabilities. Custom prompts are merged with Cline's default components—you define the role and personality, Cline handles the technical plumbing.

## Architecture

The system works by combining your custom content with Cline's default components:

1. Your custom prompt (role, personality, focus)
2. + Cline's essential components (tools, rules, guidelines)
3. = Complete system prompt

This way you can customize Cline's behavior while keeping all core capabilities.

## Key Features

### Automatic Component Merging

Custom prompts automatically merge with Cline's default components. By default, all essential components are included:

- Tool use instructions (how to call tools)
- File editing guidelines
- System rules and capabilities
- MCP integration (when configured)
- Browser rules (when enabled)
- User instructions (from cline-rules)

### Granular Tool Selection

Control which tools are available using the `tools` configuration:

```yaml
---
name: "Read-Only Analyst"
tools:
  enabled:
    - "@filesystem"   # Enable all filesystem tools
    - "@web"          # Enable web tools
  disabled:
    - "write_to_file" # But disable writing
    - "replace_in_file"
---
```

#### Tool Groups

| Group | Tools | Description |
|-------|-------|-------------|
| @filesystem | read_file, write_to_file, replace_in_file, list_files, search_files, list_code_definition_names, apply_patch | File operations |
| @browser | browser_action | Browser automation |
| @web | web_fetch, web_search | Internet access |
| @terminal | execute_command | Shell commands |
| @mcp | use_mcp_tool, access_mcp_resource, load_mcp_documentation | MCP integration |
| @communication | ask_followup_question, attempt_completion | User interaction |
| @task | new_task, plan_mode_respond, act_mode_respond, focus_chain | Task management |
| @utility | generate_explanation, use_skill | Utilities |

### Component Control

Fine-tune which default sections are included:

```yaml
---
name: "Focused Developer"
# Include specific components (whitelist)
includeComponents:
  - TOOL_USE_SECTION
  - EDITING_FILES_SECTION
  - RULES_SECTION

# Or exclude specific components (blacklist)
excludeComponents:
  - MCP_SECTION
  - SKILLS_SECTION
---
```

#### Component Flags (Convenience)

```yaml
includeToolInstructions: true    # TOOL_USE_SECTION + TOOLS_SECTION
includeEditingGuidelines: true   # EDITING_FILES_SECTION
includeBrowserRules: true        # CAPABILITIES_SECTION
includeMcpSection: true          # MCP_SECTION
includeUserInstructions: true    # USER_INSTRUCTIONS_SECTION
includeRules: true               # RULES_SECTION
includeSystemInfo: true          # SYSTEM_INFO_SECTION
```

### Dynamic Placeholders

Use `{{PLACEHOLDER}}` syntax for dynamic values:

- `{{CWD}}` - Current working directory
- `{{CURRENT_DATE}}` - Today's date (YYYY-MM-DD)
- `{{SUPPORTS_BROWSER}}` - Browser enabled (true/false)
- `{{IDE}}` - Current IDE (vscode, cursor, etc.)
- `{{HAS_MCP}}` - MCP configured (true/false)
- `{{YOLO_MODE}}` - YOLO mode active (true/false)

## Files Modified

### Core Implementation

| File | Description |
|------|-------------|
| `src/core/prompts/SystemPromptsManager.ts` | Metadata interfaces, YAML parsing, tool configuration, validation |
| `src/core/prompts/system-prompt/index.ts` | Custom prompt building, component merging, placeholder resolution |

### Tests

| File | Description |
|------|-------------|
| `src/core/prompts/__tests__/SystemPromptsManager.test.ts` | Unit tests for tool groups, configuration, validation |

## Public API

### SystemPromptsManager

```typescript
// Get active prompt with parsed metadata
async getActivePromptWithMetadata(): Promise<{
  content: string
  rawContent: string
  metadata: CustomPromptMetadata
} | null>

// Validate a prompt file
async validatePrompt(promptId: string): Promise<PromptValidationResult>

// Get prompt by ID with full metadata
async getPromptById(promptId: string): Promise<SystemPrompt | null>

// Create prompt programmatically
async createPrompt(name: string, content: string, metadata?: Partial<CustomPromptMetadata>): Promise<{
  success: boolean
  id: string
  error?: string
}>
```

### Tool Configuration Functions

```typescript
// Expand tool group references to individual tools
expandToolReferences(refs: string[]): string[]

// Resolve enabled/disabled tools based on configuration
resolveEnabledTools(allTools: string[], config?: ToolConfiguration): {
  enabledTools: string[]
  disabledTools: string[]
}
```

## Examples

### Programming: Backend Developer

```markdown
---
name: "Backend Developer"
description: "Node.js/TypeScript API specialist"
tools:
  disabled: ["@browser"]
---

# Backend Development Specialist

You are a backend development specialist working in {{CWD}}.

## Expertise
- Node.js and TypeScript
- REST and GraphQL APIs
- PostgreSQL and Redis
- Docker and Kubernetes

## Approach
- Write clean, testable code
- Follow SOLID principles
- Document API endpoints
- Consider security implications
```

### Non-Programming: Research Analyst

```markdown
---
name: "Research Analyst"
tools:
  enabled: ["@web", "@filesystem", "@communication"]
---

# Research Analyst

You are a research analyst helping with information gathering and analysis.

## Capabilities
- Search and synthesize information from multiple sources
- Create structured research reports
- Analyze data and identify patterns
- Cite sources properly

## Guidelines
- Verify information from multiple sources
- Present balanced perspectives
- Clearly distinguish facts from opinions
```

### Non-Programming: Technical Writer

```markdown
---
name: "Technical Writer"
tools:
  enabled: ["@filesystem", "@communication"]
  disabled: ["@terminal"]
---

# Technical Writing Specialist

You create clear, well-structured documentation.

## Expertise
- API documentation and developer guides
- User manuals and tutorials
- Technical specifications
- Style guide compliance

## Communication Style
- Use plain language, avoid jargon
- Break complex topics into digestible sections
- Include practical examples
```

### Non-Programming: Legal Reviewer

```markdown
---
name: "Legal Reviewer"
tools:
  enabled: ["read_file", "search_files", "@communication"]
---

# Legal Document Reviewer

You review legal documents for clarity and potential issues.

## Review Focus
- Contract terms and conditions
- Compliance requirements
- Ambiguous language
- Missing or unclear clauses

## Important
- Flag items requiring attorney review
- Do not provide legal advice
- Note jurisdiction-specific considerations
```

## Testing

```bash
# Run custom prompts tests
npm run test:unit -- --grep "SystemPromptsManager"

# Run tool configuration tests
npm run test:unit -- --grep "Tool Groups"

# Full type check
npm run check-types

# Full compile
npm run compile
```

## Backward Compatibility

The system maintains full backward compatibility:

- Prompts without YAML frontmatter work as before (merged with defaults)
- All existing metadata fields are supported
- Legacy prompts will benefit from automatic component merging

## File Management

- **Location**: `~/.cline/system-prompts/`
- **Format**: Markdown (.md) with optional YAML frontmatter
- **Encoding**: UTF-8
- **Naming**: Use descriptive names (e.g., `react-developer.md`)
- **Activation**: Select in Cline Settings > Custom Prompts
