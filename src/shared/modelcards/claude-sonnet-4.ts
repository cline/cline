// Claude 4 Sonnet Configuration
// Update these values when the model is officially released

// Display name and documentation
export const CLAUDE_4_SONNET_DISPLAY_NAME = "Claude 4 Sonnet"
export const CLAUDE_4_SONNET_DOC_URL = "https://www.anthropic.com/claude/sonnet" // Update when official URL is available

// Date component of model ID (update on release)
export const CLAUDE_4_SONNET_DATE = "YYYYMMDD" // Placeholder format, e.g., "20250520"

// Base model information
export const CLAUDE_4_SONNET = {
	// Model IDs for different providers
	IDS: {
		// Direct Anthropic API
		ANTHROPIC: `claude-4-sonnet-${CLAUDE_4_SONNET_DATE}`,

		// AWS Bedrock
		BEDROCK: `anthropic.claude-4-sonnet-${CLAUDE_4_SONNET_DATE}-v1:0`,

		// Google Vertex AI
		VERTEX: `claude-4-sonnet@${CLAUDE_4_SONNET_DATE}`,

		// OpenRouter (supports multiple formats)
		OPENROUTER: {
			DEFAULT: "anthropic/claude-4-sonnet",
			BETA: "anthropic/claude-4-sonnet:beta",
			HYPHENATED: "anthropic/claude-4-sonnet", // Format for hyphenated version
			DOTTED: "anthropic/claude-4.0-sonnet", // Format for dotted version
			THINKING: "anthropic/claude-4-sonnet:thinking",
		},

		// Requesty
		REQUESTY: "anthropic/claude-4-sonnet-latest",
	},

	// Model specifications (may need updating on release)
	SPECS: {
		MAX_TOKENS: 8192,
		CONTEXT_WINDOW: 200000,
		SUPPORTS_IMAGES: true,
		SUPPORTS_PROMPT_CACHE: true,
		INPUT_PRICE: 3.0, // per million tokens
		OUTPUT_PRICE: 15.0, // per million tokens
		CACHE_WRITES_PRICE: 3.75,
		CACHE_READS_PRICE: 0.3,
		THINKING_MAX_BUDGET: 64000,
	},

	// Model description
	DESCRIPTION:
		"Claude 4 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities compared to previous Claude models. It features enhanced contextual understanding and more precise responses to complex prompts. The model excels at coding tasks and document analysis, while maintaining Anthropic's focus on safety and helpfulness.\n\nFull details will be available upon official release.",
}

// Export convenience functions for getting full model IDs
export function getAnthropicModelId(): string {
	return CLAUDE_4_SONNET.IDS.ANTHROPIC
}

export function getBedrockModelId(): string {
	return CLAUDE_4_SONNET.IDS.BEDROCK
}

export function getVertexModelId(): string {
	return CLAUDE_4_SONNET.IDS.VERTEX
}

export function getOpenRouterModelId(): string {
	return CLAUDE_4_SONNET.IDS.OPENROUTER.DEFAULT
}
