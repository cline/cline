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

import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import {
	convertToOpenAIMessages,
	getOpenAIToolParams,
} from "../transform/openai-format";
import type {
	ApiStream,
	HandlerModelInfo,
	ModelCapability,
	ModelInfo,
	ProviderConfig,
} from "../types";
import { hasModelCapability } from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import { ToolCallProcessor } from "../utils/tool-processor";
import { getMissingApiKeyError, resolveApiKeyForProvider } from "./auth";
import { BaseHandler } from "./base";

const DEFAULT_REASONING_EFFORT = "medium" as const;

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
				this.config.providerId,
				this.config.apiKey,
			);
			if (!apiKey) {
				throw new Error(getMissingApiKeyError(this.config.providerId));
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
		const capabilities: ModelCapability[] = this.config.capabilities?.includes(
			"prompt-cache",
		)
			? ["prompt-cache"]
			: [];
		return {
			id: this.config.modelId,
			capabilities,
		};
	}

	getMessages(
		systemPrompt: string,
		messages: Message[],
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		const model = this.getModel();
		const supportsPromptCache =
			hasModelCapability(model.info, "prompt-cache") ||
			this.config.capabilities?.includes("prompt-cache") === true;
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

		// Convert messages to OpenAI format
		const openAiMessages = this.getMessages(systemPrompt, messages);

		// Build request options
		const requestOptions: OpenAI.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools, {
				// OpenRouter can reject strict function schemas on some routed models.
				strict: this.config.providerId !== "openrouter",
			}),
		};

		// Add max tokens if configured
		const maxTokens = modelInfo.maxTokens ?? this.config.maxOutputTokens;
		if (maxTokens) {
			requestOptions.max_completion_tokens = maxTokens;
		}

		// Add temperature if not a reasoning model
		const modelSupportsReasoning =
			modelInfo.capabilities?.includes("reasoning") ?? false;
		if (!modelSupportsReasoning) {
			requestOptions.temperature = modelInfo.temperature ?? 0;
		}

		// Add reasoning effort for supported models
		const supportsReasoningEffort =
			modelInfo.capabilities?.includes("reasoning-effort") ||
			modelInfo.capabilities?.includes("reasoning") ||
			false;
		const effectiveReasoningEffort =
			this.config.reasoningEffort ??
			(this.config.thinking ? DEFAULT_REASONING_EFFORT : undefined);
		if (supportsReasoningEffort && effectiveReasoningEffort) {
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
			this.config.providerId,
			this.config.apiKey,
		);
		if (!hasAuthorizationHeader && apiKey) {
			requestHeaders.Authorization = `Bearer ${apiKey}`;
		}
		const abortSignal = this.getAbortSignal();
		const stream = await client.chat.completions.create(requestOptions, {
			signal: abortSignal,
			headers: requestHeaders,
		});
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
			reasoning_content: (rawDelta as { reasoning_content?: string })
				.reasoning_content,
		};

		// Handle text content
		if (delta?.content) {
			yield { type: "text", text: delta.content, id: responseId };
		}

		// Handle reasoning content (DeepSeek, xAI, etc.)
		if (delta?.reasoning_content) {
			yield {
				type: "reasoning",
				reasoning: delta.reasoning_content,
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
				prompt_cache_miss_tokens?: number;
				cache_creation_input_tokens?: number;
				cache_read_input_tokens?: number;
			};
			const cacheReadTokens =
				usageWithCache.prompt_tokens_details?.cached_tokens ?? 0;
			const cacheWriteTokens =
				usageWithCache.prompt_tokens_details?.cache_write_tokens ??
				usageWithCache.prompt_cache_miss_tokens ??
				0;

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
				totalCost: this.calculateCost(
					inputTokens,
					outputTokens,
					cacheReadTokens,
				),
				id: responseId,
			};
		}
	}
}

/**
 * Create an OpenAI-compatible handler
 */
export function createOpenAIHandler(config: ProviderConfig): OpenAIBaseHandler {
	return new OpenAIBaseHandler(config);
}
