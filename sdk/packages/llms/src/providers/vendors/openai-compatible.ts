import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@clinebot/shared";
import { wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import type { ProviderFactoryResult } from "./types";

export async function createOpenAICompatibleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	// Don't preflight-check for a missing API key. If credentials are
	// missing or wrong, the provider's own response (e.g. 401) is the
	// authoritative error and is surfaced to the user as-is. This keeps
	// `llms` unopinionated about which providers do or don't need a key.
	const apiKey = await resolveApiKey(config);
	const provider = createOpenAICompatible({
		name: context.provider.id,
		apiKey,
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		...(config.fetch ? { fetch: config.fetch } : {}),
		includeUsage: true,
	} as never);
	return {
		// Wrap each constructed model with `splitToolImagesMiddleware` so
		// `role:"tool"` messages whose `output.type === 'content'` carries
		// image-data parts get split into a placeholder text + a synthetic
		// `role:"user"` message carrying the images. The OpenAI Chat
		// Completions wire format does NOT support multimodal tool messages
		// (the `@ai-sdk/openai-compatible` chat-messages converter
		// `JSON.stringify`s the parts array, losing image bytes). The
		// middleware operates on the typed `LanguageModelV3Prompt` BEFORE
		// the converter runs, so the converter sees only text-only tool
		// messages with adjacent multimodal user messages — the wire
		// pattern that classic Cline used in production for years (see
		// `convertToOpenAiMessages` in `src/core/api/transform/openai-format.ts`
		// on origin/main).
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: splitToolImagesMiddleware,
			}),
	};
}
