import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import { createRetryMiddleware } from "../middleware/retry";
import type { ProviderFactoryResult } from "./types";

export async function createGoogleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createGoogleGenerativeAI({
		apiKey,
		headers: config.headers,
		fetch: config.fetch,
		name: context.provider.id,
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
		onRetryAttempt: (attempt, maxRetries, delayMs, error) => {
			context.logger?.warn?.(
				`[${context.provider.id}] Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms`,
				{ error, modelId: context.model.id },
			);
		},
		signal: context.signal,
	});

	return {
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: retryMiddleware,
			}),
	};
}
