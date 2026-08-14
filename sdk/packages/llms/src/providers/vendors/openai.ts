import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

function isChatGptOAuthBaseUrl(baseUrl: string | undefined): boolean {
	if (!baseUrl) {
		return false;
	}
	try {
		const { hostname } = new URL(baseUrl);
		return hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
	} catch {
		return false;
	}
}

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
	// OpenAI Responses API applies its own defaults, so gateway-synthesized
	// caps are never forwarded. Explicit caps — whether resolved by the
	// gateway from a caller request or passed straight to this provider —
	// are honored for API-key usage because that endpoint supports output
	// limits.
	const isChatGptOAuth = isChatGptOAuthBaseUrl(config.baseUrl);
	return {
		buildModelTools: (tools) => {
			const result: ReturnType<
				NonNullable<ProviderFactoryResult["buildModelTools"]>
			> = {};
			for (const tool of tools) {
				switch (tool.name) {
					case "web_search":
						result.web_search = { tool: provider.tools.webSearch() };
						break;
					case "image_generation":
						result.image_generation = {
							tool: provider.tools.imageGeneration({
								outputFormat: tool.outputFormat ?? "png",
							}),
							projectResult: (output) => {
								const record =
									output && typeof output === "object" && !Array.isArray(output)
										? (output as Record<string, unknown>)
										: undefined;
								if (
									typeof record?.result !== "string" ||
									record.result.length === 0
								) {
									throw new Error(
										"OpenAI image generation tool returned no supported image output",
									);
								}
								return {
									media: [
										{
											modality: "image",
											mediaType: `image/${tool.outputFormat ?? "png"}`,
											source: { type: "base64", data: record.result },
										},
									],
								};
							},
						};
						break;
				}
			}
			return result;
		},
		operations: {
			language: (modelId) => provider.responses(modelId),
			imageGeneration: (modelId) => provider.image(modelId),
		},
		buildStreamConfig: (request) => ({
			...(!isChatGptOAuth &&
			request.maxTokens !== undefined &&
			request.defaultedMaxTokens !== true
				? { maxOutputTokens: request.maxTokens }
				: {}),
			temperature: request.temperature,
		}),
	};
}
