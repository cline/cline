import { createMistral } from "@ai-sdk/mistral";
import type { GatewayResolvedProviderConfig } from "@clinebot/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createMistralProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createMistral({
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
