# Prompt Composability Architecture

## Core Components Overview

  src/core/prompts/system-prompt/
  ├── registry/
  │   ├── PromptRegistry.ts          # Singleton registry for loading/managing prompts
  │   ├── PromptBuilder.ts           # Builds final prompts with template resolution
  │   ├── PromptVariant.ts           # Prompt variant definitions and metadata
  │   └── PromptCache.ts             # Caching layer for performance
  ├── components/                    # Reusable prompt components
  │   ├── system_info.ts            # System information section
  │   ├── mcp.ts                    # MCP servers section  
  │   ├── todo.ts                   # Todo management section
  │   ├── user_instructions.ts      # User custom instructions
  │   └── tools/                    # Tool-specific components
  │       ├── base_tools.ts
  │       ├── browser_tools.ts
  │       └── mcp_tools.ts
  ├── templates/                    # Template engine and placeholders
  │   ├── TemplateEngine.ts         # {{placeholder}} resolution
  │   ├── placeholders.ts           # Standard placeholder definitions
  │   └── validators.ts             # Template validation
  ├── variants/                     # Model-specific prompt variants
  │   ├── next-gen/
  │   │   ├── config.ts             # Model config + metadata (TypeScript)
  │   │   └── template.ts           # Base prompt template
  │   ├── generic/                  # Fallback variant
  │   └── index.ts                  # Variant registry exports
  └── utils/
      ├── version.ts                # Version management
      ├── tags.ts                   # Tag system
      └── config.ts                 # Configuration utilities

  1. PromptRegistry (Singleton)

  class PromptRegistry {
    private static instance: PromptRegistry;
    private variants: Map<string, PromptVariant> = new Map();
    private components: Map<string, ComponentFunction> = new Map();
    private loaded: boolean = false;

    static getInstance(): PromptRegistry {
      if (!this.instance) {
        this.instance = new PromptRegistry();
      }
      return this.instance;
    }

    // Load all prompts and components on initialization
    async load(context: SystemPromptContext): Promise<void> {
      if (this.loaded) return;

      // Load all variants from variants/ directory
      // Register all components from components/ directory
      // Build component dependency graph

      this.loaded = true;
    }

    // Get prompt by model ID with fallback to generic
    async get(modelId: string, context: SystemPromptContext): Promise<string> {
      let variant = this.variants.get(modelId);
      if (!variant) {
        // Fallback to generic variant
        variant = this.variants.get('generic');
      }

      const builder = new PromptBuilder(variant, context, this.components);
      return await builder.build();
    }

    // Get specific version of a prompt
    async getVersion(modelId: string, version: number, context: SystemPromptContext): Promise<string> {
      // Implementation for version-specific retrieval
    }

    // Get prompt by tag/label
    async getByTag(tag: string, label?: string, context?: SystemPromptContext): Promise<string> {
      // Implementation for tag-based retrieval
    }
  }

  2. PromptVariant Structure

  interface PromptVariant {
    id: string;                           // Model ID (e.g., "claude-4")
    version: number;                      // Version number
    tags: string[];                       // ["production", "beta", "experimental"]
    labels: { [key: string]: string };    // {"staging": "v1.2", "prod": "v1.1"}

    // Prompt configuration
    config: PromptConfig;                 // Model-specific config (temperature, etc.)
    baseTemplate: string;                 // Main prompt template
    componentOrder: string[];             // Ordered list of components to include
    componentOverrides: ComponentOverrides; // Component-specific customizations
    placeholders: { [key: string]: any }; // Default placeholder values
  }

  interface PromptConfig {
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolConfig[];
    // Other arbitrary JSON config
    [key: string]: any;
  }

  3. PromptBuilder

  class PromptBuilder {
    constructor(
      private variant: PromptVariant,
      private context: SystemPromptContext,
      private components: Map<string, ComponentFunction>
    ) {}

    async build(): Promise<string> {
      let prompt = this.variant.baseTemplate;

      // 1. Build all components in specified order
      const componentSections = await this.buildComponents();

      // 2. Resolve template placeholders
      prompt = await this.resolveTemplate(prompt, componentSections);

      // 3. Apply final processing
      return this.postProcess(prompt);
    }

    private async buildComponents(): Promise<{ [key: string]: string }> {
      const sections: { [key: string]: string } = {};

      for (const componentId of this.variant.componentOrder) {
        const componentFn = this.components.get(componentId);
        if (componentFn) {
          const result = await componentFn(this.variant, this.context);
          if (result) {
            sections[componentId] = result;
          }
        }
      }

      return sections;
    }

    private async resolveTemplate(template: string, components: { [key: string]: string }):
  Promise<string> {
      const templateEngine = new TemplateEngine();

      // Merge component results and default placeholders
      const placeholderValues = {
        ...this.variant.placeholders,
        ...components,
        ...this.context.runtimePlaceholders
      };

      return templateEngine.resolve(template, placeholderValues);
    }
  }

  4. Template System

  Base Template Example (variants/claude-4/system-prompt.md):
  You are Cline, a highly skilled software engineer...

  ====

  {{TOOL_USE_SECTION}}

  {{MCP_SECTION}}

  {{USER_INSTRUCTIONS}}

  ====

  SYSTEM INFORMATION

  {{SYSTEM_INFO}}

  ====

  {{TODO_SECTION}}

  Template Engine:
  class TemplateEngine {
    resolve(template: string, placeholders: { [key: string]: any }): string {
      return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return placeholders[key] || match; // Keep placeholder if not found
      });
    }
  }

  5. Component System

  Enhanced Component Interface:
  type ComponentFunction = (
    variant: PromptVariant, 
    context: SystemPromptContext
  ) => Promise<string | undefined>;

  // Example enhanced system_info component
  export async function getSystemInfo(
    variant: PromptVariant,
    context: SystemPromptContext,
  ): Promise<string> {
    const info = await getSystemEnv();

    // Support template placeholders within components
    const template = variant.componentOverrides?.system_info?.template || `
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

  6. Usage Examples

  // Initialize registry (done once at startup)
  const registry = PromptRegistry.getInstance();
  await registry.load(systemPromptContext);

  // Get prompt for specific model
  const prompt = await registry.get("claude-4", context);

  // Get specific version
  const prompt = await registry.getVersion("claude-4", 2, context);

  // Get by tag/label
  const prompt = await registry.getByTag("claude-4", "staging", context);

  // Runtime placeholder resolution
  context.runtimePlaceholders = {
    "USER_NAME": "John",
    "PROJECT_TYPE": "React"
  };
  const prompt = await registry.get("claude-4", context);

  7. Versioning & Tag System

  interface VersionMetadata {
    version: number;
    tags: string[];
    labels: { [label: string]: number }; // label -> version mapping
    changelog?: string;
    deprecated?: boolean;
    createdAt: Date;
  }

  // Version management
  class VersionManager {
    getLatestVersion(modelId: string): number;
    getVersionByLabel(modelId: string, label: string): number;
    addTag(modelId: string, version: number, tag: string): void;
    setLabel(modelId: string, version: number, label: string): void;
  }

  8. Configuration Structure

  Model Variant Config (variants/claude-4/config.ts):
  ```typescript
  import type { PromptVariant } from "../../types";
  import { ModelFamily } from "../../types";

  export const config: Omit<PromptVariant, "id" | "baseTemplate"> = {
    version: 1,
    family: ModelFamily.CLAUDE,
    tags: ["production", "latest"],
    labels: {
      stable: 1,
      staging: 2,
    },
    config: {
      modelName: "claude-3-5-sonnet-20241022",
      temperature: 0.7,
      maxTokens: 4096,
    },
    componentOrder: [
      "tool_use",
      "mcp_servers",
      "editing_files",
      "user_instructions",
      "system_info",
      "todo_management",
    ],
    componentOverrides: {},
    placeholders: {
      CWD: "{{context.cwd}}",
      SUPPORTS_BROWSER: "{{context.supportsBrowserUse}}",
    },
  };
  ```

  This architecture provides:

  ✅ Modular Components: Reusable across models
  ✅ Template System: {{placeholder}} support with runtime resolution✅ Versioning: Full version control
  with tags and labels
  ✅ Model-specific Variants: Custom prompts per model
  ✅ Fallback System: Generic variant as backup
  ✅ Flexible Configuration: Arbitrary JSON configs per variant
  ✅ Component Sharing: Same components used across different models
  ✅ Runtime Placeholders: Dynamic value injection

⏺ Update Todos
  ⎿  ☒ Examine current deprecated system prompt structure
     ☒ Analyze existing prompt components and context
     ☒ Design PromptRegistry architecture
     ☒ Design PromptBuilder workflow
     ☐ Create architectural diagram and workflow

⏺ 9. Workflow Diagram

  graph TB
      Start([Application Start]) --> Load[PromptRegistry.load()]
      Load --> ScanVariants[Scan variants/ directory]
      ScanVariants --> ScanComponents[Scan components/ directory]
      ScanComponents --> BuildDeps[Build component dependencies]
      BuildDeps --> Ready[Registry Ready]

      Ready --> Request[Request for model prompt]
      Request --> GetVariant{Find variant for model?}
      GetVariant -->|Found| UseVariant[Use model variant]
      GetVariant -->|Not Found| UseFallback[Use generic fallback]

      UseVariant --> Builder[PromptBuilder.build()]
      UseFallback --> Builder

      Builder --> BuildComps[Build components in order]
      BuildComps --> ResolveTemplate[Resolve {{placeholders}}]
      ResolveTemplate --> PostProcess[Post-process result]
      PostProcess --> FinalPrompt[Return final prompt]

      subgraph "Component Building"
          BuildComps --> C1[system_info]
          BuildComps --> C2[mcp_servers]
          BuildComps --> C3[user_instructions]
          BuildComps --> C4[todo_management]
          C1 --> CompResults[Component Results]
          C2 --> CompResults
          C3 --> CompResults
          C4 --> CompResults
      end

      subgraph "Template Resolution"
          ResolveTemplate --> TR1[Base template]
          ResolveTemplate --> TR2[Component sections]
          ResolveTemplate --> TR3[Runtime placeholders]
          TR1 --> Merge[Merge & substitute]
          TR2 --> Merge
          TR3 --> Merge
      end

  10. Implementation Workflow

  Phase 1: Foundation
  1. Create base interfaces and types
  2. Implement TemplateEngine for {{placeholder}} resolution
  3. Set up PromptRegistry singleton structure

  Phase 2: Core System
  1. Implement PromptBuilder with component orchestration
  2. Create variant loading system from filesystem
  3. Add version and tag management

  Phase 3: Migration
  1. Convert existing components to new format
  2. Create generic variant from deprecated system prompt
  3. Add model-specific variants (claude-4, claude-3-5-sonnet)

  Phase 4: Advanced Features
  1. Add caching layer for performance
  2. Implement component dependency resolution
  3. Add validation and error handling


## Basic Tool Selection

```typescript
// In your variant config
export const config: Omit<PromptVariant, "id"> = {
  // ... other config
  
  // Specify which tools to include and their order
  tools: [
    "read_file",
    "write_to_file", 
    "execute_command",
    "attempt_completion"
  ],
  
  // No tool overrides - use default templates
  toolOverrides: {}
};
```

## Tool Customization with Overrides

```typescript
export const config: Omit<PromptVariant, "id"> = {
  // ... other config
  
  tools: [
    "execute_command",
    "read_file", 
    "write_to_file",
    "replace_in_file",
    "attempt_completion"
  ],
  
  toolOverrides: {
    // Custom template for execute_command
    execute_command: {
      template: `## execute_command
Custom description for execute_command tool...
Parameters:
- command: (required) Custom parameter description
Usage:
<execute_command>
<command>Your command here</command>
</execute_command>`,
      enabled: true,
    },
    
    // Disable a specific tool
    replace_in_file: {
      enabled: false,
    },
    
    // Keep default template but ensure it's enabled
    read_file: {
      enabled: true,
    }
  }
};
```

## Minimal Tool Set

```typescript
// For a lightweight variant with only essential tools
export const minimalConfig: Omit<PromptVariant, "id"> = {
  // ... other config
  
  tools: [
    "read_file",
    "write_to_file", 
    "attempt_completion"
  ],
  
  toolOverrides: {}
};
```

## All Tools (Default Behavior)

```typescript
// If you don't specify tools array, all tools are included
export const allToolsConfig: Omit<PromptVariant, "id"> = {
  // ... other config
  
  // tools: undefined, // This will use DEFAULT_TOOL_ORDER
  
  toolOverrides: {
    // You can still override specific tools
    web_fetch: {
      enabled: false, // Disable web_fetch even though it's in default list
    }
  }
};
```

## Available Tool Names

The following tool names are available:

- `execute_command`
- `read_file`
- `write_to_file`
- `replace_in_file`
- `search_files`
- `list_files`
- `list_code_definition_names`
- `browser_action`
- `web_fetch`
- `use_mcp_tool`
- `access_mcp_resource`
- `ask_followup_question`
- `attempt_completion`
- `new_task`
- `plan_mode_respond`
- `load_mcp_documentation`

## Conditional Tool Inclusion

Some tools have built-in conditional logic:

- `browser_action`: Only included if `context.supportsBrowserUse` is true
- `web_fetch`: Only included for next-gen model family variants

Even if you specify these tools in your `tools` array, they will be filtered out if the conditions aren't met.