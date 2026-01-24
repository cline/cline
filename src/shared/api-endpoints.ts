/**
 * API Endpoints Configuration
 *
 * This file contains all default base URLs and endpoints for API providers.
 * Centralized management of API endpoints for easier maintenance and updates.
 */

export interface ApiEndpointConfig {
	baseUrl?: string
	description?: string
}

/**
 * Default API endpoints for each provider
 */
export const API_ENDPOINTS = {
	// Anthropic
	anthropic: {
		baseUrl: "https://api.anthropic.com",
		description: "Anthropic Claude API",
	},

	// OpenAI
	openai: {
		baseUrl: "https://api.openai.com/v1",
		description: "OpenAI API",
	},

	// OpenRouter
	openrouter: {
		baseUrl: "https://openrouter.ai/api/v1",
		description: "OpenRouter API",
	},

	// AWS Bedrock
	bedrock: {
		description: "AWS Bedrock - Region-specific endpoints",
	},

	// Google Vertex AI
	vertex: {
		description: "Google Vertex AI - Region and project-specific endpoints",
	},

	// Google Gemini
	gemini: {
		baseUrl: "https://generativelanguage.googleapis.com",
		description: "Google Gemini API",
	},

	// Ollama
	ollama: {
		baseUrl: "http://localhost:11434",
		description: "Ollama local API",
	},

	// LM Studio
	lmstudio: {
		baseUrl: "http://localhost:1234/v1",
		description: "LM Studio local API",
	},

	// DeepSeek
	deepseek: {
		baseUrl: "https://api.deepseek.com",
		description: "DeepSeek API",
	},

	// Qwen
	qwen: {
		international: {
			baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
			description: "Qwen International API",
		},
		china: {
			baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			description: "Qwen China API",
		},
	},

	// Qwen Code
	qwenCode: {
		baseUrl: "https://chat.qwen.ai",
		description: "Qwen Code Chat API",
	},

	// Doubao
	doubao: {
		baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		description: "Doubao (ByteDance) API",
	},

	// Mistral
	mistral: {
		baseUrl: "https://api.mistral.ai/v1",
		description: "Mistral AI API",
	},

	// LiteLLM
	litellm: {
		baseUrl: "http://localhost:4000",
		description: "LiteLLM Proxy",
	},

	// Moonshot
	moonshot: {
		international: {
			baseUrl: "https://api.moonshot.cn/v1",
			description: "Moonshot International API",
		},
		china: {
			baseUrl: "https://api.moonshot.cn/v1",
			description: "Moonshot China API",
		},
	},

	// Nebius
	nebius: {
		baseUrl: "https://api.studio.nebius.ai/v1",
		description: "Nebius AI Studio API",
	},

	// Fireworks
	fireworks: {
		baseUrl: "https://api.fireworks.ai/inference/v1",
		description: "Fireworks AI API",
	},

	// AskSage
	asksage: {
		baseUrl: "https://api.asksage.ai/server",
		description: "AskSage API",
	},

	// X.AI (Grok)
	xai: {
		baseUrl: "https://api.x.ai/v1",
		description: "X.AI Grok API",
	},

	// SambaNova
	sambanova: {
		baseUrl: "https://api.sambanova.ai/v1",
		description: "SambaNova API",
	},

	// Cerebras
	cerebras: {
		baseUrl: "https://api.cerebras.ai/v1",
		description: "Cerebras Inference API",
	},

	// Groq
	groq: {
		baseUrl: "https://api.groq.com/openai/v1",
		description: "Groq API",
	},

	// Hugging Face
	huggingface: {
		baseUrl: "https://api-inference.huggingface.co/models",
		description: "Hugging Face Inference API",
	},

	// SAP AI Core
	sapaicore: {
		description: "SAP AI Core - Customer-specific endpoints",
	},

	// Requesty
	requesty: {
		baseUrl: "https://api.requesty.ai/v1",
		description: "Requesty API",
	},

	// Together AI
	together: {
		baseUrl: "https://api.together.xyz/v1",
		description: "Together AI API",
	},

	// Baseten
	baseten: {
		baseUrl: "https://model-<model-id>.api.baseten.co/production/predict",
		description: "Baseten Model API",
	},

	// Huawei Cloud MaaS
	huaweiCloudMaas: {
		baseUrl: "https://pangu.cn-southwest-2.myhuaweicloud.com",
		description: "Huawei Cloud MaaS API",
	},

	// Dify
	dify: {
		baseUrl: "http://localhost/v1",
		description: "Dify.ai Workflow API",
	},

	// Vercel AI Gateway
	vercelAiGateway: {
		baseUrl: "https://gateway.ai.cloudflare.com/v1",
		description: "Vercel AI Gateway",
	},

	// Z.AI (GLM)
	zai: {
		international: {
			baseUrl: "https://open.bigmodel.cn/api/paas/v4",
			description: "Z.AI International API",
		},
		china: {
			baseUrl: "https://open.bigmodel.cn/api/paas/v4",
			description: "Z.AI China API",
		},
	},

	// OCA (OpenAI Compatible API)
	oca: {
		internal: {
			baseUrl: "https://api.oca.ai/v1",
			description: "OCA Internal API",
		},
		external: {
			baseUrl: "https://api.oca.ai/v1",
			description: "OCA External API",
		},
	},

	// AIHubMix
	aihubmix: {
		baseUrl: "https://api.aihubmix.com/v1",
		description: "AIHubMix API",
	},

	// Minimax
	minimax: {
		international: {
			baseUrl: "https://api.minimax.chat/v1",
			description: "Minimax International API",
		},
		china: {
			baseUrl: "https://api.minimax.chat/v1",
			description: "Minimax China API",
		},
	},

	// Hicap
	hicap: {
		baseUrl: "https://api.hicap.ai/v1",
		description: "Hicap API",
	},

	// Nous Research
	nousresearch: {
		baseUrl: "https://api.nousresearch.com/v1",
		description: "Nous Research API",
	},

	// Claude Code
	claudeCode: {
		description: "Claude Code - Local CLI path",
	},

	// VS Code LM
	vscodeLm: {
		description: "VS Code Language Model API",
	},

	// Cline Provider
	cline: {
		baseUrl: "https://api.cline.bot/v1",
		description: "Cline Provider API",
	},

	// OpenTelemetry
	opentelemetry: {
		baseUrl: "http://localhost:4318",
		description: "OpenTelemetry OTLP Endpoint",
	},
} as const

/**
 * Get default base URL for a provider
 */
export function getDefaultBaseUrl(provider: string, region?: string): string | undefined {
	const endpoint = API_ENDPOINTS[provider as keyof typeof API_ENDPOINTS]

	if (!endpoint) {
		return undefined
	}

	// Handle providers with regional endpoints
	if ("international" in endpoint && "china" in endpoint) {
		return region === "china" ? endpoint.china.baseUrl : endpoint.international.baseUrl
	}

	// Handle providers with mode-specific endpoints
	if ("internal" in endpoint && "external" in endpoint) {
		return region === "external" ? endpoint.external.baseUrl : endpoint.internal.baseUrl
	}

	// Return simple baseUrl
	return "baseUrl" in endpoint ? endpoint.baseUrl : undefined
}

/**
 * Get endpoint description
 */
export function getEndpointDescription(provider: string): string | undefined {
	const endpoint = API_ENDPOINTS[provider as keyof typeof API_ENDPOINTS]

	if (!endpoint) {
		return undefined
	}

	if ("description" in endpoint) {
		return endpoint.description
	}

	return undefined
}
