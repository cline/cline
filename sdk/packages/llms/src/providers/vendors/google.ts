import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

const API_VERSION_SEGMENT = /^v\d+(?:alpha|beta)?\d*$/i;

/**
 * The legacy Gemini base-URL setting (and Google's own `@google/genai`
 * client) treat the base URL as a host root and append the API version
 * themselves, while `@ai-sdk/google` expects the version segment to be part
 * of `baseURL` (its default is `.../v1beta`). Preserve the legacy semantics:
 * append `/v1beta` unless the URL already ends with a version segment.
 */
export function normalizeGeminiBaseUrl(
	baseUrl: string | undefined,
): string | undefined {
	const trimmed = baseUrl?.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return undefined;
	}
	const lastSegment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
	return API_VERSION_SEGMENT.test(lastSegment) ? trimmed : `${trimmed}/v1beta`;
}

export async function createGoogleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createGoogleGenerativeAI({
		apiKey,
		baseURL: normalizeGeminiBaseUrl(config.baseUrl),
		headers: config.headers,
		fetch: config.fetch,
		name: context.provider.id,
	});
	return {
		buildModelTools: (tools) => {
			const result: ReturnType<
				NonNullable<ProviderFactoryResult["buildModelTools"]>
			> = {};
			for (const tool of tools) {
				if (tool.name === "web_search") {
					result.web_search = { tool: provider.tools.googleSearch({}) };
				}
			}
			return result;
		},
		operations: {
			language: (modelId) => provider(modelId),
			imageGeneration: (modelId) => provider.image(modelId),
		},
	};
}
