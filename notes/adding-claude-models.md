# Adding New Claude Models

This guide documents all the changes required when adding new Claude models to the codebase. There are two scenarios:
1. Adding a new Claude model (not as default)
2. Making a Claude model the new default

## Quick Reference: Files to Update

| File | Non-Default | New Default | Notes |
|------|:-----------:|:-----------:|-------|
| `src/shared/api.ts` | Yes | Yes | Model definitions, defaults, OpenRouter IDs |
| `src/core/controller/models/refreshOpenRouterModels.ts` | Maybe | Yes | Cache pricing, 1M variant creation |
| `src/core/api/transform/openrouter-stream.ts` | Yes | Yes | Cache control, maxTokens, reasoning |
| `src/core/api/transform/vercel-ai-gateway-stream.ts` | Maybe | Yes | 1M model check (if 1M variant) |
| `src/core/api/providers/bedrock.ts` | Maybe | Yes | JP cross-region inference list |
| `src/core/api/providers/requesty.ts` | Yes | Yes | Thinking args check |
| `webview-ui/.../AnthropicProvider.tsx` | Yes | Yes | Thinking models list, ContextWindowSwitcher |
| `webview-ui/.../BedrockProvider.tsx` | Yes | Yes | Thinking models list |
| `webview-ui/.../VertexProvider.tsx` | Yes | Yes | Thinking models list |
| `webview-ui/.../OpenRouterModelPicker.tsx` | Maybe | Yes | Featured models, switcher, budget slider |
| `webview-ui/.../VercelModelPicker.tsx` | Maybe | Yes | Budget slider check |
| `src/shared/cline/onboarding.ts` | No | Yes | Onboarding model list |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | No | Yes | Bug report template |
| `cli/src/index.ts` | No | Yes | CLI help text example |
| `docs/` (multiple files) | No | Yes | Documentation references |

---

## Part 1: Adding a New Claude Model (Non-Default)

Use this when adding models like a new Haiku version that won't be the default.

### 1. Add Model to `src/shared/api.ts`

#### Anthropic Models
```typescript
// In anthropicModels object
"claude-haiku-5-YYYYMMDD": {
    maxTokens: 8192,
    contextWindow: 200_000,
    supportsImages: true,
    supportsPromptCache: true,
    supportsReasoning: true,  // if model supports extended thinking
    inputPrice: X.X,
    outputPrice: X.X,
    cacheWritesPrice: X.XX,
    cacheReadsPrice: X.XX,
},
```

#### Claude Code Models
```typescript
// In claudeCodeModels object
"claude-haiku-5-YYYYMMDD": {
    ...anthropicModels["claude-haiku-5-YYYYMMDD"],
    supportsImages: false,  // Claude Code doesn't support images
    supportsPromptCache: false,  // Claude Code doesn't support prompt cache
},
```

#### Bedrock Models
```typescript
// In bedrockModels object
"anthropic.claude-haiku-5-YYYYMMDD-v1:0": {
    maxTokens: 8192,
    contextWindow: 200_000,
    supportsImages: true,
    supportsPromptCache: true,
    supportsReasoning: true,
    supportsGlobalEndpoint: true,  // if supports global endpoint
    inputPrice: X.X,
    outputPrice: X.X,
    cacheWritesPrice: X.XX,
    cacheReadsPrice: X.XX,
},
```

#### Vertex Models
```typescript
// In vertexModels object
"claude-haiku-5@YYYYMMDD": {
    maxTokens: 8192,
    contextWindow: 200_000,
    supportsImages: true,  // or false for Haiku
    supportsPromptCache: true,
    supportsReasoning: true,
    inputPrice: X.X,
    outputPrice: X.X,
    cacheWritesPrice: X.XX,
    cacheReadsPrice: X.XX,
},
```

### 2. Add to OpenRouter Stream (`src/core/api/transform/openrouter-stream.ts`)

Add the model to THREE switch cases:

