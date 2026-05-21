import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { wrapLanguageModel } from "ai";
import { resolveApiKey } from "../http";
import { createRetryMiddleware } from "../middleware/retry";
import { isClaudeModelId } from "../model-facts";
import type { ProviderFactoryResult } from "./types";

export async function createVertexProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const project = String(
		config.options?.project ?? config.options?.projectId ?? "",
	);
	const location = String(
		config.options?.location ?? config.options?.region ?? "us-central1",
	);

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

	if (isClaudeModelId(context.model.id)) {
		const provider = createVertexAnthropic({
			project,
			location,
			baseURL: config.baseUrl,
			headers: config.headers,
			fetch: config.fetch,
		});
		return {
			model: (modelId) =>
				wrapLanguageModel({
					model: provider(modelId) as LanguageModelV3,
					middleware: retryMiddleware,
				}),
		};
	}

	const provider = createVertex({
		project,
		location,
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
	});
	return {
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId) as LanguageModelV3,
				middleware: retryMiddleware,
			}),
	};
}
