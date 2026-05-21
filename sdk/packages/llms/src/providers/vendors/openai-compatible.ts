import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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
		onRetryAttempt: (attempt, maxRetries, delayMs, error) => {
			context.logger?.warn?.(
				`[${context.provider.id}] Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms`,
				{ error, modelId: context.model.id },
			);
		},
		signal: context.signal,
	});

	// Compose middlewares: retry wraps the outer layer, splitToolImages
	// transforms the prompt before the request is made
	const composedMiddleware = composeMiddleware(
		retryMiddleware,
		splitToolImagesMiddleware,
	);

	return {
		// Wrap each constructed model with composed middleware:
		// 1. `retryMiddleware` handles transient errors (429, 5xx, network)
		//    with exponential backoff and respects retry-after headers.
		// 2. `splitToolImagesMiddleware` rewrites `role:"tool"` messages
		//    whose `output.type === 'content'` carries image-data parts
		//    into a placeholder text + a synthetic `role:"user"` message
		//    carrying the images. The OpenAI Chat Completions wire format
		//    does NOT support multimodal tool messages (the converter
		//    `JSON.stringify`s the parts array, losing image bytes).
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: composedMiddleware,
			}),
	};
}
