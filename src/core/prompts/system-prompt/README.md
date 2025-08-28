# System Prompt Architecture

## Overview

The system prompt architecture provides a modular, composable system for building AI assistant prompts. It supports multiple model variants, dynamic component composition, flexible tool configuration, and template-based prompt generation.

## Developer

To generate snapshots for each variants added to the unit test in [src/core/prompts/system-prompt/__tests__/integration.test.ts](./__tests__/integration.test.ts):

```sh
npm run test:unit
```

## Directory Structure

```
src/core/prompts/system-prompt/
├── registry/
│   ├── ClineToolSet.ts            # Tool set management & registry
│   ├── PromptRegistry.ts          # Singleton registry for loading/managing prompts
│   ├── PromptBuilder.ts           # Builds final prompts with template resolution
│   └── utils.ts                   # Model family detection utilities
├── components/                    # Reusable prompt components
│   ├── agent_role.ts             # Agent role and identity section
│   ├── system_info.ts            # System information section
│   ├── mcp.ts                    # MCP servers section  
│   ├── todo.ts                   # Todo management section
│   ├── user_instructions.ts      # User custom instructions
│   ├── tool_use.ts               # Tool usage instructions
│   ├── editing_files.ts          # File editing guidelines
│   ├── capabilities.ts           # Agent capabilities section
│   ├── rules.ts                  # Behavioral rules section
│   ├── objective.ts              # Task objective section
│   ├── act_vs_plan.ts            # Action vs planning mode
│   ├── feedback.ts               # Feedback and improvement section
│   └── index.ts                  # Component registry
├── templates/                    # Template engine and placeholders
│   ├── TemplateEngine.ts         # {{placeholder}} resolution engine
│   └── placeholders.ts           # Standard placeholder definitions
├── tools/                        # Individual tool definitions
│   ├── spec.ts                   # Tool specification interface
│   ├── register.ts               # Tool registration system
│   ├── index.ts                  # Tool exports
│   └── [tool-name].ts            # Individual tool implementations
├── variants/                     # Model-specific prompt variants
│   ├── generic/
│   │   ├── config.ts             # Generic fallback configuration
│   │   └── template.ts           # Base prompt template
│   ├── next-gen/
│   │   ├── config.ts             # Next-gen model configuration
│   │   └── template.ts           # Advanced model template
│   ├── xs/
│   │   ├── config.ts             # Small model configuration
│   │   └── template.ts           # Optimized template
│   └── index.ts                  # Variant registry exports
├── types.ts                      # Core type definitions
└── README.md                     # This documentation
```

## Core Components

### 1. PromptRegistry (Singleton)

The `PromptRegistry` is the central manager for all prompt variants and components. It provides a singleton interface for loading and accessing prompts.

```typescript
class PromptRegistry {
  private static instance: PromptRegistry;
  private variants: Map<string, PromptVariant> = new Map();
  private components: ComponentRegistry = {};
  private loaded: boolean = false;

  static getInstance(): PromptRegistry {
    if (!this.instance) {
      this.instance = new PromptRegistry();
    }
    return this.instance;
  }

  // Load all prompts and components on initialization
  async load(): Promise<void> {
    if (this.loaded) return;
    
    await Promise.all([
      this.loadVariants(),    // Load from variants/ directory
      this.loadComponents()   // Load from components/ directory
    ]);
    
    this.loaded = true;
  }

	/**
	 * Get prompt by model ID with fallback to generic
	 */
	async get(context: SystemPromptContext): Promise<string> {
		await this.load()

		// Try model family fallback (e.g., "claude-4" -> "claude")
		const modelFamily = getModelFamily(context.providerInfo)
		const variant = this.variants.get(modelFamily ?? ModelFamily.GENERIC)

		if (!variant) {
			throw new Error(
				`No prompt variant found for model '${context.providerInfo.model.id}' and no generic fallback available`,
			)
		}

		const builder = new PromptBuilder(variant, context, this.components)
		return await builder.build()
	}

  // Get specific version of a prompt
  async getVersion(modelId: string, version: number, context: SystemPromptContext, isNextGenModelFamily?: boolean): Promise<string> {
    // Supports next-gen model family prioritization
  }

  // Get prompt by tag/label
  async getByTag(modelId: string, tag?: string, label?: string, context?: SystemPromptContext, isNextGenModelFamily?: boolean): Promise<string> {
    // Supports tag and label-based retrieval with next-gen prioritization
  }
}
```

