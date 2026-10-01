import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import {
	createAzureApiVersionFetch,
	ensureFetch,
	resolveApiKey,
} from "../http";
import type { ProviderFactoryResult } from "./types";

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

function createKeylessFetch(baseFetch: typeof fetch): typeof fetch {
	const keylessFetch = ((input, init) => {
		const headers = new Headers(init?.headers);
		if (headers.get("authorization") === "Bearer") {
			headers.delete("authorization");
		}
		return baseFetch(input, { ...init, headers });
	}) as typeof fetch;
	const baseFetchWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	(keylessFetch as FetchWithOptionalPreconnect).preconnect =
		baseFetchWithPreconnect.preconnect?.bind(baseFetch) ?? (() => {});
	return keylessFetch;
}

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
	const isKeylessCompatible =
		context.provider.id === "openai-compatible" && !apiKey;
	const providerFetch = createAzureApiVersionFetch(config);
	const provider = createOpenAI({
		// Local compatible servers may accept requests without a key. Supplying
		// an empty key disables the native SDK's OPENAI_API_KEY fallback/check;
		// omit its Authorization header so the server decides authentication.
		apiKey: isKeylessCompatible ? "" : apiKey,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: isKeylessCompatible
			? createKeylessFetch(ensureFetch(providerFetch))
			: providerFetch,
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
