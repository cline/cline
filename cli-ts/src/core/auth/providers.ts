/**
 * API Provider definitions for authentication
 */

/**
 * Provider information for authentication
 */
export interface ProviderInfo {
	/** Provider identifier */
	id: string
	/** Display name */
	name: string
	/** Description for the interactive wizard */
	description: string
	/** Whether this provider requires an API key */
	requiresApiKey: boolean
	/** Environment variable name for API key (if any) */
	envVar?: string
	/** URL to get an API key */
	keyUrl?: string
	/** Whether this provider supports OAuth */
	supportsOAuth?: boolean
}

/**
 * Available API providers
 */
export const PROVIDERS: ProviderInfo[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Direct access to Claude models via Anthropic API",
		requiresApiKey: true,
		envVar: "ANTHROPIC_API_KEY",
		keyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Access multiple AI providers through a single API",
		requiresApiKey: true,
		envVar: "OPENROUTER_API_KEY",
		keyUrl: "https://openrouter.ai/keys",
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "Access to GPT models via OpenAI API",
		requiresApiKey: true,
		envVar: "OPENAI_API_KEY",
		keyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "bedrock",
		name: "AWS Bedrock",
		description: "AWS Bedrock with Claude and other models (uses AWS credentials from environment or ~/.aws/credentials)",
		requiresApiKey: false,
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Access to Gemini models via Google AI API",
		requiresApiKey: true,
		envVar: "GOOGLE_API_KEY",
		keyUrl: "https://aistudio.google.com/app/apikey",
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Local models via Ollama (no API key required)",
		requiresApiKey: false,
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local models via LM Studio (no API key required)",
		requiresApiKey: false,
	},
]

/**
 * Get provider by ID
 */
export function getProviderById(id: string): ProviderInfo | undefined {
	return PROVIDERS.find((p) => p.id === id)
}

/**
 * Get all provider IDs
 */
export function getProviderIds(): string[] {
	return PROVIDERS.map((p) => p.id)
}

/**
 * Check if a provider ID is valid
 */
export function isValidProviderId(id: string): boolean {
	return PROVIDERS.some((p) => p.id === id)
}
