/**
 * R1 Base Handler
 *
 * Handler for R1-based reasoning models (DeepSeek Reasoner, etc.)
 * These models have special requirements:
 * 1. Consecutive messages with the same role must be merged
 * 2. reasoning_content field for tool calling continuations
 * 3. No temperature parameter
 * 4. Response includes reasoning_content in the delta
 */

import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { getOpenAIToolParams } from "../transform/openai-format";
import { convertToR1Messages } from "../transform/r1-format";
import type {
	ApiStream,
	ApiStreamChunk,
	HandlerModelInfo,
	ModelInfo,
	ProviderConfig,
} from "../types";
import { resolveRoutingProviderId } from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import { ToolCallProcessor } from "../utils/tool-processor";
import { getMissingApiKeyError, resolveApiKeyForProvider } from "./auth";
import { BaseHandler } from "./base";

/**
 * Extended usage type for DeepSeek with cache tokens
 */
interface R1Usage extends OpenAI.CompletionUsage {
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

/**
 * Base handler for R1-based reasoning models
 *
 * Uses ProviderConfig fields:
 * - baseUrl: Base URL for the API
 * - modelId: Model ID
 * - knownModels: Known models with their info
 * - headers: Custom headers
 */
export class R1BaseHandler extends BaseHandler {
	protected client: OpenAI | undefined;

	/**
	 * Ensure the OpenAI client is initialized
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
			const hasAuthorizationHeader = Object.keys(requestHeaders).some(
				(key) => key.toLowerCase() === "authorization",
			);

			this.client = new OpenAI({
				apiKey,
				baseURL,
				defaultHeaders: hasAuthorizationHeader
					? requestHeaders
					: { ...requestHeaders, Authorization: `Bearer ${apiKey}` },
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
			capabilities: ["prompt-cache", "reasoning"],
		};
	}

	/**
	 * Check if this model is a reasoner model (no temperature allowed)
	 */
	protected isReasonerModel(modelId: string): boolean {
		return modelId.includes("reasoner") || modelId.includes("r1");
	}

	getMessages(
		systemPrompt: string,
		messages: Message[],
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		return [
			{ role: "system", content: systemPrompt },
			...convertToR1Messages(messages),
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

		// Convert messages to R1 format (handles merging and reasoning_content)
		const openAiMessages = this.getMessages(systemPrompt, messages);

		// Build request options
		const requestOptions: OpenAI.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		};

		// Add max tokens if configured
		const maxTokens = modelInfo.maxTokens ?? this.config.maxOutputTokens;
		if (maxTokens) {
			requestOptions.max_completion_tokens = maxTokens;
		}

		// Only set temperature for non-reasoner models
		if (!this.isReasonerModel(modelId)) {
			requestOptions.temperature = modelInfo.temperature ?? 0;
		}

		const requestHeaders = this.getRequestHeaders();
		const hasAuthorizationHeader = Object.keys(requestHeaders).some(
			(key) => key.toLowerCase() === "authorization",
		);
		const apiKey = resolveApiKeyForProvider(
			resolveRoutingProviderId(this.config),
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

		for await (const chunk of stream) {
			yield* this.withResponseIdForAll(
				this.processChunk(chunk, toolCallProcessor, modelInfo, responseId),
				responseId,
			);
		}

		// Yield done chunk to indicate streaming completed successfully
		yield { type: "done", success: true, id: responseId };
	}

	/**
	 * Process a single chunk from the stream
	 */
	protected *processChunk(
		chunk: ChatCompletionChunk,
		toolCallProcessor: ToolCallProcessor,
		modelInfo: ModelInfo,
		responseId: string,
	): Generator<ApiStreamChunk> {
		const delta = chunk.choices?.[0]?.delta;

		// Handle text content
		if (delta?.content) {
			yield { type: "text", text: delta.content, id: responseId };
		}

		// Handle reasoning content (R1 specific)
		if ((delta as any)?.reasoning_content) {
			yield {
				type: "reasoning",
				reasoning: (delta as any).reasoning_content,
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

		// Handle usage information with R1-specific cache tokens
		if (chunk.usage) {
			yield* this.processUsage(chunk.usage, modelInfo, responseId);
		}
	}

	/**
	 * Process usage information with R1-specific cache handling
	 *
	 * DeepSeek reports total input AND cache reads/writes,
	 * where the input tokens is the sum of the cache hits/misses.
	 */
	protected *processUsage(
		usage: OpenAI.CompletionUsage,
		_modelInfo: ModelInfo,
		responseId: string,
	): Generator<ApiStreamChunk> {
		const r1Usage = usage as R1Usage;

		const inputTokens = r1Usage.prompt_tokens ?? 0; // sum of cache hits and misses
		const outputTokens = r1Usage.completion_tokens ?? 0;
		const cacheReadTokens = r1Usage.prompt_cache_hit_tokens ?? 0;
		const cacheWriteTokens = r1Usage.prompt_cache_miss_tokens ?? 0;

		yield {
			type: "usage",
			inputTokens: Math.max(
				0,
				inputTokens - cacheReadTokens - cacheWriteTokens,
			),
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
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

/**
 * Create an R1-compatible handler
 */
export function createR1Handler(config: ProviderConfig): R1BaseHandler {
	return new R1BaseHandler(config);
}
