import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import { composeMiddleware, createRetryMiddleware } from "../middleware/retry";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import type { ProviderFactoryResult } from "./types";

export async function createMistralProviderModule(
	config: GatewayResolvedProviderConfig,
	context?: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const provider = createMistral({
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
	});

	// Extract retry options from provider config
	const retryOptions = config.options?.retry as
		| {
				maxRetries?: number;
				baseDelayMs?: number;
				maxDelayMs?: number;
				retryAllErrors?: boolean;
		  }
		| undefined;

	// Create retry middleware with logging support
	const retryMiddleware = createRetryMiddleware({
		maxRetries: retryOptions?.maxRetries ?? 3,
		baseDelayMs: retryOptions?.baseDelayMs ?? 1000,
		maxDelayMs: retryOptions?.maxDelayMs ?? 30000,
		retryAllErrors: retryOptions?.retryAllErrors ?? false,
		onRetryAttempt: context?.logger
			? (attempt, maxRetries, delayMs, error) => {
					context.logger?.warn?.(
						`[mistral] Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms`,
						{ error, modelId: context.model?.id },
					);
				}
			: undefined,
		signal: context?.signal,
	});

	// Compose middlewares: retry wraps the outer layer, splitToolImages
	// transforms the prompt before the request is made
	const composedMiddleware = composeMiddleware(
		retryMiddleware,
		splitToolImagesMiddleware,
	);

	return {
		// Mistral's chat-messages converter has the same multimodal-tool-message
		// limitation as `@ai-sdk/openai-compatible`: `role:"tool"` content must
		// be a single string, so a `ToolResultOutput` of type `'content'` with
		// image-data parts loses the bytes when serialised. Wrap with composed
		// middleware that includes:
		// 1. `retryMiddleware` for transient error handling (429, 5xx, network)
		// 2. `splitToolImagesMiddleware` to rewrite the typed prompt before the
		//    converter runs. See `middleware/split-tool-images.ts`.
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: composedMiddleware,
			}),
	};
}