```typescript
// 1. Prompt caching switch (around line 44)
switch (model.id) {
    case "anthropic/claude-haiku-5":  // ADD HERE
    case "anthropic/claude-sonnet-5":
    // ... existing cases

// 2. Max tokens switch (around line 113)
switch (model.id) {
    case "anthropic/claude-haiku-5":  // ADD HERE
    case "anthropic/claude-sonnet-5":
    // ... existing cases

// 3. Reasoning switch (around line 159)
switch (model.id) {
    case "anthropic/claude-haiku-5":  // ADD HERE (if supports reasoning)
    case "anthropic/claude-sonnet-5":
    // ... existing cases
```

### 3. Add to refreshOpenRouterModels.ts

Add to the cache pricing switch case:

```typescript
// In the switch (rawModel.id) block
case "anthropic/claude-haiku-5":
    modelInfo.supportsPromptCache = true
    modelInfo.cacheWritesPrice = X.XX
    modelInfo.cacheReadsPrice = X.XX
    break
```

### 4. Add to Thinking Models Lists

#### AnthropicProvider.tsx
```typescript
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
    "claude-haiku-5-YYYYMMDD",  // ADD if supports thinking
    // ... existing models
]
```

#### BedrockProvider.tsx
```typescript
export const SUPPORTED_BEDROCK_THINKING_MODELS = [
    "anthropic.claude-haiku-5-YYYYMMDD-v1:0",  // ADD if supports thinking
    // ... existing models
]
```

#### VertexProvider.tsx
```typescript
const SUPPORTED_THINKING_MODELS = [
    "claude-haiku-5@YYYYMMDD",  // ADD if supports thinking
    // ... existing models
]
```

### 5. Add to Budget Slider Checks (if supports thinking)

#### OpenRouterModelPicker.tsx and VercelModelPicker.tsx
```typescript
const showBudgetSlider = useMemo(() => {
    return (
        selectedModelId?.toLowerCase().includes("claude-haiku-5") ||  // ADD
        // ... existing checks
    )
}, [selectedModelId])
```

### 6. Add to Requesty Provider

```typescript
// In src/core/api/providers/requesty.ts
const thinkingArgs =
    model.id.includes("claude-haiku-5") ||  // ADD if supports thinking
    model.id.includes("claude-sonnet-5") ||
    // ... existing checks
```

### 7. Add to Bedrock JP Cross-Region List (if applicable)

```typescript
// In src/core/api/providers/bedrock.ts
const JP_SUPPORTED_CRIS_MODELS = [
    "anthropic.claude-haiku-5-YYYYMMDD-v1:0",  // ADD if JP supports it
    // ... existing models
]
```

---

## Part 2: Making a Model the New Default

When a new Sonnet version becomes the default, do everything in Part 1 PLUS:

### 1. Update Default Model IDs in `src/shared/api.ts`

```typescript
// Anthropic default
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-X-YYYYMMDD"

// Claude Code default
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-X-YYYYMMDD"

// Bedrock default
export const bedrockDefaultModelId: BedrockModelId = "anthropic.claude-sonnet-X-YYYYMMDD-v1:0"

// OpenRouter default
export const openRouterDefaultModelId = "anthropic/claude-sonnet-X"
```

### 2. Update Claude Code "sonnet" Alias

```typescript
// In claudeCodeModels
sonnet: {
    ...anthropicModels["claude-sonnet-X-YYYYMMDD"],  // UPDATE to new model
    supportsImages: false,
    supportsPromptCache: false,
},
```

### 3. Add 1M Context Window Variant

#### In api.ts - Add the :1m model variant
```typescript
// Anthropic
"claude-sonnet-X-YYYYMMDD:1m": {
    maxTokens: 8192,
    contextWindow: 1_000_000,
    supportsImages: true,
    supportsPromptCache: true,
    supportsReasoning: true,
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheWritesPrice: 3.75,
    cacheReadsPrice: 0.3,
    tiers: CLAUDE_SONNET_1M_TIERS,
},

// Bedrock
"anthropic.claude-sonnet-X-YYYYMMDD-v1:0:1m": {
    // ... same pattern with tiers
},
```

#### Update OpenRouter 1M model ID
```typescript
export const openRouterClaudeSonnetX1mModelId = `anthropic/claude-sonnet-X${CLAUDE_SONNET_1M_SUFFIX}`
```

### 4. Update refreshOpenRouterModels.ts for 1M Variant

