import { ApiConfiguration } from "@shared/api"

/**
 * Defines how provider configuration fields map to storage keys
 */
export interface ProviderFieldMapping {
	/** Fields that should be stored as secrets */
	secrets?: Record<string, string>
	/** Fields that should be stored in global state */
	globalState?: Record<string, string>
}

/**
 * Maps provider names to their field mappings
 * This defines how each provider's configuration fields map to storage keys
 * Only includes provider-specific configuration objects, not core fields like apiProvider, apiModelId, etc.
 */
export const PROVIDER_FIELD_MAPPINGS = {
	anthropic: {
		secrets: {
			apiKey: "apiKey",
		},
		globalState: {
			baseUrl: "anthropicBaseUrl",
		},
	},
	openrouter: {
		secrets: {
			apiKey: "openRouterApiKey",
		},
		globalState: {
			modelId: "openRouterModelId",
			modelInfo: "openRouterModelInfo",
			providerSorting: "openRouterProviderSorting",
		},
	},
	openai: {
		secrets: {
			apiKey: "openAiApiKey",
		},
		globalState: {
			modelId: "openAiModelId",
			modelInfo: "openAiModelInfo",
			baseUrl: "openAiBaseUrl",
			headers: "openAiHeaders",
		},
	},
	openaiNative: {
		secrets: {
			apiKey: "openAiNativeApiKey",
		},
	},
	aws: {
		secrets: {
			accessKey: "awsAccessKey",
			secretKey: "awsSecretKey",
			sessionToken: "awsSessionToken",
		},
		globalState: {
			region: "awsRegion",
			useCrossRegionInference: "awsUseCrossRegionInference",
			bedrockUsePromptCache: "awsBedrockUsePromptCache",
			bedrockEndpoint: "awsBedrockEndpoint",
			profile: "awsProfile",
			useProfile: "awsUseProfile",
			bedrockCustomSelected: "awsBedrockCustomSelected",
			bedrockCustomModelBaseId: "awsBedrockCustomModelBaseId",
		},
	},
	vertex: {
		globalState: {
			projectId: "vertexProjectId",
			region: "vertexRegion",
		},
	},
	ollama: {
		globalState: {
			modelId: "ollamaModelId",
			baseUrl: "ollamaBaseUrl",
			apiOptionsCtxNum: "ollamaApiOptionsCtxNum",
		},
	},
	lmstudio: {
		globalState: {
			modelId: "lmStudioModelId",
			baseUrl: "lmStudioBaseUrl",
		},
	},
	gemini: {
		secrets: {
			apiKey: "geminiApiKey",
		},
		globalState: {
			baseUrl: "geminiBaseUrl",
		},
	},
	litellm: {
		secrets: {
			apiKey: "liteLlmApiKey",
		},
		globalState: {
			modelId: "liteLlmModelId",
			baseUrl: "liteLlmBaseUrl",
			modelInfo: "liteLlmModelInfo",
			usePromptCache: "liteLlmUsePromptCache",
		},
	},
	fireworks: {
		secrets: {
			apiKey: "fireworksApiKey",
		},
		globalState: {
			modelId: "fireworksModelId",
			modelMaxCompletionTokens: "fireworksModelMaxCompletionTokens",
			modelMaxTokens: "fireworksModelMaxTokens",
		},
	},
	requesty: {
		secrets: {
			apiKey: "requestyApiKey",
		},
		globalState: {
			modelId: "requestyModelId",
			modelInfo: "requestyModelInfo",
		},
	},
	together: {
		secrets: {
			apiKey: "togetherApiKey",
		},
		globalState: {
			modelId: "togetherModelId",
		},
	},
	deepseek: {
		secrets: {
			apiKey: "deepSeekApiKey",
		},
	},
	qwen: {
		secrets: {
			apiKey: "qwenApiKey",
		},
		globalState: {
			apiLine: "qwenApiLine",
		},
	},
	doubao: {
		secrets: {
			apiKey: "doubaoApiKey",
		},
	},
	mistral: {
		secrets: {
			apiKey: "mistralApiKey",
		},
	},
	vscodelm: {
		globalState: {
			modelSelector: "vsCodeLmModelSelector",
		},
	},
	nebius: {
		secrets: {
			apiKey: "nebiusApiKey",
		},
	},
	asksage: {
		secrets: {
			apiKey: "asksageApiKey",
		},
		globalState: {
			apiUrl: "asksageApiUrl",
		},
	},
	xai: {
		secrets: {
			apiKey: "xaiApiKey",
		},
	},
	sambanova: {
		secrets: {
			apiKey: "sambanovaApiKey",
		},
	},
	cerebras: {
		secrets: {
			apiKey: "cerebrasApiKey",
		},
	},
	cline: {
		secrets: {
			apiKey: "clineApiKey",
		},
	},
} as const
