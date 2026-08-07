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

/**
 * Label for a "get an API key" link: picks "a"/"an" by the provider name's
 * leading vowel (OpenAI, Anthropic, …) and falls back to the generic
 * "Get an API key" when no provider is selected.
 */
export function getProviderApiKeyLinkLabel(name?: string): string {
	const trimmed = name?.trim();
	if (!trimmed) {
		return "Get an API key";
	}
	const article = /^[aeiou]/i.test(trimmed) ? "an" : "a";
	return `Get ${article} ${trimmed} API key`;
}