### 2. PromptVariant Structure

The `PromptVariant` interface defines the configuration for each model-specific prompt variant:

```typescript
interface PromptVariant {
  id: string;                                    // Model family ID (e.g., "next-gen", "generic")
  version: number;                               // Version number
  family: ModelFamily;                           // Model family enum
  tags: string[];                                // ["production", "beta", "experimental"]
  labels: { [key: string]: number };             // {"staging": 2, "prod": 1}
  description: string;                           // Brief description of the variant

  // Prompt configuration
  config: PromptConfig;                          // Model-specific config
  baseTemplate: string;                          // Main prompt template with placeholders
  componentOrder: SystemPromptSection[];        // Ordered list of components to include
  componentOverrides: { [K in SystemPromptSection]?: ConfigOverride }; // Component customizations
  placeholders: { [key: string]: string };      // Default placeholder values

  // Tool configuration
  tools?: ClineDefaultTool[];                    // Ordered list of tools to include
  toolOverrides?: { [K in ClineDefaultTool]?: ConfigOverride }; // Tool-specific customizations
}

interface PromptConfig {
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ClineToolSpec[];
  [key: string]: any;                            // Additional arbitrary config
}

interface ConfigOverride {
  template?: string;                             // Custom template for the component/tool
  enabled?: boolean;                             // Whether the component/tool is enabled
  order?: number;                                // Override the order
}
```

### 3. PromptBuilder

The `PromptBuilder` orchestrates the construction of the final prompt by combining templates, components, and placeholders:

```typescript
class PromptBuilder {
  private templateEngine: TemplateEngine;

  constructor(
    private variant: PromptVariant,
    private context: SystemPromptContext,
    private components: ComponentRegistry
  ) {
    this.templateEngine = new TemplateEngine();
  }

  async build(): Promise<string> {
    // 1. Build all components in specified order
    const componentSections = await this.buildComponents();
    
    // 2. Prepare all placeholder values
    const placeholderValues = this.preparePlaceholders(componentSections);
    
    // 3. Resolve template placeholders
    const prompt = this.templateEngine.resolve(this.variant.baseTemplate, placeholderValues);
    
    // 4. Apply final post-processing
    return this.postProcess(prompt);
  }

  private async buildComponents(): Promise<Record<string, string>> {
    const sections: Record<string, string> = {};
    
    // Process components sequentially to maintain order
    for (const componentId of this.variant.componentOrder) {
      const componentFn = this.components[componentId];
      if (!componentFn) {
        console.warn(`Warning: Component '${componentId}' not found`);
        continue;
      }

      try {
        const result = await componentFn(this.variant, this.context);
        if (result?.trim()) {
          sections[componentId] = result;
        }
      } catch (error) {
        console.warn(`Warning: Failed to build component '${componentId}':`, error);
      }
    }

    return sections;
  }

  private preparePlaceholders(componentSections: Record<string, string>): Record<string, unknown> {
    const placeholders: Record<string, unknown> = {};

    // Add variant placeholders
    Object.assign(placeholders, this.variant.placeholders);

    // Add standard system placeholders
    placeholders[STANDARD_PLACEHOLDERS.CWD] = this.context.cwd || process.cwd();
    placeholders[STANDARD_PLACEHOLDERS.SUPPORTS_BROWSER] = this.context.supportsBrowserUse || false;
    placeholders[STANDARD_PLACEHOLDERS.MODEL_FAMILY] = getModelFamily(this.variant.id);
    placeholders[STANDARD_PLACEHOLDERS.CURRENT_DATE] = new Date().toISOString().split("T")[0];

    // Add all component sections
    Object.assign(placeholders, componentSections);

    // Add runtime placeholders with highest priority
    const runtimePlaceholders = (this.context as any).runtimePlaceholders;
    if (runtimePlaceholders) {
      Object.assign(placeholders, runtimePlaceholders);
    }

    return placeholders;
  }

  private postProcess(prompt: string): string {
    if (!prompt) return "";

    // Combine multiple regex operations for better performance
    return prompt
      .replace(/\n\s*\n\s*\n/g, "\n\n")     // Remove multiple consecutive empty lines
      .trim()                                // Remove leading/trailing whitespace
      .replace(/====+\s*$/, "")             // Remove trailing ==== after trim
      .replace(/\n====+\s*\n+\s*====+\n/g, "\n====\n") // Remove empty sections between separators
      .replace(/====\n([^\n])/g, "====\n\n$1")          // Ensure proper section separation
      .replace(/([^\n])\n====/g, "$1\n\n====");
  }
}
```

