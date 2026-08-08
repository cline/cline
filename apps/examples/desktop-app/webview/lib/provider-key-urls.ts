/**
 * Where users create API keys for well-known providers. The provider
 * catalog's `docUrl` wins when present, but the catalog does not populate it
 * today, so this curated map covers the providers a new user is most likely
 * to bring a key from. Everything else simply renders no link.
 */
const PROVIDER_API_KEY_URLS: Record<string, string> = {
	anthropic: "https://console.anthropic.com/settings/keys",
	"openai-native": "https://platform.openai.com/api-keys",
	openai: "https://platform.openai.com/api-keys",
	openrouter: "https://openrouter.ai/settings/keys",
	gemini: "https://aistudio.google.com/apikey",
	xai: "https://console.x.ai",
	groq: "https://console.groq.com/keys",
	mistral: "https://console.mistral.ai/api-keys",
	deepseek: "https://platform.deepseek.com/api_keys",
	cerebras: "https://cloud.cerebras.ai",
	fireworks: "https://app.fireworks.ai/settings/users/api-keys",
	together: "https://api.together.ai/settings/api-keys",
	cline: "https://app.cline.bot",
};

/** Cline account dashboard, where Cline API keys are created and managed. */
export const CLINE_DASHBOARD_URL = "https://app.cline.bot";

/**
 * Resolve the "get an API key" URL for a provider, preferring the catalog's
 * own `docUrl` and falling back to the curated map of popular providers.
 */
export function getProviderApiKeyUrl(provider: {
	id: string;
	docUrl?: string;
}): string | null {
	const docUrl = provider.docUrl?.trim();
	if (docUrl) {
		return docUrl;
	}
	return PROVIDER_API_KEY_URLS[provider.id.trim().toLowerCase()] ?? null;
}
