import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import {
	assertChatGPTPlanGrant,
	CHATGPT_PLAN_API,
	chatGPTPlanFetch,
} from "../chatgpt-plan";
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
	const isChatGPTPlan = context.provider.id === "openai-chatgpt";
	if (isChatGPTPlan) {
		assertChatGPTPlanGrant(config.options?.chatgptPlan);
		if (
			config.baseUrl &&
			config.baseUrl.replace(/\/$/, "") !== CHATGPT_PLAN_API
		) {
			throw new Error(
				"ChatGPT plan credentials can only be used with the public OpenAI API.",
			);
		}
	}
	const apiKey = await resolveApiKey(config);
	if (isChatGPTPlan && !apiKey)
		throw new Error("Continue with ChatGPT before inference.");
	const provider = createOpenAI({
		apiKey,
		baseURL: isChatGPTPlan ? CHATGPT_PLAN_API : config.baseUrl,
		headers: config.headers,
		fetch: isChatGPTPlan
			? chatGPTPlanFetch(config.fetch ?? globalThis.fetch, apiKey!)
			: config.fetch,
		name: context.provider.id,
	});
	// The ChatGPT OAuth Codex backend rejects `max_output_tokens`, and the
	// OpenAI Responses API applies its own defaults, so gateway-synthesized
	// caps are never forwarded. Explicit caps — whether resolved by the
	// gateway from a caller request or passed straight to this provider —
	// are honored for API-key usage because that endpoint supports output
	// limits.
	const isChatGptOAuth = isChatGPTPlan || isChatGptOAuthBaseUrl(config.baseUrl);
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
