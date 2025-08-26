# Tool Registration System

This directory contains the tool registration system for Cline tools. The system automatically collects and registers all tool variants with the `ClineToolSet` provider.

## Overview

Each tool file in this directory exports a `{toolName}_variants` array containing tool specifications for different prompt variants (e.g., Claude, GPT). The registration system automatically imports all these variants and registers them with the `ClineToolSet` provider.

## Files

- **`register.ts`** - Main registration function and utilities
- **`example-usage.ts`** - Example usage patterns
- **`index.ts`** - Exports all tools and the registration function
- **Individual tool files** - Each exports a `{toolName}_variants` array

## Usage

### Basic Registration

```typescript
import { registerAllToolVariants } from "./tools/register";

// Register all tool variants during application initialization
registerAllToolVariants();
```

### Getting Registration Summary

```typescript
import { getToolRegistrationSummary } from "./tools/register";

const summary = getToolRegistrationSummary();
console.log(summary);
// Output: { "write_to_file": ["claude"], "execute_command": ["claude", "gpt"], ... }
```

### Using Registered Tools

```typescript
import { ClineToolSet } from "../registry/ClineToolSet";
import { PromptVariant } from "@/shared/tools";

// Get all tools for a specific variant
const claudeTools = ClineToolSet.getTools(PromptVariant.CLAUDE);

// Get a specific tool by name
const writeToFileTool = ClineToolSet.getToolByName("write_to_file", PromptVariant.CLAUDE);
```

## Tool Structure

Each tool file follows this pattern:

```typescript
import { ClineDefaultTool, PromptVariant, type ClineToolSpec } from "@/shared/tools";

const claude: ClineToolSpec = {
    variant: PromptVariant.CLAUDE,
    id: "tool_name",
    description: "Tool description",
    parameters: [
        // Parameter definitions
    ],
};

const gpt: ClineToolSpec = {
    variant: PromptVariant.GPT,
    id: "tool_name_gpt",
    description: "Tool description for GPT",
    parameters: [
        // Parameter definitions
    ],
};

export const tool_name_variants = [claude, gpt];
```

## Registered Tools

The following tools are currently registered:

- `access_mcp_resource`
- `ask_followup_question`
- `attempt_completion`
- `browser_action`
- `execute_command`
- `focus_chain`
- `list_code_definition_names`
- `list_files`
- `load_mcp_documentation`
- `new_task`
- `plan_mode_respond`
- `read_file`
- `replace_in_file`
- `search_files`
- `use_mcp_tool`
- `web_fetch` (exported as `get_web_fetch_variants`)
- `write_to_file`

## Adding New Tools

1. Create a new tool file following the naming pattern: `{tool_name}.ts`
2. Export a `{tool_name}_variants` array with tool specifications
3. Add the export to `index.ts`
4. Add the import and spread to `register.ts`

## Notes

- The registration function handles duplicate registrations gracefully
- Tools are registered per variant (Claude, GPT, etc.)
- The system automatically counts unique tools and provides logging
- All tool variants are collected and registered in a single function call