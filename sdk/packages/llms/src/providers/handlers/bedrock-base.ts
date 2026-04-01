import { convertToolsToAnthropic } from "../transform/anthropic-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	type ProviderConfig,
	supportsModelThinking,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import { BaseHandler } from "./base";
import { createBedrockClient } from "./bedrock-client";

const CLAUDE_SONNET_1M_SUFFIX = ":1m";

type AiModule = {
	streamText: (input: Record<string, unknown>) => {
		fullStream?: AsyncIterable<{ type?: string; [key: string]: unknown }>;
		textStream?: AsyncIterable<string>;
		usage?: Promise<{
			inputTokens?: number;
			outputTokens?: number;
			reasoningTokens?: number;
			cachedInputTokens?: number;
			[key: string]: unknown;
		}>;
	};
};

let cachedAiModule: AiModule | undefined;
const DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const DEFAULT_REASONING_EFFORT = "medium" as const;

async function loadAiModule(): Promise<AiModule> {
	if (cachedAiModule) {
		return cachedAiModule;
	}

	const moduleName = "ai";
	cachedAiModule = (await import(moduleName)) as AiModule;
	return cachedAiModule;
}

type ModelMessagePart = Record<string, unknown>;
type ModelMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ModelMessagePart[];
};

/**
 * Handler for AWS Bedrock using AI SDK's Amazon Bedrock provider.
 *
 * This handler is async-lazy loaded via createHandlerAsync.
 */
export class BedrockHandler extends BaseHandler {
	private clientFactory: ((modelId: string) => unknown) | undefined;

	private async ensureClientFactory(): Promise<(modelId: string) => unknown> {
		if (!this.clientFactory) {
			this.clientFactory = await createBedrockClient(
				this.config,
				this.getRequestHeaders(),
			);
		}
		return this.clientFactory;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		if (!modelId) {
			throw new Error("Model ID is required. Set modelId in config.");
		}

		const modelInfo =
			this.config.modelInfo ?? this.config.knownModels?.[modelId] ?? {};
		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	getMessages(systemPrompt: string, messages: Message[]): ModelMessage[] {
		return toModelMessages(systemPrompt, messages);
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		yield* retryStream(
			() => this.createMessageInternal(systemPrompt, messages, tools),
			{ maxRetries: 4 },
		);
	}

	private async *createMessageInternal(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const ai = await loadAiModule();
		const factory = await this.ensureClientFactory();
		const responseId = this.createResponseId();
		const abortSignal = this.getAbortSignal();
		const model = this.getModel();

		let modelId = model.id;
		const providerOptions: Record<string, unknown> = {};
		const bedrockOptions: Record<string, unknown> = {};

		if (modelId.endsWith(CLAUDE_SONNET_1M_SUFFIX)) {
			modelId = modelId.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length);
			bedrockOptions.anthropicBeta = ["context-1m-2025-08-07"];
		}

		const thinkingSupported = supportsModelThinking(model.info);
		const budgetTokens =
			this.config.thinkingBudgetTokens ??
			(this.config.thinking ? DEFAULT_THINKING_BUDGET_TOKENS : 0);
		let reasoningEnabled = false;
		if (
			thinkingSupported &&
			budgetTokens > 0 &&
			modelId.includes("anthropic")
		) {
			bedrockOptions.reasoningConfig = { type: "enabled", budgetTokens };
			reasoningEnabled = true;
		} else if (thinkingSupported && modelId.includes("amazon.nova")) {
			const reasoningEffort =
				this.config.reasoningEffort ??
				(this.config.thinking ? DEFAULT_REASONING_EFFORT : undefined);
			if (reasoningEffort) {
				bedrockOptions.reasoningConfig = {
					type: "enabled",
					maxReasoningEffort: reasoningEffort,
				};
				reasoningEnabled = true;
			}
		}

		if (Object.keys(bedrockOptions).length > 0) {
			providerOptions.bedrock = bedrockOptions;
		}

		const stream = ai.streamText({
			model: factory(modelId),
			messages: this.getMessages(systemPrompt, messages),
			tools: toAiSdkTools(tools),
			maxTokens: model.info.maxTokens ?? this.config.maxOutputTokens ?? 128_000,
			temperature: reasoningEnabled ? undefined : (model.info.temperature ?? 0),
			providerOptions:
				Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
			abortSignal,
		});

		let usageEmitted = false;

		if (stream.fullStream) {
			for await (const part of stream.fullStream) {
				const partType = part.type;

				if (partType === "text-delta") {
					const text =
						(part.textDelta as string | undefined) ??
						(part.delta as string | undefined);
					if (text) {
						yield { type: "text", text, id: responseId };
					}
					continue;
				}

				if (partType === "reasoning-delta" || partType === "reasoning") {
					const reasoning =
						(part.textDelta as string | undefined) ??
						(part.reasoning as string | undefined);
					if (reasoning) {
						yield { type: "reasoning", reasoning, id: responseId };
					}
					continue;
				}

				if (partType === "tool-call") {
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined);
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined);
					const args = (part.args as Record<string, unknown> | undefined) ?? {};

					yield {
						type: "tool_calls",
						id: responseId,
						tool_call: {
							call_id: toolCallId,
							function: {
								name: toolName,
								arguments: args,
							},
						},
					};
					continue;
				}

				if (partType === "error") {
					const message =
						(part.error as Error | undefined)?.message ??
						"Bedrock stream failed";
					throw new Error(message);
				}

				if (partType === "finish") {
					const usage =
						(part.usage as Record<string, unknown> | undefined) ?? {};
					const inputTokens = numberOrZero(usage.inputTokens);
					const outputTokens = numberOrZero(usage.outputTokens);
					const thoughtsTokenCount = numberOrZero(usage.reasoningTokens);
					const cacheReadTokens = numberOrZero(usage.cachedInputTokens);

					yield {
						type: "usage",
						inputTokens,
						outputTokens,
						thoughtsTokenCount,
						cacheReadTokens,
						totalCost: this.calculateCostFromInclusiveInput(
							inputTokens,
							outputTokens,
							cacheReadTokens,
						),
						id: responseId,
					};
					usageEmitted = true;
				}
			}
		} else if (stream.textStream) {
			for await (const text of stream.textStream) {
				yield { type: "text", text, id: responseId };
			}
		}

		if (!usageEmitted && stream.usage) {
			const usage = await stream.usage;
			const inputTokens = numberOrZero(usage.inputTokens);
			const outputTokens = numberOrZero(usage.outputTokens);
			const thoughtsTokenCount = numberOrZero(usage.reasoningTokens);
			const cacheReadTokens = numberOrZero(usage.cachedInputTokens);

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				thoughtsTokenCount,
				cacheReadTokens,
				totalCost: this.calculateCostFromInclusiveInput(
					inputTokens,
					outputTokens,
					cacheReadTokens,
				),
				id: responseId,
			};
		}

		yield { type: "done", success: true, id: responseId };
	}
}

