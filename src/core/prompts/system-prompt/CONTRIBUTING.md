# Contributing to System Prompts and Model Configuration

This guide explains how to add new model families and configure custom system prompts for contributors from model labs / providers.

> **⚡ Key Principle: Fallback to GENERIC**
>
> The system uses automatic fallbacks to minimize configuration:
> - **No matching variant?** → Falls back to `GENERIC` variant
> - **No tool variant for model family?** → Falls back to `GENERIC` tool variant
> - **No component override?** → Uses shared component from `components/`
>
> **This means:** Only customize what's necessary. Start minimal, add specifics only when needed.

## Table of Contents

1. [Glossary](#glossary)
2. [Architecture Overview](#architecture-overview)
3. [Creating a Model Family](#creating-a-model-family)
4. [Configuring System Prompts](#configuring-system-prompts)
5. [Configuring Tool Calling](#configuring-tool-calling)
6. [Configuring API Request/Response Shapes](#configuring-api-requestresponse-shapes)
7. [Adding Model-Specific Tools](#adding-model-specific-tools)
8. [Testing](#testing)

---

## Glossary

### Model Family
A category grouping models with similar capabilities and behavior patterns. Each family has an optimized system prompt variant.

**Examples:** `NEXT_GEN` (Claude 4+, GPT-5, Gemini 2.5), `GENERIC` (fallback), `XS` (small models)

**Location:** [`src/shared/prompts.ts`](../../shared/prompts.ts) `ModelFamily` enum

### System Prompt Variant
A complete configuration for a model family, including:
- Component selection and ordering
- Tool configuration
- Template with placeholders
- Matcher function determining when to use it

**Location:** [`variants/*/config.ts`](./variants/)

### Matcher Function
Function that determines if a variant applies to a given model and context. Returns `true` if the variant should be used.

```typescript
.matcher((context) => {
    const modelId = context.providerInfo.model.id.toLowerCase()
    return modelId.includes("gpt-5") && context.enableNativeToolCalls
})
```

### Native Tool Calling
Modern approach where tools are sent to the model via the provider's native API (e.g., OpenAI function calling, Anthropic tool use). More reliable than XML-based calling.

**Characteristics:**
- Tools passed separately via API (not embedded in system prompt)
- Structured tool calls in API response (JSON)
- Requires `enableNativeToolCalls` setting enabled
- Indicated by `use_native_tools: 1` label in variant config

**Supported providers:** OpenAI, Anthropic, Gemini, OpenRouter, Minimax

### XML (Text-Based) Tool Calling
Traditional approach where tools are described in the system prompt and the model outputs tool calls as XML tags in text.

**Characteristics:**
- Tools embedded in system prompt as XML format instructions
- Model generates XML: `<tool_name><param>value</param></tool_name>`
- Client parses XML from text response
- Works with any model that can follow instructions

### API Format
Defines the request/response structure for a model provider's API. Different formats have different message structures and capabilities.

**Values:** `ANTHROPIC_CHAT`, `GEMINI_CHAT`, `OPENAI_CHAT`, `R1_CHAT`, `OPENAI_RESPONSES`

**Location:** [`proto/cline/models.proto`](../../../proto/cline/models.proto)

**Usage:** `model.info.apiFormat` determines how requests/responses are structured

### Component
A reusable function that generates a section of the system prompt (e.g., `AGENT_ROLE`, `RULES`, `CAPABILITIES`). Components can be shared or overridden per-variant.

**Location:** [`components/`](./components/)

### Tool Specification
Defines how a tool appears in the system prompt for a specific model family. Multiple variants can exist for the same tool.

**Example:** [`tools/write_to_file.ts`](./tools/write_to_file.ts) defines `GENERIC`, `NATIVE_NEXT_GEN`, and `NATIVE_GPT_5` variants

---

## Architecture Overview

### Fallback Behavior

The system uses **automatic fallbacks** to ensure robustness:

1. **Variant Selection Fallback:**
   - If no variant matcher returns `true`, falls back to `GENERIC` variant
   - `GENERIC` is the universal fallback that works with all models

2. **Tool Variant Fallback:**
   - If a tool doesn't define a variant for the current model family, automatically falls back to `GENERIC` tool variant
   - Handled by `ClineToolSet.getToolByNameWithFallback()`
   - **You only need to export model-specific tool variants when behavior differs from `GENERIC`**

3. **Component Fallback:**
   - If a variant doesn't override a component, uses the shared component from [`components/`](./components/)
   - Only override when model needs custom instructions
   - Example: Most variants use shared `AGENT_ROLE`, but override `RULES` for model-specific behavior

**This means:** When adding a new model family, you can start with minimal configuration and only customize what's necessary.

### System Prompt Generation Flow

```
User Request
    ↓
Model Detection (model-utils.ts)
    ↓
Variant Selection (matcher functions) → Falls back to GENERIC if no match
    ↓
Component Building (components/) → Uses shared components unless overridden
    ↓
Tool Configuration (tools/) → Falls back to GENERIC tool variant if not defined
    ↓
Template Resolution ({{PLACEHOLDER}})
    ↓
Final System Prompt
```

### Key Files

| Purpose | File |
|---------|------|
| Model detection | [`src/utils/model-utils.ts`](../../../utils/model-utils.ts) |
| Model family enum | [`src/shared/prompts.ts`](../../shared/prompts.ts) |
| Tool enum | [`src/shared/tools.ts`](../../shared/tools.ts) |
| Variant registry | [`variants/index.ts`](./variants/index.ts) |
| Tool registry | [`tools/init.ts`](./tools/init.ts) |

---

## Creating a Model Family

### Step 1: Add Model Detection Logic

Add helper functions to [`src/utils/model-utils.ts`](../../../utils/model-utils.ts):

```typescript
// Add detector function
export function isMyNewModelFamily(id: string): boolean {
    const modelId = normalize(id)
    return modelId.includes("my-model") || modelId.includes("my-model-v2")
}

// If it's a next-gen model, add to isNextGenModelFamily()
export function isNextGenModelFamily(id: string): boolean {
    return (
        isClaude4PlusModelFamily(modelId) ||
        // ... existing checks
        isMyNewModelFamily(modelId)  // Add here
    )
}

// If it's a next-gen provider, add to isNextGenModelProvider()
export function isNextGenModelProvider(providerInfo: ApiProviderInfo): boolean {
    const providerId = normalize(providerInfo.providerId)
    return [
        "anthropic", "openai", "gemini", "openrouter",
        "my-new-provider",  // Add here
    ].some((id) => providerId === id)
}
```

### Step 2: Add Model Family Enum

Add to `ModelFamily` enum in [`src/shared/prompts.ts`](../../shared/prompts.ts):

```typescript
export enum ModelFamily {
    CLAUDE = "claude",
    GPT_5 = "gpt-5",
    NEXT_GEN = "next-gen",
    MY_NEW_MODEL = "my-new-model",  // Add here
}
```

### Step 3: Create Variant Configuration

Create [`variants/my-new-model/config.ts`](./variants/):

```typescript
import { isMyNewModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"

export const config = createVariant(ModelFamily.MY_NEW_MODEL)
    .description("Optimized for My New Model")
    .version(1)
    .tags("production", "my-model")
    .labels({
        stable: 1,
        production: 1,
        // Add use_native_tools: 1 if native tool calling supported
    })
    .matcher((context) => {
        const modelId = context.providerInfo.model.id
        return isMyNewModelFamily(modelId)
    })
    // Template: Structure with placeholders that will be replaced
    .template(`{{AGENT_ROLE_SECTION}}

====

{{TOOL_USE_SECTION}}

====

{{RULES_SECTION}}

====

{{OBJECTIVE_SECTION}}`)
    // Components: Which sections to include (must match template placeholders)
    .components(
        SystemPromptSection.AGENT_ROLE,
        SystemPromptSection.TOOL_USE,
        SystemPromptSection.RULES,
        SystemPromptSection.OBJECTIVE,
    )
    .tools(
        ClineDefaultTool.BASH,
        ClineDefaultTool.FILE_READ,
        ClineDefaultTool.ASK,
    )
    .placeholders({
        MODEL_FAMILY: ModelFamily.MY_NEW_MODEL,
    })
    .config({})
    .build()

// Validation
const validationResult = validateVariant({ ...config, id: ModelFamily.MY_NEW_MODEL }, { strict: true })
if (!validationResult.isValid) {
    throw new Error(`Invalid config: ${validationResult.errors.join(", ")}`)
}

export type MyNewModelVariantConfig = typeof config
```

**How Templates and Placeholders Work:**

The `.template()` defines the **structure** of your system prompt using placeholders like `{{AGENT_ROLE_SECTION}}`, `{{RULES_SECTION}}`, etc.

**Placeholder Resolution Process:**

1. **Component Building:** Each component in `.components()` generates content by calling its function from [`components/`](./components/)
   - `SystemPromptSection.AGENT_ROLE` → generates `{{AGENT_ROLE_SECTION}}` content
   - `SystemPromptSection.RULES` → generates `{{RULES_SECTION}}` content
   - etc.

2. **Default vs Override:**
   - **By default:** Uses shared component from [`components/`](./components/) (e.g., [`components/rules.ts`](./components/rules.ts))
   - **With override:** Uses your custom template instead

3. **Template Resolution:** The `TemplateEngine` replaces all `{{PLACEHOLDERS}}` with generated content

**Example with Override:**

```typescript
import { CUSTOM_AGENT_ROLE } from "./template"

export const config = createVariant(ModelFamily.MY_NEW_MODEL)
    .template(`{{AGENT_ROLE_SECTION}}

{{RULES_SECTION}}`)
    .components(
        SystemPromptSection.AGENT_ROLE,  // Will use override below
        SystemPromptSection.RULES,        // Will use shared components/rules.ts
    )
    // Override AGENT_ROLE to use custom template
    .overrideComponent(SystemPromptSection.AGENT_ROLE, {
        template: CUSTOM_AGENT_ROLE,  // Your custom content
    })
    .build()
```

**Result:**
- `{{AGENT_ROLE_SECTION}}` → Replaced with `CUSTOM_AGENT_ROLE` content (overridden)
- `{{RULES_SECTION}}` → Replaced with shared `components/rules.ts` content (default)

See [`variants/native-gpt-5-1/config.ts`](./variants/native-gpt-5-1/config.ts) for a real example with multiple overrides.

### Step 4: Register Variant

Add to [`variants/index.ts`](./variants/index.ts):

```typescript
export { config as myNewModelConfig } from "./my-new-model/config"
import { config as myNewModelConfig } from "./my-new-model/config"

export const VARIANT_CONFIGS = {
    // ... existing variants
    [ModelFamily.MY_NEW_MODEL]: myNewModelConfig,
} as const
```

---

## Configuring System Prompts

### Basic Configuration

See [Step 3 above](#step-3-create-variant-configuration) for basic variant structure.

### Component Overrides

**Default behavior:** If you don't override a component, the variant automatically uses the shared component from [`components/`](./components/).

**Only override when:**
- Model needs custom instructions for a specific section
- Default component doesn't work well for the model
- Model has unique capabilities requiring different guidance

**To override a component:**

**Create [`variants/my-new-model/template.ts`](./variants/):**

```typescript
export const CUSTOM_RULES_TEMPLATE = `
# Rules for My New Model

1. Use specific syntax optimized for this model
2. Avoid patterns this model struggles with
3. Leverage unique capabilities
`
```

**Update `config.ts`:**

```typescript
import { CUSTOM_RULES_TEMPLATE } from "./template"

export const config = createVariant(ModelFamily.MY_NEW_MODEL)
    // ... other configuration
    .overrideComponent(SystemPromptSection.RULES, {
        template: CUSTOM_RULES_TEMPLATE,
    })
    .build()
```

### Available Components

You can include/exclude these in `.components()`:

- `AGENT_ROLE` - Agent identity and role
- `TOOL_USE` - Tool usage instructions
- `TASK_PROGRESS` - Task progress tracking
- `MCP` - MCP server information
- `EDITING_FILES` - File editing guidelines
- `ACT_VS_PLAN` - Action vs planning mode
- `CAPABILITIES` - Agent capabilities
- `FEEDBACK` - Feedback and improvement
- `RULES` - Behavioral rules
- `SYSTEM_INFO` - System environment info
- `OBJECTIVE` - Current task objective
- `USER_INSTRUCTIONS` - User custom instructions
- `TODO` - Todo management

See [`components/`](./components/) for implementations.

### Available Tools

Common tools to include in `.tools()`:

- `BASH` - Execute shell commands
- `FILE_READ`, `FILE_NEW`, `FILE_EDIT` - File operations
- `SEARCH`, `LIST_FILES`, `LIST_CODE_DEF` - Code search
- `BROWSER`, `WEB_FETCH` - Web operations
- `MCP_USE`, `MCP_ACCESS` - MCP integration
- `ASK`, `ATTEMPT` - Task management
- `PLAN_MODE`, `ACT_MODE` - Mode switching
- `TODO` - Todo management

See [`src/shared/tools.ts`](../../shared/tools.ts) for full list.

---

## Configuring Tool Calling

### Native Tool Calling

**When to use:** Provider supports native function calling and `enableNativeToolCalls` is enabled.

**Example:** [`variants/native-next-gen/config.ts`](./variants/native-next-gen/config.ts)

```typescript
export const config = createVariant(ModelFamily.NATIVE_NEXT_GEN)
    .labels({
        use_native_tools: 1,  // Enable native tool calling
    })
    .matcher((context) => {
        if (!context.enableNativeToolCalls) {
            return false
        }
        if (!isNextGenModelProvider(context.providerInfo)) {
            return false
        }
        return isNextGenModelFamily(context.providerInfo.model.id)
    })
    // ... rest of configuration
```

**Key points:**
- Set `use_native_tools: 1` label
- Check `context.enableNativeToolCalls` in matcher
- Check provider supports native tools via `isNextGenModelProvider()`
- Tools sent separately via API, not embedded in prompt

### XML Tool Calling

**When to use:** Provider doesn't support native tools OR `enableNativeToolCalls` is disabled.

**Example:** [`variants/next-gen/config.ts`](./variants/next-gen/config.ts)

```typescript
export const config = createVariant(ModelFamily.NEXT_GEN)
    .matcher((context) => {
        const providerInfo = context.providerInfo
        // Use this variant if next-gen BUT native tools disabled
        if (isNextGenModelFamily(providerInfo.model.id) && !context.enableNativeToolCalls) {
            return true
        }
        // OR if provider doesn't support native tools
        return !isNextGenModelProvider(providerInfo) && isNextGenModelFamily(providerInfo.model.id)
    })
    .tools(
        // Include MCP_USE for XML-based tool calling
        ClineDefaultTool.MCP_USE,  // Instead of MCP_ACCESS
        // ... other tools
    )
```

**Key points:**
- Don't set `use_native_tools` label
- Check native tools are disabled OR provider doesn't support them
- Include detailed tool descriptions in system prompt
- Use `MCP_USE` instead of `MCP_ACCESS`

### Decision Flow

```
Is enableNativeToolCalls enabled?
  NO → Use XML variant
  YES → Does provider support native tools?
      NO → Use XML variant
      YES → Does model support native tools?
          NO → Use XML variant
          YES → Use native variant
```

---

## Configuring API Request/Response Shapes

### Setting API Format

API formats are defined in [`proto/cline/models.proto`](../../../proto/cline/models.proto):

```protobuf
enum ApiFormat {
    ANTHROPIC_CHAT = 0;      // Messages API
    GEMINI_CHAT = 1;         // Gemini generateContent
    OPENAI_CHAT = 2;         // Chat Completions API
    R1_CHAT = 3;             // DeepSeek R1 format
    OPENAI_RESPONSES = 4;    // Responses API (GPT-5.1+)
}
```

### Using API Format in Provider Code

**Example from [`src/core/api/providers/openai-native.ts`](../../api/providers/openai-native.ts):**

```typescript
async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
    // Route based on API format
    if (tools?.length && this.getModel()?.info?.apiFormat === ApiFormat.OPENAI_RESPONSES) {
        yield* this.createResponseStream(systemPrompt, messages, tools)
    } else {
        yield* this.createCompletionStream(systemPrompt, messages, tools)
    }
}
```

### Format Comparison

| Format | Provider | Tool Support | System Prompt | Special Features |
|--------|----------|--------------|---------------|------------------|
| `ANTHROPIC_CHAT` | Anthropic | Native (input_schema) | Content blocks | Caching, thinking |
| `GEMINI_CHAT` | Gemini/Vertex | Native (function_declarations) | String | Thinking levels |
| `OPENAI_CHAT` | OpenAI, OpenRouter | Native (function) | String | Reasoning effort |
| `R1_CHAT` | DeepSeek R1 | Limited | String | Reasoning-focused |
| `OPENAI_RESPONSES` | GPT-5.1+ | Native (strict mode) | String | Structured outputs |

### Adding a New API Format

1. **Add to proto:** [`proto/cline/models.proto`](../../../proto/cline/models.proto)
2. **Regenerate:** `npm run protos`
3. **Import:** `import { ApiFormat } from "@/shared/proto/cline/models"`
4. **Handle in provider:** Add format-specific logic in your provider handler

See existing providers in [`src/core/api/providers/`](../../api/providers/) for examples.

---

## Adding Model-Specific Tools

### When to Create Model-Specific Tool Variants

**Default behavior:** Tools automatically fall back to `GENERIC` variant via `ClineToolSet.getToolByNameWithFallback()`.

**Only create a model-specific tool variant when:**
- Tool needs different parameters or descriptions for the model
- Tool requires model-specific instructions
- Tool behavior differs significantly across models

**Examples requiring specific variants:**
- Native tool calling models need absolute paths vs relative paths
- Models with different context handling need adjusted descriptions
- Models with specific quirks need tailored instructions

**Important:** If you only export `[GENERIC]` from your tool file, all model families will use it automatically. You don't need to create variants for every model family.

### Creating a Tool Variant

**Example from [`tools/write_to_file.ts`](./tools/write_to_file.ts):**

```typescript
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.FILE_NEW

const GENERIC: ClineToolSpec = {
    variant: ModelFamily.GENERIC,
    id,
    name: "write_to_file",
    description: "Request to write content to a file...",
    parameters: [
        {
            name: "path",
            required: true,
            instruction: "The path of the file to write to (relative to {{CWD}})",
            usage: "File path here",
        },
        {
            name: "content",
            required: true,
            instruction: "The content to write. ALWAYS provide COMPLETE content.",
            usage: "Your file content here",
        },
    ],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
    variant: ModelFamily.NATIVE_NEXT_GEN,
    id,
    name: "write_to_file",
    description: "[IMPORTANT: Always output absolutePath first] Request to write...",
    parameters: [
        {
            name: "absolutePath",
            required: true,
            instruction: "The absolute path to the file.",
        },
        {
            name: "content",
            required: true,
            instruction: "After providing path, use this for content.",
        },
    ],
}

export const write_to_file_variants = [GENERIC, NATIVE_NEXT_GEN]
```

### Key Differences in Tool Variants

**GENERIC (XML-based):**
- Relative paths (with `{{CWD}}` placeholder)
- Verbose instructions
- XML usage examples

**NATIVE_NEXT_GEN (Native calling):**
- Absolute paths (clearer for structured API)
- Concise instructions
- Parameter ordering hints (e.g., "Always output X first")

### Registering Tool Variants

**1. Export from [`tools/index.ts`](./tools/index.ts):**
```typescript
export * from "./write_to_file"
```

**2. Register in [`tools/init.ts`](./tools/init.ts):**
```typescript
import { write_to_file_variants } from "./write_to_file"

export function registerClineToolSets(): void {
    const allToolVariants = [
        ...write_to_file_variants,
        // ... other tool variants
    ]

    allToolVariants.forEach((v) => ClineToolSet.register(v))
}
```

### Adding Tool to Variant Configs

**Update all relevant variant configs** in [`variants/*/config.ts`](./variants/) to include the tool:

```typescript
.tools(
    ClineDefaultTool.BASH,
    ClineDefaultTool.FILE_NEW,  // Add your tool here
    // ... other tools
)
```

**Important:** If you add a tool to a variant's config, ensure either:
1. The tool exports a spec for that `ModelFamily`, OR
2. The tool exports a `GENERIC` spec (automatic fallback)

**Note:** When a variant includes a tool in `.tools()` but the tool doesn't have a specific variant for that model family, the system automatically uses the `GENERIC` variant. This is handled by `ClineToolSet.getToolByNameWithFallback()`, so you don't need to manually define variants for every model family—only when behavior needs to differ.

---

## Testing

### Running Tests

```bash
# Run tests (fails if snapshots don't match)
npm run test:unit

# Update snapshots after intentional changes
npm run test:unit -- --update-snapshots
# OR
UPDATE_SNAPSHOTS=true npm run test:unit
```

### Snapshot Tests

**Location:** [`__tests__/__snapshots__/`](./__tests__/__snapshots__/)

**What's tested:**
- System prompts generate correctly for each model family
- Prompts remain consistent across contexts (browser, MCP, focus chain)
- Component ordering and overrides work correctly
- Tool specifications properly included

**Test file:** [`__tests__/integration.test.ts`](./__tests__/integration.test.ts)

### Testing in Debug Mode

**For live testing with real models**, run Cline in debug mode to verify your variant works correctly:

1. **Enable Debug Mode:**
   - See the main [CONTRIBUTING.md](../../../../CONTRIBUTING.md) for instructions on running Cline in debug mode
   - Debug mode enables additional features for testing and verification

2. **Run a Task with Your Model:**
   - Configure your model in Cline settings
   - Start a conversation or task with the model
   - The system will automatically select your variant based on the matcher function

3. **Export Task JSON (Debug Mode Only):**
   - After the task completes, click the **task header** in the chat
   - Look for the **export JSON** option (only available in debug mode)
   - Export the task JSON file

4. **Verify Your Configuration:**
   - Open the exported JSON file
   - Search for `"systemPrompt"` to see the full generated system prompt
   - Verify:
     - Correct variant was selected
     - All placeholders resolved correctly
     - Component overrides applied
     - Tools included as expected
     - Template structure matches your config

**Example verification:**
```json
{
  "systemPrompt": "You are Cline...\n\n====\n\n# Agent Role\n...",
  "modelFamily": "my-new-model",
  "tools": ["bash", "file_read", "ask"],
  // ... rest of task data
}
```

This exported JSON is invaluable for debugging and verifying that your variant configuration is working as intended in real-world usage.

### Manual Testing Checklist

1. **Verify variant selection:**
   - Confirm correct variant selected for test model IDs
   - Check matcher logic returns true/false as expected
   - Use exported JSON to verify `modelFamily` matches expected value

2. **Test tool conversion:**
   - Verify tools converted to correct format (native vs XML)
   - Check provider-specific tool format matches expectations
   - Review tools in exported JSON to confirm correct conversion

3. **Validate prompt structure:**
   - Confirm all `{{PLACEHOLDERS}}` resolved in exported JSON
   - Check section ordering matches config
   - Verify overrides applied correctly by inspecting `systemPrompt` field

4. **Test across contexts:**
   - With/without browser support
   - With/without MCP servers
   - With/without native tool calling enabled
   - Export JSON for each context to compare differences

---

## Additional Resources

- **System Prompt Architecture:** [README.md](./README.md)
- **Tool Development:** [tools/README.md](./tools/README.md)
- **Testing Guide:** [__tests__/README.md](./__tests__/README.md)
- **Model Utilities:** [`src/utils/model-utils.ts`](../../../utils/model-utils.ts)
- **Proto Definitions:** [`proto/cline/models.proto`](../../../proto/cline/models.proto)
- **CLAUDE.md:** [`CLAUDE.md`](../../../../CLAUDE.md) (tribal knowledge)

---

## Quick Reference

### Common File Locations

```
src/
├── shared/
│   ├── prompts.ts              # ModelFamily enum
│   └── tools.ts                # ClineDefaultTool enum
├── utils/
│   └── model-utils.ts          # Model detection functions
├── core/
│   ├── api/providers/          # API provider handlers
│   └── prompts/system-prompt/
│       ├── components/         # Shared prompt components
│       ├── tools/              # Tool specifications
│       ├── variants/           # Model family configs
│       │   ├── generic/
│       │   ├── next-gen/
│       │   ├── native-next-gen/
│       │   └── [family]/
│       │       ├── config.ts   # Variant configuration
│       │       └── template.ts # Custom templates
│       └── registry/           # Core logic
│           ├── PromptRegistry.ts
│           ├── PromptBuilder.ts
│           └── ClineToolSet.ts
proto/
└── cline/
    └── models.proto            # ApiFormat enum
```

### Common Patterns

**Model detection:**
```typescript
export function isMyModelFamily(id: string): boolean {
    return normalize(id).includes("my-model")
}
```

**Variant matcher:**
```typescript
.matcher((context) => isMyModelFamily(context.providerInfo.model.id))
```

**Component override:**
```typescript
.overrideComponent(SystemPromptSection.RULES, { template: CUSTOM_TEMPLATE })
```

**Native tools check:**
```typescript
.matcher((context) =>
    context.enableNativeToolCalls &&
    isNextGenModelProvider(context.providerInfo)
)
```

---

For questions or issues, consult existing variant configurations in [`variants/`](./variants/) or review the model detection logic in [`model-utils.ts`](../../../utils/model-utils.ts).
