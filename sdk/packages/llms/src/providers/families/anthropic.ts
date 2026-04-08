/**
 * Anthropic Base Handler
 *
 * Handler for Anthropic's API using the official SDK.
 * Supports prompt caching, extended thinking, and native tool calling.
 */

import { Anthropic } from "@anthropic-ai/sdk";
import type {
	Tool as AnthropicTool,
	RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources";
import {
	resolveReasoningBudgetFromRatio,
	resolveReasoningEffortRatio,
} from "@clinebot/shared";
import {
	getMissingApiKeyError,
	resolveApiKeyForProvider,
} from "../runtime/auth";
import {
	convertToAnthropicMessages,
	convertToolsToAnthropic,
} from "../transform/anthropic-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	resolveRoutingProviderId,
	supportsModelThinking,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import { BaseHandler } from "./shared/base-handler";

const DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const THINKING_DEBUG_ENV = "CLINE_DEBUG_THINKING";

function isThinkingDebugEnabled(): boolean {
	const raw = process.env[THINKING_DEBUG_ENV];
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveAnthropicThinkingBudget(options: {
	explicitBudgetTokens?: number;
	effort?: string;
	maxTokens?: number;
	thinkingEnabled?: boolean;
}) {
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return options.explicitBudgetTokens;
	}

	if (options.thinkingEnabled !== true) {
		return 0;
	}

	const effort = options.effort ?? "medium";
	if (effort === "none") {
		return 0;
	}

	const maxTokens = options.maxTokens ?? 128_000;
	const maxBudget = Math.min(maxTokens - 1, 128_000);
	const ratio = resolveReasoningEffortRatio(effort, {
		fallbackEffort: "medium",
	});
	if (ratio === 0) {
		return 0;
	}
	return (
		resolveReasoningBudgetFromRatio({
			effort,
			maxBudget,
			scaleTokens: maxTokens,
			minimumBudget: DEFAULT_THINKING_BUDGET_TOKENS,
			fallbackEffort: "medium",
		}) ?? 0
	);
}

/**
 * Handler for Anthropic's API
 */
export class AnthropicHandler extends BaseHandler {
	readonly type = "anthropic";
	private client: Anthropic | undefined;

	private ensureClient(): Anthropic {
		if (!this.client) {
			const apiKey = resolveApiKeyForProvider(
				resolveRoutingProviderId(this.config),
				this.config.apiKey,
			);
			if (!apiKey) {
				throw new Error(
					getMissingApiKeyError(resolveRoutingProviderId(this.config)),
				);
			}

			this.client = new Anthropic({
				apiKey,
				baseURL: this.config.baseUrl || undefined,
				defaultHeaders: this.getRequestHeaders(),
			});
		}
		return this.client;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		const knownModels = this.config.knownModels ?? {};
		const fallbackModel = knownModels[modelId] ?? {};
		const modelInfo = this.config.modelInfo ?? fallbackModel;

		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	getMessages(
		_systemPrompt: string,
		messages: Message[],
	): Anthropic.MessageParam[] {
		const supportsPromptCache = this.supportsPromptCache(this.getModel().info);
		return convertToAnthropicMessages(
			messages,
			supportsPromptCache,
		) as Anthropic.MessageParam[];
	}

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
		const model = this.getModel();
		const abortSignal = this.getAbortSignal();
		const responseId = this.createResponseId();
		const maxTokens =
			model.info.maxTokens ?? this.config.maxOutputTokens ?? 128_000;

		const thinkingSupported = supportsModelThinking(model.info);
		const requestedBudget = resolveAnthropicThinkingBudget({
			explicitBudgetTokens: this.config.thinkingBudgetTokens,
			effort: this.config.reasoningEffort,
			maxTokens,
			thinkingEnabled: this.config.thinking,
		});
		const budgetTokens =
			thinkingSupported && requestedBudget > 0 ? requestedBudget : 0;
		const nativeToolsOn = tools && tools.length > 0;
		const supportsPromptCache = this.supportsPromptCache(model.info);
		const reasoningOn = thinkingSupported && budgetTokens > 0;
		const debugThinking = isThinkingDebugEnabled();
		const debugChunkCounts: Record<string, number> = {};
		const countChunk = (type: string): void => {
			debugChunkCounts[type] = (debugChunkCounts[type] ?? 0) + 1;
		};

		if (debugThinking) {
			console.error(
				`[thinking-debug][anthropic][request] model=${model.id} thinkingFlag=${this.config.thinking === true} supportsModelThinking=${thinkingSupported} requestedBudget=${requestedBudget} effectiveBudget=${budgetTokens} reasoningOn=${reasoningOn} promptCache=${supportsPromptCache}`,
			);
		}

		// Convert messages
		const anthropicMessages = this.getMessages(systemPrompt, messages);

		// Convert tools
		const anthropicTools: AnthropicTool[] | undefined = nativeToolsOn
			? convertToolsToAnthropic(tools)
			: undefined;

		// Request options with abort signal
		const requestOptions = { signal: abortSignal };

		// Create the request
		// Use top-level automatic caching so the entire prefix (system +
		// messages) is cached and the breakpoint advances each turn.
		const createParams: Record<string, unknown> &
			Anthropic.MessageCreateParamsStreaming = {
			model: model.id,
			thinking: reasoningOn
				? { type: "enabled", budget_tokens: budgetTokens }
				: undefined,
			max_tokens: maxTokens,
			temperature: reasoningOn ? undefined : 0,
			system: [
				supportsPromptCache
					? {
							text: systemPrompt,
							type: "text",
							cache_control: { type: "ephemeral" },
						}
					: { text: systemPrompt, type: "text" },
			],
			messages: anthropicMessages as Anthropic.MessageParam[],
			stream: true,
			tools: anthropicTools,
			tool_choice: nativeToolsOn && !reasoningOn ? { type: "auto" } : undefined,
		};

		const stream = await client.messages.create(
			createParams as Anthropic.MessageCreateParamsStreaming,
			requestOptions,
		);

		// Track tool call state
		const currentToolCall = { id: "", name: "", arguments: "" };
		const usageSnapshot = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
		let stopReason: string | null = null;

		for await (const chunk of stream) {
			if (debugThinking) {
				countChunk(`event:${chunk.type}`);
				if (chunk.type === "content_block_start") {
					countChunk(
						`content_block_start:${chunk.content_block?.type ?? "unknown"}`,
					);
				} else if (chunk.type === "content_block_delta") {
					countChunk(`content_block_delta:${chunk.delta?.type ?? "unknown"}`);
				}
			}
			if (chunk.type === "message_delta") {
				stopReason =
					(chunk as { delta?: { stop_reason?: string } }).delta?.stop_reason ??
					stopReason;
			}
			yield* this.withResponseIdForAll(
				this.processChunk(chunk, currentToolCall, usageSnapshot, responseId),
				responseId,
			);
		}

		if (debugThinking) {
			const summary = Object.entries(debugChunkCounts)
				.map(([key, count]) => `${key}=${count}`)
				.sort()
				.join(" ");
			console.error(`[thinking-debug][anthropic][stream] ${summary}`);
		}

		yield {
			type: "done",
			success: true,
			id: responseId,
			incompleteReason: stopReason === "max_tokens" ? "max_tokens" : undefined,
		};
	}

	protected *processChunk(
		chunk: RawMessageStreamEvent,
		currentToolCall: { id: string; name: string; arguments: string },
		usageSnapshot: {
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
		},
		responseId: string,
	): Generator<import("../types").ApiStreamChunk> {
		switch (chunk.type) {
			case "message_start": {
				const usage = chunk.message.usage;
				usageSnapshot.inputTokens = usage.input_tokens || 0;
				usageSnapshot.outputTokens = usage.output_tokens || 0;
				usageSnapshot.cacheWriteTokens =
					(usage as any).cache_creation_input_tokens || 0;
				usageSnapshot.cacheReadTokens =
					(usage as any).cache_read_input_tokens || 0;
				yield {
					type: "usage",
					inputTokens: usageSnapshot.inputTokens,
					outputTokens: usageSnapshot.outputTokens,
					cacheWriteTokens: usageSnapshot.cacheWriteTokens,
					cacheReadTokens: usageSnapshot.cacheReadTokens,
					totalCost: this.calculateCost(
						usageSnapshot.inputTokens,
						usageSnapshot.outputTokens,
						usageSnapshot.cacheReadTokens,
						usageSnapshot.cacheWriteTokens,
					),
					id: responseId,
				};
				break;
			}

			case "message_delta": {
				usageSnapshot.outputTokens =
					chunk.usage.output_tokens || usageSnapshot.outputTokens;
				yield {
					type: "usage",
					inputTokens: usageSnapshot.inputTokens,
					outputTokens: usageSnapshot.outputTokens,
					cacheWriteTokens: usageSnapshot.cacheWriteTokens,
					cacheReadTokens: usageSnapshot.cacheReadTokens,
					totalCost: this.calculateCost(
						usageSnapshot.inputTokens,
						usageSnapshot.outputTokens,
						usageSnapshot.cacheReadTokens,
						usageSnapshot.cacheWriteTokens,
					),
					id: responseId,
				};
				break;
			}

			case "content_block_start": {
				const block = chunk.content_block;
				switch (block.type) {
					case "thinking":
						yield {
							type: "reasoning",
							reasoning:
								typeof (block as { thinking?: unknown }).thinking === "string"
									? ((block as { thinking: string }).thinking ?? "")
									: "",
							signature:
								typeof (block as { signature?: unknown }).signature === "string"
									? ((block as { signature: string }).signature ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "redacted_thinking":
						yield {
							type: "reasoning",
							reasoning: "",
							redacted_data:
								typeof (block as { data?: unknown }).data === "string"
									? ((block as { data: string }).data ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "text":
						yield { type: "text", text: "", id: responseId };
						break;
					case "tool_use":
						currentToolCall.id = block.id;
						currentToolCall.name = block.name;
						currentToolCall.arguments = "";
						break;
				}
				break;
			}

			case "content_block_delta": {
				const delta = chunk.delta;
				switch (delta.type) {
					case "thinking_delta":
						yield {
							type: "reasoning",
							reasoning: delta.thinking,
							id: responseId,
						};
						break;
					case "signature_delta":
						yield {
							type: "reasoning",
							reasoning: "",
							signature:
								typeof (delta as { signature?: unknown }).signature === "string"
									? ((delta as { signature: string }).signature ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "text_delta":
						yield { type: "text", text: delta.text, id: responseId };
						break;
					case "input_json_delta":
						currentToolCall.arguments += delta.partial_json;
						break;
				}
				break;
			}

			case "content_block_stop": {
				// If we have a tool call, yield it
				if (currentToolCall.id) {
					let parsedArgs: string | Record<string, unknown>;
					try {
						parsedArgs = JSON.parse(currentToolCall.arguments || "{}");
					} catch {
						// Preserve the raw JSON fragment so downstream can classify it
						// as an invalid tool call instead of silently turning it into {}.
						parsedArgs = currentToolCall.arguments;
					}

					yield {
						type: "tool_calls",
						id: responseId,
						tool_call: {
							call_id: currentToolCall.id,
							function: {
								name: currentToolCall.name,
								arguments: parsedArgs,
							},
						},
					};

					// Reset tool call state
					currentToolCall.id = "";
					currentToolCall.name = "";
					currentToolCall.arguments = "";
				}
				break;
			}
		}
	}
}