export function createBedrockHandler(config: ProviderConfig): BedrockHandler {
	return new BedrockHandler(config);
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toAiSdkTools(
	tools: ToolDefinition[] | undefined,
): Record<string, unknown> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	// We keep the same schema shape used by Anthropic conversion.
	const anthropicTools = convertToolsToAnthropic(tools);
	return Object.fromEntries(
		anthropicTools.map((tool) => [
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.input_schema,
			},
		]),
	);
}

function toModelMessages(
	systemPrompt: string,
	messages: Message[],
): ModelMessage[] {
	const result: ModelMessage[] = [{ role: "system", content: systemPrompt }];
	const toolNamesById = new Map<string, string>();

	for (const message of messages) {
		if (typeof message.content === "string") {
			result.push({ role: message.role, content: message.content });
			continue;
		}

		if (message.role === "assistant") {
			const parts: ModelMessagePart[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
					continue;
				}

				if (block.type === "tool_use") {
					toolNamesById.set(block.id, block.name);
					parts.push({
						type: "tool-call",
						toolCallId: block.id,
						toolName: block.name,
						args: block.input,
					});
				}
			}

			if (parts.length > 0) {
				result.push({ role: "assistant", content: parts });
			}
			continue;
		}

		// User message (can include text/image/tool_result blocks)
		const userParts: ModelMessagePart[] = [];

		for (const block of message.content) {
			if (block.type === "text") {
				userParts.push({ type: "text", text: block.text });
				continue;
			}

			if (block.type === "image") {
				userParts.push({
					type: "image",
					image: Buffer.from(block.data, "base64"),
					mediaType: block.mediaType,
				});
				continue;
			}

			if (block.type === "tool_result") {
				if (userParts.length > 0) {
					result.push({
						role: "user",
						content: userParts.splice(0, userParts.length),
					});
				}

				result.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: block.tool_use_id,
							toolName: toolNamesById.get(block.tool_use_id) ?? "tool",
							output: serializeToolResult(block.content),
							isError: block.is_error ?? false,
						},
					],
				});
			}
		}

		if (userParts.length > 0) {
			result.push({ role: "user", content: userParts });
		}
	}

	return result;
}

function serializeToolResult(content: Message["content"] | string): string {
	if (typeof content === "string") {
		return content;
	}

	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}
