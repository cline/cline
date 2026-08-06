import type { Provider } from "@/lib/provider-schema";

/**
 * Whether a provider from the catalog is usable for turns, for the purpose
 * of the first-run "connect a model" notice. Beyond plain API keys and
 * OAuth, structured-config providers (Bedrock, Vertex) count once every
 * required field is filled, and keyless providers (local endpoints like
 * Ollama) count once the user has deliberately enabled them.
 */
export function isProviderConnected(provider: Provider): boolean {
	if (provider.apiKey?.trim()) {
		return true;
	}
	if (provider.oauthAccessTokenPresent) {
		return true;
	}
	if (!provider.enabled) {
		return false;
	}
	const fields = provider.configFields ?? [];
	const requiredFields = fields.filter((field) => field.required);
	if (requiredFields.length > 0) {
		return requiredFields.every((field) => {
			const value = provider.configValues?.[field.path];
			if (value === null || value === undefined) {
				return false;
			}
			return String(value).trim() !== "";
		});
	}
	// No required fields: keyless providers are connected once enabled, but
	// an enabled provider with an (optional) empty API key field is not.
	return !fields.some((field) => field.path === "apiKey");
}
