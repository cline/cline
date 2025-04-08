export type ApiProvider = 'anthropic' | 'inkeep'

export type CompletionApiProvider = 'codestral'

export interface ApiHandlerOptions {
    apiModelId?: string
    posthogApiKey?: string
    thinkingEnabled?: boolean
}

export type ApiConfiguration = ApiHandlerOptions & {
    apiProvider?: ApiProvider
    completionApiProvider?: CompletionApiProvider
}

// Models

export interface ModelInfo {
    maxTokens?: number
    contextWindow?: number
    supportsImages?: boolean
    supportsComputerUse?: boolean
    description?: string
}

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models // prices updated 2025-01-02
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = 'claude-3-5-sonnet-20241022'
export const anthropicModels = {
    'claude-3-7-sonnet-20250219': {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: true,
        supportsComputerUse: true,
    },
    'claude-3-5-sonnet-20241022': {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: true,
        supportsComputerUse: true,
    },
    'claude-3-5-haiku-20241022': {
        maxTokens: 8192,
        contextWindow: 200_000,
        supportsImages: false,
    },
    'claude-3-opus-20240229': {
        maxTokens: 4096,
        contextWindow: 200_000,
        supportsImages: true,
    },
    'claude-3-haiku-20240307': {
        maxTokens: 4096,
        contextWindow: 200_000,
        supportsImages: true,
    },
} as const satisfies Record<string, ModelInfo> // as const assertion makes the object deeply readonly

export const autocompleteDefaultModelId: string = 'codestral-latest'
