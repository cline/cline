import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { GatewayResolvedProviderConfig } from "@clinebot/shared";
import { wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
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
		// Mistral's chat-messages converter has the same multimodal-tool-message
		// limitation as `@ai-sdk/openai-compatible`: `role:"tool"` content must
		// be a single string, so a `ToolResultOutput` of type `'content'` with
		// image-data parts loses the bytes when serialised. Wrap with
		// `splitToolImagesMiddleware` to rewrite the typed prompt before the
		// converter runs. See `middleware/split-tool-images.ts`.
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: splitToolImagesMiddleware,
			}),
	};
}
