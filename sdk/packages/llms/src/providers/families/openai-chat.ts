/**
 * OpenAI Base Handler
 *
 * Base class for all handlers using the OpenAI SDK.
 * This handles the common streaming logic and can be extended for:
 * - Standard OpenAI API
 * - OpenAI-compatible providers (DeepSeek, xAI, Together, etc.)
 * - OpenRouter
 * - Azure OpenAI
 */

import type { Message, ToolDefinition } from "@clinebot/shared";
import {
	resolveEffectiveReasoningEffort,
	resolveReasoningBudgetFromRatio,
} from "@clinebot/shared";
import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import {
	getMissingApiKeyError,
	resolveApiKeyForProvider,
} from "../runtime/auth";
import {
	convertToOpenAIMessages,
	getOpenAIToolParams,
} from "../transform/openai-format";
import type { ApiStream, HandlerModelInfo, ModelInfo } from "../types";
import { resolveRoutingProviderId } from "../types";
import { retryStream } from "../utils/retry";
import { ToolCallProcessor } from "../utils/tool-processor";
import { BaseHandler } from "./shared/base-handler";

function resolveAnthropicOpenRouterReasoningBudget(options: {
	modelId?: string;
	effort?: string;
	maxTokens?: number;
	explicitBudgetTokens?: number;
}) {
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return options.explicitBudgetTokens;
	}

	if (
		!options.modelId ||
		!options.modelId.toLowerCase().startsWith("anthropic/") ||
		!options.effort ||
		options.effort === "none" ||
		typeof options.maxTokens !== "number" ||
		options.maxTokens <= 1024
	) {
		return undefined;
	}

	const maxBudget = Math.min(options.maxTokens - 1, 128000);
	return resolveReasoningBudgetFromRatio({
		effort: options.effort,
		maxBudget,
		scaleTokens: options.maxTokens,
		minimumBudget: 1024,
	});
}