### 4. Template System

The template system uses `{{PLACEHOLDER}}` syntax for dynamic content injection:

```typescript
class TemplateEngine {
  resolve(template: string, placeholders: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      
      // Support nested object access using dot notation
      const value = this.getNestedValue(placeholders, trimmedKey);
      
      if (value !== undefined && value !== null) {
        return typeof value === "string" ? value : JSON.stringify(value);
      }
      
      // Keep placeholder if not found (allows for partial resolution)
      return match;
    });
  }

  extractPlaceholders(template: string): string[] {
    const placeholders: string[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match: RegExpExecArray | null = null;

    match = regex.exec(template);
    while (match !== null) {
      const placeholder = match[1].trim();
      if (!placeholders.includes(placeholder)) {
        placeholders.push(placeholder);
      }
      match = regex.exec(template);
    }

    return placeholders;
  }
}
```

**Base Template Example:**
```markdown
You are Cline, a highly skilled software engineer...

====

{{TOOL_USE_SECTION}}

====

{{MCP_SECTION}}

====

{{USER_INSTRUCTIONS_SECTION}}

====

{{SYSTEM_INFO_SECTION}}

====

{{TODO_SECTION}}
```

### 5. Component System

Components are reusable functions that generate specific sections of the prompt:

```typescript
type ComponentFunction = (
  variant: PromptVariant, 
  context: SystemPromptContext
) => Promise<string | undefined>;

// Example component
export async function getSystemInfo(
  variant: PromptVariant,
  context: SystemPromptContext,
): Promise<string> {
  const info = await getSystemEnv();

  // Support component overrides
  const template = variant.componentOverrides?.SYSTEM_INFO_SECTION?.template || `
