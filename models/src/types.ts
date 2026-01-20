export interface ModelInfo {
	// === Token Limits ===
	contextWindow: number
	maxOutputTokens: number

	// === Pricing (per million tokens in USD) ===
	pricing: {
		input: number
		output: number
		cacheWrite?: number
		cacheRead?: number
	}

	// === Tiered Pricing (for models with context-based pricing) ===
	pricingTiers?: {
		contextWindow: number
		input?: number
		output?: number
		cacheWrite?: number
		cacheRead?: number
	}[]

	// === Capabilities ===
	capabilities: {
		images?: boolean
		streaming?: boolean
		tools?: boolean
		promptCache?: boolean
	}

	// === Reasoning/Thinking ===
	reasoning?: {
		enabled?: boolean
		supportsEffortLevel?: boolean
		maxBudgetTokens?: number
		outputPrice?: number // price when thinking budget > 0
		// Gemini-specific
		thinkingLevel?: "low" | "high"
		supportsThinkingLevel?: boolean
	}

	// === API Configuration ===
	apiFormat?: ApiFormat
	temperature?: number
	systemRole?: string

	// === Provider-Specific ===
	supportsGlobalEndpoint?: boolean // Vertex AI

	// === Metadata ===
	description?: string

	deprecated?: boolean
}

export enum ApiFormat {
	ANTHROPIC_CHAT = 0,
	GEMINI_CHAT = 1,
	OPENAI_CHAT = 2,
	R1_CHAT = 3,
	OPENAI_RESPONSES = 4,
	UNRECOGNIZED = -1,
}