function buildOpenRouterReasoningConfig(options: {
	modelId?: string;
	thinking?: boolean;
	effort?: string;
	budgetTokens?: number;
	maxTokens?: number;
}) {
	const anthropicModel =
		!!options.modelId && options.modelId.toLowerCase().startsWith("anthropic/");
	const reasoning: {
		enabled?: boolean;
		effort?: string;
		max_tokens?: number;
	} = {};

	if (options.thinking === true) {
		reasoning.enabled = true;
	}
	const budgetTokens = resolveAnthropicOpenRouterReasoningBudget({
		modelId: options.modelId,
		effort: options.effort,
		maxTokens: options.maxTokens,
		explicitBudgetTokens: options.budgetTokens,
	});
	if (typeof budgetTokens === "number" && budgetTokens > 0) {
		reasoning.max_tokens = budgetTokens;
	} else if (options.effort) {
		reasoning.effort = options.effort;
	} else if (anthropicModel && options.budgetTokens === 0) {
		reasoning.max_tokens = 0;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

/**
 * Base handler for OpenAI SDK-based providers
 *
 * Uses ProviderConfig fields:
 * - baseUrl: Base URL for the API
 * - modelId: Model ID
 * - knownModels: Known models with their info
 * - headers: Custom headers
 * - capabilities: Array of supported capabilities (reasoning, prompt-cache, etc.)
 */
export class OpenAIBaseHandler extends BaseHandler {
	readonly type = "openai";
	protected client: OpenAI | undefined;

	/**
	 * Ensure the OpenAI client is initialized
	 * Can be overridden for custom client creation (e.g., Azure)
	 */
	protected ensureClient(): OpenAI {
		if (!this.client) {
			const baseURL = this.config.baseUrl;

			if (!baseURL) {
				throw new Error("Base URL is required. Set baseUrl in config.");
			}
			const apiKey = resolveApiKeyForProvider(
				resolveRoutingProviderId(this.config),
				this.config.apiKey,
			);
			if (!apiKey) {
				throw new Error(
					getMissingApiKeyError(resolveRoutingProviderId(this.config)),
				);
			}
			const requestHeaders = this.getRequestHeaders();
			// const hasAuthorizationHeader = Object.keys(requestHeaders).some((key) => key.toLowerCase() === "authorization")

			this.client = new OpenAI({
				apiKey,
				baseURL,
				defaultHeaders: requestHeaders,
			});
		}
		return this.client;
	}

	/**
	 * Get model info, falling back to provider defaults
	 */
	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		if (!modelId) {
			throw new Error("Model ID is required. Set modelId in config.");
		}

		const modelInfo =
			this.config.modelInfo ??
			this.config.knownModels?.[modelId] ??
			this.getDefaultModelInfo();

		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	protected getDefaultModelInfo(): ModelInfo {
		return {
			id: this.config.modelId,
			capabilities: this.resolveModelCapabilities(),
		};
	}

	getMessages(
		systemPrompt: string,
		messages: Message[],
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		const model = this.getModel();
		const supportsPromptCache = this.supportsPromptCache(model.info);
		const systemMessage = supportsPromptCache
			? ({
					role: "system",
					content: [
						{
							type: "text",
							text: systemPrompt,
							cache_control: { type: "ephemeral" },
						},
					],
				} as unknown as OpenAI.Chat.ChatCompletionMessageParam)
			: { role: "system" as const, content: systemPrompt };

		return [
			systemMessage,
			...convertToOpenAIMessages(messages, supportsPromptCache),
		];
	}

	/**
	 * Create a streaming message
	 */
	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		yield* retryStream(() =>
			this.createMessageInternal(systemPrompt, messages, tools),
		);
	}

	private async *createMessageInternal(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const client = this.ensureClient();
		const { id: modelId, info: modelInfo } = this.getModel();
		const responseId = this.createResponseId();
		const routingProviderId = resolveRoutingProviderId(this.config);

		// Convert messages to OpenAI format
		const openAiMessages = this.getMessages(systemPrompt, messages);

		// Build request options
		const requestOptions: Record<string, unknown> &
			OpenAI.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools, {
				// OpenRouter can reject strict function schemas on some routed models.
				strict: routingProviderId !== "openrouter",
			}),
		};

		// Add max tokens if configured
		const maxTokens = modelInfo.maxTokens ?? this.config.maxOutputTokens;
		if (maxTokens) {
			requestOptions.max_completion_tokens = maxTokens;
		}

		// Add temperature if not a reasoning model
		const modelSupportsReasoning = this.hasResolvedCapability(
			"reasoning",
			modelInfo,
		);
		if (!modelSupportsReasoning) {
			requestOptions.temperature = modelInfo.temperature ?? 0;
		}

		// Add reasoning effort for supported models
		const supportsReasoningEffort =
			this.hasResolvedCapability("reasoning-effort", modelInfo) ||
			modelSupportsReasoning;
		const effectiveReasoningEffort = resolveEffectiveReasoningEffort(
			this.config.reasoningEffort,
			this.config.thinking,
		);
		if (routingProviderId === "openrouter") {
			const reasoning = buildOpenRouterReasoningConfig({
				modelId,
				thinking: this.config.thinking,
				effort: effectiveReasoningEffort,
				budgetTokens: this.config.thinkingBudgetTokens,
				maxTokens,
			});
			if (reasoning) {
				(
					requestOptions as OpenAI.ChatCompletionCreateParamsStreaming & {
						reasoning?: typeof reasoning;
					}
				).reasoning = reasoning;
			}
		} else if (supportsReasoningEffort && effectiveReasoningEffort) {
			(
				requestOptions as OpenAI.ChatCompletionCreateParamsStreaming & {
					reasoning_effort?: string;
				}
			).reasoning_effort = effectiveReasoningEffort;
		}

		const requestHeaders = this.getRequestHeaders();
		const hasAuthorizationHeader = Object.keys(requestHeaders).some(
			(key) => key.toLowerCase() === "authorization",
		);
		const apiKey = resolveApiKeyForProvider(
			routingProviderId,
			this.config.apiKey,
		);
		if (!hasAuthorizationHeader && apiKey) {
			requestHeaders.Authorization = `Bearer ${apiKey}`;
		}
		const abortSignal = this.getAbortSignal();
		let stream: AsyncIterable<ChatCompletionChunk>;
		try {
			stream = await client.chat.completions.create(requestOptions, {
				signal: abortSignal,
				headers: requestHeaders,
			});
		} catch (error) {
			throw this.normalizeOpenAICompatibleBadRequest(error) ?? error;
		}
		const toolCallProcessor = new ToolCallProcessor();
		let finishReason: string | null = null;

		for await (const chunk of stream) {
			const choice = chunk.choices?.[0];
			if (choice?.finish_reason) {
				finishReason = choice.finish_reason;
			}
			yield* this.withResponseIdForAll(
				this.processChunk(chunk, toolCallProcessor, modelInfo, responseId),
				responseId,
			);
		}

		yield {
			type: "done",
			success: true,
			id: responseId,
			incompleteReason: finishReason === "length" ? "max_tokens" : undefined,
		};
	}

	/**
	 * Process a single chunk from the stream
	 * Can be overridden for provider-specific handling
	 */
	protected *processChunk(
		chunk: ChatCompletionChunk,
		toolCallProcessor: ToolCallProcessor,
		_modelInfo: ModelInfo,
		responseId: string,
	): Generator<import("../types").ApiStreamChunk> {
		const rawDelta = chunk.choices?.[0]?.delta;
		const delta = rawDelta && {
			...rawDelta,
			reasoning:
				typeof (rawDelta as { reasoning?: unknown }).reasoning === "string"
					? ((rawDelta as { reasoning?: string }).reasoning ?? "")
					: undefined,
			reasoning_content: (rawDelta as { reasoning_content?: string })
				.reasoning_content,
			reasoning_details: (rawDelta as { reasoning_details?: unknown })
				.reasoning_details,
		};

		// Handle text content
		if (delta?.content) {
			yield { type: "text", text: delta.content, id: responseId };
		}

		// Handle reasoning content (DeepSeek, xAI, etc.)
		if (
			delta?.reasoning_content ||
			delta?.reasoning ||
			(Array.isArray(delta?.reasoning_details) &&
				delta.reasoning_details.length > 0)
		) {
			yield {
				type: "reasoning",
				reasoning: delta.reasoning_content ?? delta.reasoning ?? "",
				details: delta.reasoning_details,
				id: responseId,
			};
		}

		// Handle tool calls
		if (delta?.tool_calls) {
			yield* toolCallProcessor.processToolCallDeltas(
				delta.tool_calls.map((tc) => ({
					index: tc.index,
					id: tc.id,
					function: tc.function,
				})),
				responseId,
			);
		}

		// Handle usage information
		if (chunk.usage) {
			const inputTokens = chunk.usage.prompt_tokens ?? 0;
			const outputTokens = chunk.usage.completion_tokens ?? 0;
			const usageWithCache = chunk.usage as typeof chunk.usage & {
				prompt_tokens_details?: {
					cached_tokens?: number;
					cache_write_tokens?: number;
				};
				completion_tokens_details?: {
					reasoning_tokens?: number;
				};
				cache_creation_input_tokens?: number;
				cache_read_input_tokens?: number;
			};
			const cacheReadTokens =
				usageWithCache.prompt_tokens_details?.cached_tokens ??
				usageWithCache.cache_read_input_tokens ??
				0;
			const cacheWriteTokens =
				usageWithCache.prompt_tokens_details?.cache_write_tokens ??
				usageWithCache.cache_creation_input_tokens ??
				0;

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
				thoughtsTokenCount:
					usageWithCache.completion_tokens_details?.reasoning_tokens,
				totalCost: this.calculateCostFromInclusiveInput(
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
				),
				id: responseId,
			};
		}
	}
}
