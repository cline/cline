import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createOpenAIProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createOpenAI({
		apiKey,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		name: context.provider.id,
	});
	// The ChatGPT OAuth Codex backend rejects `max_output_tokens`, and the
	// OpenAI Responses API applies its own defaults, so synthesized gateway
	// caps are never forwarded. Explicit caller caps are still honored for
	// API-key usage because that endpoint supports output limits.
	const isChatGptOAuth = !!config.baseUrl?.includes("chatgpt.com");
	return {
		model: (modelId) => provider.responses(modelId),
		buildStreamConfig: (request) => ({
			...(!isChatGptOAuth &&
			typeof request.requestedMaxTokens === "number" &&
			request.maxTokens !== undefined
				? { maxOutputTokens: request.maxTokens }
				: {}),
			temperature: request.temperature,
		}),
	};
}
