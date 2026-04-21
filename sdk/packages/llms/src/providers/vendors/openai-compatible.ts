import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@clinebot/shared";
import {
	allowsMissingOpenAiCompatibleApiKey,
	getMissingApiKeyError,
	resolveApiKey,
} from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createOpenAICompatibleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	if (
		!apiKey &&
		!allowsMissingOpenAiCompatibleApiKey(context.provider.id, config)
	) {
		throw new Error(
			getMissingApiKeyError(context.provider.id, context.provider.apiKeyEnv),
		);
	}
	const provider = createOpenAICompatible({
		name: context.provider.id,
		apiKey,
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		...(config.fetch ? { fetch: config.fetch } : {}),
		includeUsage: true,
	} as never);
	return {
		model: (modelId) => provider(modelId),
	};
}
