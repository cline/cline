/**
 * OpenAI Responses API Handler
 *
 * Handler for OpenAI's Responses API format, which is used by newer models
 * that require native tool calling (e.g., GPT-5, o3, codex).
 *
 * The Responses API has a different structure than Chat Completions:
 * - Uses `instructions` instead of system messages
 * - Uses `input` instead of messages array
 * - Has different streaming event types (response.*, not choices.delta)
 * - Supports reasoning with encrypted content
 */

import OpenAI from "openai";
import {
	getMissingApiKeyError,
	resolveApiKeyForProvider,
} from "../runtime/auth";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "../transform/content-format";
import type {
	ApiStream,
	HandlerModelInfo,
	ModelCapability,
	ModelInfo,
} from "../types";
import { resolveRoutingProviderId } from "../types";
import type {
	ContentBlock,
	Message,
	ToolDefinition,
	ToolUseContent,
} from "../types/messages";
import { retryStream } from "../utils/retry";
import { BaseHandler } from "./base";

const DEFAULT_REASONING_EFFORT = "medium" as const;

/**
 * Convert tool definitions to Responses API format
 */
function convertToolsToResponsesFormat(
	tools?: ToolDefinition[],
	_options?: { stripFormat?: boolean },
) {
	if (!tools?.length) return undefined;

	return tools.map((tool) => ({
		type: "function" as const,
		name: tool.name,
		description: tool.description,
		parameters: tool.inputSchema,
	}));
}

/**
 * Convert messages to Responses API input format
 */
function convertToResponsesInput(messages: Message[]) {
	type ResponsesInputItem =
		| {
				type: "message";
				role: "user" | "assistant";
				content: Array<{ type: "input_text" | "output_text"; text: string }>;
		  }
		| {
				type: "function_call";
				call_id: string;
				name: string;
				arguments: string;
		  }
		| {
				type: "function_call_output";
				call_id: string;
				output: string;
		  };

	const input: ResponsesInputItem[] = [];

	const toText = (
		role: "user" | "assistant",
		contentBlocks: Array<{ type: "text"; text: string }>,
	) => {
		const textContent = contentBlocks.map((block) => block.text).join("\n");
		if (!textContent) {
			return;
		}
		input.push({
			type: "message",
			role,
			content: [
				{
					type: role === "user" ? "input_text" : "output_text",
					text: textContent,
				},
			],
		});
	};

	const isTextBlock = (
		block: ContentBlock,
	): block is { type: "text"; text: string } => block.type === "text";

	const assistantToolUseCallId = (block: ToolUseContent): string =>
		block.call_id?.trim() || block.id;

	for (const msg of messages) {
		if (msg.role !== "user" && msg.role !== "assistant") {
			continue;
		}

		if (!Array.isArray(msg.content)) {
			if (msg.content) {
				toText(msg.role, [{ type: "text", text: msg.content }]);
			}
			continue;
		}

		let bufferedText: Array<{ type: "text"; text: string }> = [];
		const flushText = () => {
			if (bufferedText.length === 0) {
				return;
			}
			toText(msg.role, bufferedText);
			bufferedText = [];
		};

		for (const block of msg.content) {
			if (isTextBlock(block)) {
				bufferedText.push(block);
				continue;
			}

			if (msg.role === "assistant" && block.type === "tool_use") {
				flushText();
				const toolUseBlock = block as ToolUseContent;
				input.push({
					type: "function_call",
					call_id: assistantToolUseCallId(toolUseBlock),
					name: toolUseBlock.name,
					arguments: JSON.stringify(normalizeToolUseInput(toolUseBlock.input)),
				});
				continue;
			}

			if (msg.role === "user" && block.type === "tool_result") {
				flushText();
				input.push({
					type: "function_call_output",
					call_id: block.tool_use_id,
					output: serializeToolResultContent(block.content),
				});
			}
		}

		flushText();
	}

	return input;
}

/**
 * Handler for OpenAI Responses API
 *
 * Uses ProviderConfig fields:
 * - baseUrl: Base URL for the API
 * - modelId: Model ID
 * - knownModels: Known models with their info
 * - headers: Custom headers
 */