```typescript
// Update import
import {
    openRouterClaudeSonnetX1mModelId,  // new ID
} from "@/shared/api"

// Update 1M variant creation
if (rawModel.id === "anthropic/claude-sonnet-X") {
    const claudeSonnet1mModelInfo = cloneDeep(modelInfo)
    claudeSonnet1mModelInfo.contextWindow = 1_000_000
    claudeSonnet1mModelInfo.tiers = CLAUDE_SONNET_1M_TIERS
    models[openRouterClaudeSonnetX1mModelId] = claudeSonnet1mModelInfo
}
```

### 5. Update Stream Files for 1M

#### openrouter-stream.ts
```typescript
import { openRouterClaudeSonnetX1mModelId } from "@shared/api"

const isClaudeSonnet1m = model.id === openRouterClaudeSonnetX1mModelId
```

#### vercel-ai-gateway-stream.ts
```typescript
import { openRouterClaudeSonnetX1mModelId } from "@shared/api"

const isClaudeSonnet1m = model.id === openRouterClaudeSonnetX1mModelId
```

### 6. Update ContextWindowSwitcher Components

#### AnthropicProvider.tsx
```typescript
{/* Context window switcher for Claude Sonnet X */}
<ContextWindowSwitcher
    base1mModelId={`claude-sonnet-X-YYYYMMDD${CLAUDE_SONNET_1M_SUFFIX}`}
    base200kModelId="claude-sonnet-X-YYYYMMDD"
    onModelChange={handleModelChange}
    selectedModelId={selectedModelId}
/>
```

#### OpenRouterModelPicker.tsx
```typescript
<ContextWindowSwitcher
    base1mModelId={`anthropic/claude-sonnet-X${CLAUDE_SONNET_1M_SUFFIX}`}
    base200kModelId="anthropic/claude-sonnet-X"
    onModelChange={handleModelChange}
    selectedModelId={selectedModelId}
/>
```

### 8. Update Featured Models in OpenRouterModelPicker.tsx

```typescript
export const recommendedModels = [
    {
        id: "anthropic/claude-sonnet-X",
        description: "Best balance of speed, cost, and quality",
        label: "BEST",
    },
    // ... other models
]
```

### 9. Update Onboarding Models

```typescript
// In src/shared/cline/onboarding.ts
{
    group: "frontier",
    id: "anthropic/claude-sonnet-X",
    name: "Anthropic: Claude Sonnet X",
    badge: "Best",
    // ...
},
```

### 10. Update Bug Report Template

```yaml
# .github/ISSUE_TEMPLATE/bug_report.yml
**Important:** All bug reports must be reproducible using Claude Sonnet X.
placeholder: 'e.g., cline:anthropic/claude-sonnet-X, ...'
```

### 11. Update CLI Help Text

```typescript
// cli/src/index.ts
.option("-m, --modelid <id>", "Model ID to configure (e.g., gpt-4o, claude-sonnet-X-YYYYMMDD)")
```

### 12. Update Documentation

Search and replace in `docs/` directory:
- Model selection guides
- Provider configuration docs
- Context window docs
- Any examples mentioning the old default

---

## Special Considerations

### Prompt Caching
Claude models support prompt caching with specific pricing. Always add:
- `supportsPromptCache: true` in model info
- `cacheWritesPrice` and `cacheReadsPrice`
- Add to the cache control switch in openrouter-stream.ts

### Extended Thinking/Reasoning
If the model supports extended thinking:
- Set `supportsReasoning: true` in model info
- Add to all thinking models lists
- Add to showBudgetSlider checks
- Add to requesty.ts thinking args

### Cross-Region Inference (Bedrock)
Some models support Japan cross-region inference. Add to `JP_SUPPORTED_CRIS_MODELS` if applicable.

### Global Endpoint (Vertex/Bedrock)
If the model supports global endpoints, set `supportsGlobalEndpoint: true`.

---

## Verification Checklist

After making changes:
1. Run `npm run compile` to verify no TypeScript errors
2. Search for old model references: `grep -rn "old-model-id" --include="*.ts" --include="*.tsx"`
3. Verify fallback behavior: users on removed models should fall back to new default
4. Test the ContextWindowSwitcher appears for the new model
5. Test thinking budget slider appears for models with reasoning support