Operating System: {{os}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
Current Working Directory: {{workingDir}}
  `;

  return new TemplateEngine().resolve(template, {
    os: info.os,
    shell: info.shell,
    homeDir: info.homeDir,
    workingDir: info.workingDir
  });
}
```

### 6. Tool System

Tools are managed through the `ClineToolSet` and can be configured per variant:

```typescript
class ClineToolSet {
  private static variants: Map<ModelFamily, Set<ClineToolSet>> = new Map();

  static register(config: ClineToolSpec): ClineToolSet {
    return new ClineToolSet(config.id, config);
  }

  static getTools(variant: ModelFamily): ClineToolSet[] {
    const toolsSet = ClineToolSet.variants.get(variant) || new Set();
    const defaultSet = ClineToolSet.variants.get(ModelFamily.GENERIC) || new Set();
    return toolsSet ? Array.from(toolsSet) : Array.from(defaultSet);
  }
}

// Tool generation in PromptBuilder
public static async getToolsPrompts(variant: PromptVariant, context: SystemPromptContext) {
  const tools = ClineToolSet.getTools(variant.family);
  
  // Filter and sort tools based on variant configuration
  const enabledTools = tools.filter((tool) => 
    !tool.config.contextRequirements || tool.config.contextRequirements(context)
  );

  let sortedEnabledTools = enabledTools;
  if (variant?.tools?.length) {
    const toolOrderMap = new Map(variant.tools.map((id, index) => [id, index]));
    sortedEnabledTools = enabledTools.sort((a, b) => {
      const orderA = toolOrderMap.get(a.config.id);
      const orderB = toolOrderMap.get(b.config.id);
      
      if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
      }
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return a.config.id.localeCompare(b.config.id);
    });
  }

  const ids = sortedEnabledTools.map((tool) => tool.config.id);
  return Promise.all(sortedEnabledTools.map((tool) => PromptBuilder.tool(tool.config, ids)));
}
```

## Configuration Examples

### Basic Variant Configuration (Using Builder Pattern)

```typescript
// variants/generic/config.ts
import { ModelFamily } from "@/shared/prompts";
import { ClineDefaultTool } from "@/shared/tools";
import { SystemPromptSection } from "../../templates/placeholders";
import { validateVariant } from "../../validation/VariantValidator";
import { createVariant } from "../builder";
import { baseTemplate } from "./template";

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.GENERIC)
  .description("The fallback prompt for generic use cases and models.")
  .version(1)
  .tags("fallback", "stable")
  .labels({
    stable: 1,
    fallback: 1,
  })
  .template(baseTemplate)
  .components(
    SystemPromptSection.AGENT_ROLE,
    SystemPromptSection.TOOL_USE,
    SystemPromptSection.MCP,
    SystemPromptSection.EDITING_FILES,
    SystemPromptSection.ACT_VS_PLAN,
    SystemPromptSection.TODO,
    SystemPromptSection.CAPABILITIES,
    SystemPromptSection.RULES,
    SystemPromptSection.SYSTEM_INFO,
    SystemPromptSection.OBJECTIVE,
    SystemPromptSection.USER_INSTRUCTIONS,
  )
  .tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    ClineDefaultTool.FILE_NEW,
    ClineDefaultTool.FILE_EDIT,
    ClineDefaultTool.SEARCH,
    ClineDefaultTool.LIST_FILES,
    ClineDefaultTool.LIST_CODE_DEF,
    ClineDefaultTool.BROWSER,
    ClineDefaultTool.MCP_USE,
    ClineDefaultTool.MCP_ACCESS,
    ClineDefaultTool.ASK,
    ClineDefaultTool.ATTEMPT,
    ClineDefaultTool.NEW_TASK,
    ClineDefaultTool.PLAN_MODE,
    ClineDefaultTool.MCP_DOCS,
    ClineDefaultTool.TODO,
  )
  .placeholders({
    MODEL_FAMILY: "generic",
  })
  .config({})
  .build();

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "generic" }, { strict: true });
if (!validationResult.isValid) {
  console.error("Generic variant configuration validation failed:", validationResult.errors);
  throw new Error(`Invalid generic variant configuration: ${validationResult.errors.join(", ")}`);
}

// Export type information for better IDE support
export type GenericVariantConfig = typeof config;
```

### Advanced Variant with Overrides (Using Builder Pattern)

```typescript
// variants/next-gen/config.ts
import { ModelFamily } from "@/shared/prompts";
import { ClineDefaultTool } from "@/shared/tools";
import { SystemPromptSection } from "../../templates/placeholders";
import { validateVariant } from "../../validation/VariantValidator";
import { createVariant } from "../builder";
import { baseTemplate, rules_template } from "./template";

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NEXT_GEN)
  .description("Prompt tailored to newer frontier models with smarter agentic capabilities.")
  .version(1)
  .tags("next-gen", "advanced", "production")
  .labels({
    stable: 1,
    production: 1,
    advanced: 1,
  })
  .template(baseTemplate)
  .components(
    SystemPromptSection.AGENT_ROLE,
    SystemPromptSection.TOOL_USE,
    SystemPromptSection.MCP,
    SystemPromptSection.EDITING_FILES,
    SystemPromptSection.ACT_VS_PLAN,
    SystemPromptSection.TODO,
    SystemPromptSection.CAPABILITIES,
    SystemPromptSection.FEEDBACK,  // Additional component for next-gen
    SystemPromptSection.RULES,
    SystemPromptSection.SYSTEM_INFO,
    SystemPromptSection.OBJECTIVE,
    SystemPromptSection.USER_INSTRUCTIONS,
  )
  .tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    ClineDefaultTool.FILE_NEW,
    ClineDefaultTool.FILE_EDIT,
    ClineDefaultTool.SEARCH,
    ClineDefaultTool.LIST_FILES,
    ClineDefaultTool.LIST_CODE_DEF,
    ClineDefaultTool.BROWSER,
    ClineDefaultTool.WEB_FETCH,  // Additional tool for next-gen
    ClineDefaultTool.MCP_USE,
    ClineDefaultTool.MCP_ACCESS,
    ClineDefaultTool.ASK,
    ClineDefaultTool.ATTEMPT,
    ClineDefaultTool.NEW_TASK,
    ClineDefaultTool.PLAN_MODE,
    ClineDefaultTool.MCP_DOCS,
    ClineDefaultTool.TODO,
  )
  .placeholders({
    MODEL_FAMILY: ModelFamily.NEXT_GEN,
  })
  .config({})
  // Override the RULES component with custom template
  .overrideComponent(SystemPromptSection.RULES, {
    template: rules_template,
  })
  .build();

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "next-gen" }, { strict: true });
if (!validationResult.isValid) {
  console.error("Next-gen variant configuration validation failed:", validationResult.errors);
  throw new Error(`Invalid next-gen variant configuration: ${validationResult.errors.join(", ")}`);
}

// Export type information for better IDE support
export type NextGenVariantConfig = typeof config;
```

### Compact Variant with Component Overrides

```typescript
// variants/xs/config.ts
import { ModelFamily } from "@/shared/prompts";
import { ClineDefaultTool } from "@/shared/tools";
import { SystemPromptSection } from "../../templates/placeholders";
import { validateVariant } from "../../validation/VariantValidator";
import { createVariant } from "../builder";
import { xsComponentOverrides } from "./overrides";
import { baseTemplate } from "./template";

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.XS)
  .description("Prompt for models with a small context window.")
  .version(1)
  .tags("local", "xs", "compact")
  .labels({
    stable: 1,
    production: 1,
    advanced: 1,
  })
  .template(baseTemplate)
  .components(
    SystemPromptSection.AGENT_ROLE,
    SystemPromptSection.RULES,
    SystemPromptSection.ACT_VS_PLAN,
    SystemPromptSection.CAPABILITIES,
    SystemPromptSection.EDITING_FILES,
    SystemPromptSection.OBJECTIVE,
    SystemPromptSection.SYSTEM_INFO,
    SystemPromptSection.USER_INSTRUCTIONS,
  )
  .tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    ClineDefaultTool.FILE_NEW,
    ClineDefaultTool.FILE_EDIT,
    ClineDefaultTool.SEARCH,
    ClineDefaultTool.LIST_FILES,
    ClineDefaultTool.ASK,
    ClineDefaultTool.ATTEMPT,
    ClineDefaultTool.NEW_TASK,
    ClineDefaultTool.PLAN_MODE,
    ClineDefaultTool.MCP_USE,
    ClineDefaultTool.MCP_ACCESS,
    ClineDefaultTool.MCP_DOCS,
  )
  .placeholders({
    MODEL_FAMILY: ModelFamily.XS,
  })
  .config({})
  .build();

// Apply component overrides after building the base configuration
// This is necessary because the builder pattern doesn't support bulk overrides
Object.assign(config.componentOverrides, xsComponentOverrides);

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "xs" }, { strict: true });
if (!validationResult.isValid) {
  console.error("XS variant configuration validation failed:", validationResult.errors);
  throw new Error(`Invalid XS variant configuration: ${validationResult.errors.join(", ")}`);
}

// Export type information for better IDE support
export type XsVariantConfig = typeof config;
```

### VariantBuilder API Reference

The `VariantBuilder` class provides a fluent, type-safe API for creating variant configurations:

```typescript
import { createVariant } from "../VariantBuilder";

const config = createVariant(ModelFamily.GENERIC)
  .description("Brief description of this variant")  // Required
  .version(1)                                        // Required, defaults to 1
  .tags("tag1", "tag2", "tag3")                     // Optional, can be chained
  .labels({ stable: 1, production: 1 })             // Optional
  .template(baseTemplate)                           // Required
  .components(                                      // Required, type-safe component selection
    SystemPromptSection.AGENT_ROLE,
    SystemPromptSection.TOOL_USE,
    // ... more components
  )
  .tools(                                          // Optional, type-safe tool selection
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_READ,
    // ... more tools
  )
  .placeholders({                                  // Optional
    MODEL_FAMILY: "generic",
    CUSTOM_PLACEHOLDER: "value",
  })
  .config({                                        // Optional, model-specific config
    temperature: 0.7,
    maxTokens: 4096,
  })
  .overrideComponent(SystemPromptSection.RULES, {  // Optional, component overrides
    template: customRulesTemplate,
  })
  .overrideTool(ClineDefaultTool.BASH, {          // Optional, tool overrides
    enabled: false,
  })
  .build();                                       // Returns Omit<PromptVariant, "id">
```

## Usage Examples

### Basic Usage

```typescript
// Initialize registry (done once at startup)
const registry = PromptRegistry.getInstance();
await registry.load();

// Get prompt for specific model
const prompt = await registry.get("claude-3-5-sonnet-20241022", context);

// Get prompt for next-gen model (automatically detects model family)
const prompt = await registry.get("claude-4-20250101", context);
```

### Version and Tag-based Retrieval

```typescript
// Get specific version
const prompt = await registry.getVersion("next-gen", 2, context);

// Get by tag/label with next-gen prioritization
const prompt = await registry.getByTag("claude-4", "production", undefined, context, true);

// Get by label
const prompt = await registry.getByTag("generic", undefined, "stable", context);
```

### Runtime Placeholder Resolution

```typescript
// Add runtime placeholders to context
context.runtimePlaceholders = {
  "USER_NAME": "John",
  "PROJECT_TYPE": "React",
  "CUSTOM_INSTRUCTION": "Focus on TypeScript best practices"
};

const prompt = await registry.get("next-gen", context);
```

## Model Family Detection

The system automatically detects model families based on model IDs:

```typescript
function getModelFamily(modelId: string): ModelFamily {
  // Check for next-gen models first
  if (isNextGenModel(modelId)) {
    return ModelFamily.NEXT_GEN;
  }
  
  if (modelId.includes("qwen")) {
    return ModelFamily.XS;
  }
  
  // Default fallback
  return ModelFamily.GENERIC;
}

function isNextGenModel(modelId: string): boolean {
  return (
    isClaude4ModelFamily(mockApiHandlerModel) ||
    isGemini2dot5ModelFamily(mockApiHandlerModel) ||
    isGrok4ModelFamily(mockApiHandlerModel) ||
    isGPT5ModelFamily(mockApiHandlerModel)
  );
}
```

## Available Components

The system includes the following built-in components:

- `AGENT_ROLE_SECTION`: Agent identity and role definition
- `TOOL_USE_SECTION`: Tool usage instructions and available tools
- `MCP_SECTION`: MCP server information and capabilities
- `EDITING_FILES_SECTION`: File editing guidelines and best practices
- `ACT_VS_PLAN_SECTION`: Action vs planning mode instructions
- `TODO_SECTION`: Todo management and task tracking
- `CAPABILITIES_SECTION`: Agent capabilities and limitations
- `FEEDBACK_SECTION`: Feedback and improvement instructions (next-gen only)
- `RULES_SECTION`: Behavioral rules and constraints
- `SYSTEM_INFO_SECTION`: System environment information
- `OBJECTIVE_SECTION`: Current task objective
- `USER_INSTRUCTIONS_SECTION`: User-provided custom instructions

## Available Tools

The system supports the following tools (mapped to `ClineDefaultTool` enum):

- `BASH`: Execute shell commands
- `FILE_READ`: Read file contents
- `FILE_NEW`: Create new files
- `FILE_EDIT`: Edit existing files
- `SEARCH`: Search through files
- `LIST_FILES`: List directory contents
- `LIST_CODE_DEF`: List code definitions
- `BROWSER`: Browser automation (conditional)
- `WEB_FETCH`: Web content fetching (next-gen only)
- `MCP_USE`: Use MCP tools
- `MCP_ACCESS`: Access MCP resources
- `ASK`: Ask follow-up questions
- `ATTEMPT`: Attempt task completion
- `NEW_TASK`: Create new tasks
- `PLAN_MODE`: Plan mode responses
- `MCP_DOCS`: Load MCP documentation
- `TODO`: Todo management

## Adding New Tools

### Tool Structure and Anatomy

Each tool in Cline follows a specific structure with variants for different model families. Here's the anatomy of a tool:

```typescript
// src/core/prompts/system-prompt/tools/my_new_tool.ts
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.MY_NEW_TOOL // Add to enum first

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "my_new_tool",
	description: "Description of what this tool does and when to use it",
	parameters: [
		{
			name: "required_param",
			required: true,
			instruction: "Description of this parameter and how to use it",
			usage: "Example value or placeholder text",
		},
		{
			name: "optional_param",
			required: false,
			instruction: "Description of optional parameter",
			usage: "Optional example (optional)",
			dependencies: [ClineDefaultTool.SOME_OTHER_TOOL], // Only show if dependency exists
		},
	],
}

// Create variants for different model families if needed
const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }
const gemini = { ...generic, variant: ModelFamily.GEMINI }

export const my_new_tool_variants = [generic, nextGen, gpt, gemini]
```

### Step-by-Step Instructions for Adding a New Tool

#### 1. Add Tool ID to Enum

First, add your tool ID to the `ClineDefaultTool` enum:

```typescript
// src/shared/tools.ts
export enum ClineDefaultTool {
	// ... existing tools
	MY_NEW_TOOL = "my_new_tool",
}
```

#### 2. Create Tool Specification File

Create a new file in `src/core/prompts/system-prompt/tools/` following the naming convention `{tool_name}.ts`:

```typescript
// src/core/prompts/system-prompt/tools/my_new_tool.ts
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.MY_NEW_TOOL

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "my_new_tool",
	description: "Comprehensive description of the tool's purpose, when to use it, and what it accomplishes. Be specific about use cases and limitations.",
	parameters: [
		{
			name: "input_parameter",
			required: true,
			instruction: "Clear instruction on what this parameter expects and how to format it",
			usage: "Example input here",
		},
		{
			name: "options",
			required: false,
			instruction: "Optional configuration or settings for the tool",
			usage: "Configuration options (optional)",
		},
	],
}

// Export variants array - this is crucial for registration
export const my_new_tool_variants = [generic]
```

#### 3. Export Tool from Index

Add your tool export to the tools index file:

```typescript
// src/core/prompts/system-prompt/tools/index.ts
export * from "./my_new_tool"
```

#### 4. Register Tool in Init File

Add your tool to the registration function:

```typescript
// src/core/prompts/system-prompt/tools/init.ts
import { my_new_tool_variants } from "./my_new_tool"

export function registerClineToolSets(): void {
	const allToolVariants = [
		// ... existing tool variants
		...my_new_tool_variants,
	]

	allToolVariants.forEach((v) => {
		ClineToolSet.register(v)
	})
}
```

#### 5. Implement Tool Handler (Backend)

Create the actual tool implementation in the appropriate handler:

```typescript
// In your tool handler class (e.g., ClineProvider)
async handleMyNewTool(args: { input_parameter: string; options?: string }) {
	// Implement your tool logic here
	const result = await performToolOperation(args.input_parameter, args.options)
	
	return {
		type: "tool_result" as const,
		content: result,
	}
}
```

### Advanced Tool Configuration

#### Context-Aware Tools

Tools can be conditionally enabled based on context:

```typescript
const contextAwareTool: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.CONTEXT_TOOL,
	name: "context_tool",
	description: "Tool that only appears in certain contexts",
	contextRequirements: (context: SystemPromptContext) => {
		// Only show this tool if browser support is available
		return context.supportsBrowserUse === true
	},
	parameters: [
		// ... parameters
	],
}
```

#### Model-Specific Variants

Create different tool behaviors for different model families:

```typescript
const claude: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.MODEL_SPECIFIC_TOOL,
	name: "model_specific_tool",
	description: "Tool optimized for Claude models with detailed instructions",
	parameters: [
		{
			name: "detailed_input",
			required: true,
			instruction: "Provide comprehensive details as Claude handles complex instructions well",
			usage: "Detailed input with context and examples",
		},
	],
}

const gpt: ClineToolSpec = {
	...claude,
	variant: ModelFamily.GPT,
	description: "Tool optimized for GPT models with concise instructions",
	parameters: [
		{
			name: "detailed_input",
			required: true,
			instruction: "Provide concise, structured input",
			usage: "Brief, structured input",
		},
	],
}

export const model_specific_tool_variants = [claude, gpt]
```

#### Parameter Dependencies

Tools can have parameters that only appear when other tools are available:

```typescript
const dependentTool: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.DEPENDENT_TOOL,
	name: "dependent_tool",
	description: "Tool with conditional parameters",
	parameters: [
		{
			name: "always_present",
			required: true,
			instruction: "This parameter is always available",
			usage: "Standard input",
		},
		{
			name: "conditional_param",
			required: false,
			instruction: "This parameter only appears if TODO tool is available",
			usage: "Conditional input (optional)",
			dependencies: [ClineDefaultTool.TODO],
		},
	],
}
```

### Best Practices

#### 1. Tool Naming Conventions
- Use snake_case for tool IDs and file names
- Use descriptive names that clearly indicate the tool's purpose
- Prefix with action verb when appropriate (e.g., `create_file`, `search_code`)

#### 2. Parameter Design
- Always provide clear, actionable instructions
- Include usage examples that show expected format
- Mark parameters as required/optional appropriately
- Use dependencies to avoid cluttering the prompt with irrelevant parameters

#### 3. Description Guidelines
- Be specific about when and why to use the tool
- Include limitations and constraints
- Mention any prerequisites or setup requirements
- Provide context about expected outcomes

#### 4. Model Variant Strategy
- Start with a GENERIC variant that works across all models
- Create specific variants only when models need different instructions
- Keep variant differences minimal and focused on instruction style
- Test across different model families to ensure compatibility

#### 5. Error Handling
- Design tools to fail gracefully
- Provide meaningful error messages
- Consider edge cases in parameter validation
- Document expected error scenarios

### Testing Your New Tool

#### 1. Unit Tests
Create unit tests for your tool specification:

```typescript
// src/core/prompts/system-prompt/tools/__tests__/my_new_tool.test.ts
import { my_new_tool_variants } from "../my_new_tool"
import { ModelFamily } from "@/shared/prompts"

describe("my_new_tool", () => {
	it("should have correct structure", () => {
		const generic = my_new_tool_variants.find(v => v.variant === ModelFamily.GENERIC)
		expect(generic).toBeDefined()
		expect(generic?.name).toBe("my_new_tool")
		expect(generic?.parameters).toHaveLength(2)
	})
})
```

#### 2. Integration Tests
Add your tool to the integration test suite:

```typescript
// src/core/prompts/system-prompt/__tests__/integration.test.ts
// The test will automatically pick up your tool if properly registered
```

#### 3. Manual Testing
1. Run the unit tests: `npm run test:unit`
2. Start the application and verify your tool appears in the system prompt
3. Test tool execution with various parameter combinations
4. Verify tool works across different model families

### Complete Example: File Analyzer Tool

Here's a complete example of adding a new "analyze_file" tool:

```typescript
// 1. Add to src/shared/tools.ts
export enum ClineDefaultTool {
	// ... existing tools
	ANALYZE_FILE = "analyze_file",
}

// 2. Create src/core/prompts/system-prompt/tools/analyze_file.ts
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.ANALYZE_FILE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "analyze_file",
	description: "Analyze a file's structure, dependencies, and potential issues. Use this when you need to understand a file's architecture, identify problems, or assess code quality before making changes.",
	parameters: [
		{
			name: "file_path",
			required: true,
			instruction: "The path to the file you want to analyze (relative to current working directory)",
			usage: "src/components/MyComponent.tsx",
		},
		{
			name: "analysis_type",
			required: false,
			instruction: "Type of analysis to perform: 'structure', 'dependencies', 'quality', or 'all'",
			usage: "all (optional)",
		},
		{
			name: "include_suggestions",
			required: false,
			instruction: "Whether to include improvement suggestions in the analysis",
			usage: "true (optional)",
		},
	],
}

const nextGen: ClineToolSpec = {
	...generic,
	variant: ModelFamily.NEXT_GEN,
	description: "Perform comprehensive file analysis including structure, dependencies, code quality, and improvement suggestions. Ideal for code review and refactoring planning.",
}

export const analyze_file_variants = [generic, nextGen]

// 3. Add to src/core/prompts/system-prompt/tools/index.ts
export * from "./analyze_file"

// 4. Add to src/core/prompts/system-prompt/tools/init.ts
import { analyze_file_variants } from "./analyze_file"

export function registerClineToolSets(): void {
	const allToolVariants = [
		// ... existing variants
		...analyze_file_variants,
	]
	// ... rest of function
}
```

This comprehensive guide should help developers understand both the architecture and practical steps needed to extend Cline with new tools.

## Key Features

- **Modular Components**: Reusable across different model variants  
- **Template System**: `{{placeholder}}` support with runtime resolution  
- **Versioning**: Full version control with tags and labels  
- **Model Family Detection**: Automatic model family detection and fallback  
- **Flexible Tool Configuration**: Per-variant tool selection and customization  
- **Component Overrides**: Custom templates for specific components  
- **Runtime Placeholders**: Dynamic value injection at build time  
- **Performance Optimized**: Efficient component building and template resolution  
- **Error Handling**: Graceful degradation when components fail  
- **Conditional Logic**: Context-aware tool and component inclusion