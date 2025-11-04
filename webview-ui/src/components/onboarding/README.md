# Onboarding Models Pattern

## Overview

The onboarding model selection uses a **Single Source of Truth** pattern to avoid duplicating model definitions between `src/shared/api.ts` and the webview.

## Architecture

### Files Involved

1. **`src/shared/api.ts`** - Contains complete model definitions with capabilities
2. **`data-models.ts`** - Contains only UI-specific metadata (score, speed, badge)

### How It Works

```typescript
// 1. Define only UI-specific metadata
const ONBOARDING_MODEL_METADATA = {
  power: {
    "anthropic/claude-sonnet-4.5": {
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      badge: "Best",
      score: 97,
      speed: "Fast",
    }
  }
}

// 2. Reference the source model from api.ts
const MODEL_SOURCE_MAP: Record<string, ModelInfo> = {
  "anthropic/claude-sonnet-4.5": openRouterDefaultModelInfo,
}

// 3. Merge them together
const model = createOnboardingModel(
  ONBOARDING_MODEL_METADATA.power["anthropic/claude-sonnet-4.5"],
  MODEL_SOURCE_MAP["anthropic/claude-sonnet-4.5"]
)
```

## Benefits

✅ **No Duplication** - Model capabilities (contextWindow, prices, etc.) are only defined once in `api.ts`  
✅ **Automatic Updates** - Changes to model specs in `api.ts` automatically propagate to onboarding  
✅ **Clear Separation** - UI metadata (score, badge) is separate from technical specs  
✅ **Type Safety** - TypeScript ensures consistency between definitions  

## Adding a New Model

To add a new model to the onboarding flow:

### Step 1: Add the model metadata

```typescript
const ONBOARDING_MODEL_METADATA = {
  power: {
    "new-provider/new-model": {
      id: "new-provider/new-model",
      name: "Provider: Model Name",
      badge: "New",      // Optional: "Best", "Trending", "Free"
      score: 85,         // Performance score 0-100
      speed: "Fast",     // "Fast", "Average", or "Slow"
    }
  }
}
```

### Step 2: Map to source model

If the model exists in `api.ts`:
```typescript
const MODEL_SOURCE_MAP: Record<string, ModelInfo> = {
  "new-provider/new-model": providerModels["model-id"],
}
```

If the model doesn't exist in `api.ts` yet:
```typescript
const MODEL_SOURCE_MAP: Record<string, ModelInfo> = {
  "new-provider/new-model": {
    maxTokens: 8192,
    contextWindow: 128000,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 1.0,
    outputPrice: 5.0,
  },
}
```

### Step 3: Add to selection list

```typescript
export const ONBOARDING_MODEL_SELECTIONS = {
  power: [
    {
      group: "frontier",
      models: [
        createOnboardingModel(
          ONBOARDING_MODEL_METADATA.power["new-provider/new-model"],
          MODEL_SOURCE_MAP["new-provider/new-model"],
        ),
      ]
    }
  ]
}
```

## Important Notes

- **Never duplicate** `maxTokens`, `contextWindow`, `inputPrice`, `outputPrice`, etc. in onboarding metadata
- **Always reference** the source model from `api.ts` when available
- **Only add** UI-specific properties: `name`, `badge`, `score`, `speed`
- **Keep in sync** - When a model is added to `api.ts`, update the source map reference

## Migration from Old Pattern

**Before (duplicated):**
```typescript
{
  id: "anthropic/claude-sonnet-4.5",
  name: "Anthropic: Claude Sonnet 4.5",
  badge: "Best",
  score: 97,
  speed: "Fast",
  contextWindow: 200000,        // ❌ Duplicated
  supportsImages: true,         // ❌ Duplicated
  supportsPromptCache: true,    // ❌ Duplicated
  inputPrice: 3.0,              // ❌ Duplicated
  outputPrice: 15.0,            // ❌ Duplicated
}
```

**After (referenced):**
```typescript
// Metadata only
const metadata = {
  id: "anthropic/claude-sonnet-4.5",
  name: "Anthropic: Claude Sonnet 4.5",
  badge: "Best",
  score: 97,
  speed: "Fast",
}

// Source from api.ts
const source = openRouterDefaultModelInfo

// Merged automatically
const model = createOnboardingModel(metadata, source)