export class OpenAIResponsesHandler extends BaseHandler {
	readonly type = "openai";
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
			capabilities: this.resolveModelCapabilities(),
		};
	}

	protected override getConfigCapabilityOverrides(): ModelCapability[] {
		// Responses API does not support prompt-cache request shaping.
		return [];
	}

	getMessages(
		_systemPrompt: string,
		messages: Message[],
	): ReturnType<typeof convertToResponsesInput> {
		return convertToResponsesInput(messages);
	}

	/**
	 * Create a streaming message using the Responses API
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
		const abortSignal = this.getAbortSignal();
		const fallbackResponseId = this.createResponseId();
		const routingProviderId = resolveRoutingProviderId(this.config);
		let resolvedResponseId: string | undefined;
		const functionCallMetadataByItemId = new Map<
			string,
			{ callId?: string; name?: string }
		>();

		// Convert messages to Responses API input format
		const input = this.getMessages(systemPrompt, messages);

		// Convert tools to Responses API format
		const responseTools = convertToolsToResponsesFormat(tools, {
			stripFormat: routingProviderId === "openai-codex",
		});

		// Responses API requires tools for native tool calling
		if (!responseTools?.length) {
			throw new Error(
				"OpenAI Responses API requires tools to be provided. Enable native tool calling in settings.",
			);
		}

		// Build reasoning config
		const supportsReasoning = this.hasResolvedCapability(
			"reasoning",
			modelInfo,
		);
		const effectiveReasoningEffort =
			this.config.reasoningEffort ??
			(this.config.thinking ? DEFAULT_REASONING_EFFORT : undefined);
		const reasoningConfig =
			supportsReasoning && effectiveReasoningEffort
				? {
						effort: effectiveReasoningEffort,
						summary: "auto" as const,
					}
				: undefined;
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
		if (
			routingProviderId === "openai-codex" &&
			typeof this.config.accountId === "string" &&
			this.config.accountId.trim().length > 0
		) {
			const accountId = this.config.accountId.trim();
			// ChatGPT Codex endpoints may require an explicit account identifier.
			requestHeaders["chatgpt-account-id"] = accountId;
			requestHeaders["openai-account-id"] = accountId;
		}

		// Create the response using Responses API
		let stream: AsyncIterable<any>;
		try {
			stream = await (client as any).responses.create(
				{
					model: modelId,
					instructions: systemPrompt,
					input,
					// ChatGPT account Codex rejects requests unless explicit non-storage is set.
					store: routingProviderId === "openai-codex" ? false : undefined,
					stream: true,
					tools: responseTools,
					reasoning: reasoningConfig,
				},
				{ signal: abortSignal, headers: requestHeaders },
			);
		} catch (error) {
			const normalizedBadRequest =
				this.normalizeOpenAICompatibleBadRequest(error);
			if (normalizedBadRequest) {
				throw normalizedBadRequest;
			}
			if (routingProviderId === "openai-codex") {
				const rawError = error as
					| (Error & {
							status?: number;
							message?: string;
							error?: { message?: string; detail?: string };
							response?: { status?: number };
					  })
					| undefined;
				const status =
					rawError?.status ??
					rawError?.response?.status ??
					(typeof rawError?.message === "string" &&
					rawError.message.includes("400")
						? 400
						: undefined);
				if (status === 400) {
					const detail =
						rawError?.error?.detail ??
						rawError?.error?.message ??
						(typeof rawError?.message === "string" ? rawError.message : "");
					throw new Error(
						`OpenAI Codex request was rejected (HTTP 400). ${detail ? `Detail: ${detail}` : "Re-run 'clite auth openai-codex', verify model access, and ensure accountId is present in provider settings."}`,
						{ cause: error },
					);
				}
			}
			throw error;
		}

		// Process the response stream
		for await (const chunk of stream) {
			const apiResponseId = this.getApiResponseId(chunk);
			if (apiResponseId) {
				resolvedResponseId = apiResponseId;
			}

			yield* this.processResponseChunk(
				chunk,
				modelInfo,
				resolvedResponseId ?? fallbackResponseId,
				functionCallMetadataByItemId,
			);
		}
	}

	/**
	 * Process a single chunk from the Responses API stream
	 */
	protected *processResponseChunk(
		chunk: any,
		_modelInfo: ModelInfo,
		responseId: string,
		functionCallMetadataByItemId: Map<
			string,
			{ callId?: string; name?: string }
		>,
	): Generator<import("../types").ApiStreamChunk> {
		// Handle different event types from Responses API
		switch (chunk.type) {
			case "response.output_item.added": {
				const item = chunk.item;
				if (item.type === "function_call" && item.id) {
					functionCallMetadataByItemId.set(item.id, {
						callId: item.call_id,
						name: item.name,
					});
					yield {
						type: "tool_calls",
						id: item.id || responseId,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					};
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						id: item.id || responseId,
						reasoning: "",
						redacted_data: item.encrypted_content,
					};
				}
				break;
			}

			case "response.output_item.done": {
				const item = chunk.item;
				if (item.type === "function_call") {
					if (item.id) {
						functionCallMetadataByItemId.set(item.id, {
							callId: item.call_id,
							name: item.name,
						});
					}
					yield {
						type: "tool_calls",
						id: item.id || responseId,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					};
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						id: item.id || responseId,
						details: item.summary,
						reasoning: "",
					};
				}
				break;
			}

			case "response.reasoning_summary_part.added":
				yield {
					type: "reasoning",
					id: chunk.item_id || responseId,
					reasoning: chunk.part?.text || "",
				};
				break;

			case "response.reasoning_summary_text.delta":
				yield {
					type: "reasoning",
					id: chunk.item_id || responseId,
					reasoning: chunk.delta || "",
				};
				break;

			case "response.reasoning_summary_part.done":
				yield {
					type: "reasoning",
					id: chunk.item_id || responseId,
					details: chunk.part,
					reasoning: "",
				};
				break;

			case "response.output_text.delta":
				if (chunk.delta) {
					yield {
						id: chunk.item_id || responseId,
						type: "text",
						text: chunk.delta,
					};
				}
				break;

			case "response.reasoning_text.delta":
				if (chunk.delta) {
					yield {
						id: chunk.item_id || responseId,
						type: "reasoning",
						reasoning: chunk.delta,
					};
				}
				break;

			case "response.function_call_arguments.delta":
				{
					const meta = chunk.item_id
						? functionCallMetadataByItemId.get(chunk.item_id)
						: undefined;
					yield {
						type: "tool_calls",
						id: chunk.item_id || responseId,
						tool_call: {
							call_id: meta?.callId,
							function: {
								id: chunk.item_id,
								name: meta?.name,
								arguments: chunk.delta,
							},
						},
					};
				}
				break;

			case "response.function_call_arguments.done":
				if (chunk.item_id && chunk.arguments) {
					const meta = functionCallMetadataByItemId.get(chunk.item_id);
					yield {
						type: "tool_calls",
						id: chunk.item_id || responseId,
						tool_call: {
							call_id: chunk.call_id ?? meta?.callId,
							function: {
								id: chunk.item_id,
								name: chunk.name ?? meta?.name,
								arguments: chunk.arguments,
							},
						},
					};
				}
				break;

			case "response.incomplete": {
				const incompleteReason = chunk.response?.incomplete_details?.reason;
				yield {
					type: "done",
					success: false,
					incompleteReason,
					id: chunk.response?.id || responseId,
				};
				break;
			}

			case "response.failed": {
				const error = chunk.response?.error;
				yield {
					type: "done",
					success: false,
					error: error?.message || "Unknown error",
					id: chunk.response?.id || responseId,
				};
				break;
			}

			case "response.completed": {
				if (chunk.response?.usage) {
					const usage = chunk.response.usage;
					const inputTokens = usage.input_tokens || 0;
					const outputTokens = usage.output_tokens || 0;
					const cacheReadTokens =
						usage.input_tokens_details?.cached_tokens || 0;
					const cacheWriteTokens = 0;

					const totalCost = this.calculateCostFromInclusiveInput(
						inputTokens,
						outputTokens,
						cacheReadTokens,
						cacheWriteTokens,
					);

					yield {
						type: "usage",
						inputTokens,
						outputTokens,
						cacheWriteTokens,
						cacheReadTokens,
						totalCost,
						id: chunk.response.id || responseId,
					};
				}

				// Yield done chunk to indicate streaming completed successfully
				yield {
					type: "done",
					success: true,
					id: chunk.response?.id || responseId,
				};
				break;
			}
		}
	}

	private getApiResponseId(chunk: any): string | undefined {
		if (
			typeof chunk?.response?.id === "string" &&
			chunk.response.id.length > 0
		) {
			return chunk.response.id;
		}

		if (
			typeof chunk?.response_id === "string" &&
			chunk.response_id.length > 0
		) {
			return chunk.response_id;
		}

		return undefined;
	}
}
