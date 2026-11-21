import { ProviderSettingsManager } from "@cline/core";

/**
 * Ask an OpenAI-compatible endpoint for its model list (`GET <baseUrl>/models`)
 * using the provider's stored API key and headers, mirroring the extension's
 * refreshOpenAiModels handler. Returns [] on any failure so callers fall back
 * to manual model-id entry.
 */
export async function fetchOpenAiCompatibleModelIds(
	providerId: string,
): Promise<string[]> {
	try {
		const manager = new ProviderSettingsManager();
		const config = manager.getProviderConfig(providerId, {
			includeKnownModels: false,
		});
		const baseUrl = config?.baseUrl?.trim().replace(/\/+$/, "");
		if (!baseUrl || !URL.canParse(baseUrl)) return [];

		const headers: Record<string, string> = { ...(config?.headers ?? {}) };
		const apiKey =
			config?.apiKey?.trim() ||
			// The openai-compatible provider declares OPENAI_API_KEY as its
			// apiKeyEnv. The agent request path already honors this, but the
			// model-list fetch only read config.apiKey, so listing models failed
			// when the key lived only in the environment. Fall back to the env
			// var for that provider to match the request path. Gate on the id so
			// this never sends OPENAI_API_KEY to an unrelated provider.
			(providerId === "openai-compatible"
				? process.env.OPENAI_API_KEY?.trim()
				: undefined);
		if (
			apiKey &&
			!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")
		) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(`${baseUrl}/models`, {
			headers,
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) return [];
		const payload = (await response.json()) as { data?: unknown };
		const list = Array.isArray(payload?.data) ? payload.data : [];
		const ids = list
			.map((model) => {
				const id = (model as { id?: unknown } | null)?.id;
				return typeof id === "string" ? id.trim() : "";
			})
			.filter(Boolean);
		return [...new Set(ids)];
	} catch {
		return [];
	}
}
