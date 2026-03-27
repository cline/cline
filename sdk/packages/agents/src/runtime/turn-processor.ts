import type * as LlmsProviders from "@clinebot/llms/providers";
import { parseJsonStream } from "@clinebot/shared";
import type { MessageBuilder } from "../message-builder.js";
import { toToolDefinitions } from "../tools/index.js";
import type {
	AgentEvent,
	PendingToolCall,
	ProcessedTurn,
	Tool,
} from "../types.js";

export interface TurnProcessorOptions {
	handler: LlmsProviders.ApiHandler;
	messageBuilder: MessageBuilder;
	emit: (event: AgentEvent) => void;
}

export class TurnProcessor {
	private readonly handler: LlmsProviders.ApiHandler;
	private readonly messageBuilder: MessageBuilder;
	private readonly emit: (event: AgentEvent) => void;

	constructor(options: TurnProcessorOptions) {
		this.handler = options.handler;
		this.messageBuilder = options.messageBuilder;
		this.emit = options.emit;
	}

	async processTurn(
		messages: LlmsProviders.Message[],
		systemPrompt: string,
		tools: Tool[],
		abortSignal: AbortSignal,
	): Promise<{
		turn: ProcessedTurn;
		assistantMessage?: LlmsProviders.Message;
	}> {
		const toolDefinitions = toToolDefinitions(tools);
		const requestMessages = this.messageBuilder.buildForApi(messages);
		const stream = this.handler.createMessage(
			systemPrompt,
			requestMessages,
			toolDefinitions,
		);

		let text = "";
		let textSignature: string | undefined;
		let reasoning = "";
		let reasoningSignature: string | undefined;
		const redactedReasoningBlocks: string[] = [];
		const usage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: undefined as number | undefined,
			cacheWriteTokens: undefined as number | undefined,
			cost: undefined as number | undefined,
		};
		let truncated = false;
		let responseId: string | undefined;

		const pendingToolCallsMap = new Map<
			string,
			{ name?: string; arguments: string | null; signature?: string }
		>();
		const toolCallIdAliases = new Map<string, string>();

		for await (const chunk of stream) {
			if (abortSignal.aborted) {
				break;
			}

			responseId = chunk.id ?? responseId;

			switch (chunk.type) {
				case "text":
					text += chunk.text;
					if (chunk.signature) {
						textSignature = chunk.signature;
					}
					this.emit({
						type: "content_start",
						contentType: "text",
						text: chunk.text,
						accumulated: text,
					});
					break;
				case "reasoning":
					reasoning += chunk.reasoning;
					if (chunk.signature) {
						reasoningSignature = chunk.signature;
					}
					if (chunk.redacted_data) {
						redactedReasoningBlocks.push(chunk.redacted_data);
					}
					this.emit({
						type: "content_start",
						contentType: "reasoning",
						reasoning: chunk.reasoning,
						redacted: !!chunk.redacted_data,
					});
					break;
				case "tool_calls":
					this.processToolCallChunk(
						chunk,
						pendingToolCallsMap,
						toolCallIdAliases,
					);
					break;
				case "usage":
					usage.inputTokens = chunk.inputTokens;
					usage.outputTokens = chunk.outputTokens;
					usage.cacheReadTokens = chunk.cacheReadTokens;
					usage.cacheWriteTokens = chunk.cacheWriteTokens;
					usage.cost = chunk.totalCost;
					break;
				case "done":
					truncated = chunk.incompleteReason === "max_tokens";
					if (!chunk.success && chunk.error) {
						throw new Error(chunk.error);
					}
					break;
			}
		}

		if (abortSignal.aborted) {
			const reason = abortSignal.reason;
			if (reason instanceof Error) {
				throw reason;
			}
			if (typeof reason === "string" && reason.trim().length > 0) {
				throw new Error(reason);
			}
			throw new Error("model request aborted");
		}

		const toolCalls = this.finalizePendingToolCalls(pendingToolCallsMap);
		const invalidToolCalls = this.collectInvalidToolCalls(pendingToolCallsMap);
		const assistantContent: LlmsProviders.ContentBlock[] = [];

		if (text) {
			this.emit({
				type: "content_end",
				contentType: "text",
				text,
			});
		}
		if (reasoning || redactedReasoningBlocks.length > 0) {
			this.emit({
				type: "content_end",
				contentType: "reasoning",
				reasoning,
			});
			assistantContent.push({
				type: "thinking",
				thinking: reasoning,
				signature: reasoningSignature,
			});
			for (const redactedData of redactedReasoningBlocks) {
				assistantContent.push({
					type: "redacted_thinking",
					data: redactedData,
				});
			}
		}
		if (text) {
			assistantContent.push({ type: "text", text, signature: textSignature });
		}
		for (const call of toolCalls) {
			assistantContent.push({
				type: "tool_use",
				id: call.id,
				name: call.name,
				input: call.input as Record<string, unknown>,
				signature: call.signature,
			});
		}
		for (const call of invalidToolCalls) {
			assistantContent.push({
				type: "tool_use",
				id: call.id,
				name: call.name?.trim() || "(unknown tool)",
				input: this.toPersistedInvalidToolInput(call.input),
			});
		}

		const assistantMessage =
			assistantContent.length > 0
				? {
						role: "assistant" as const,
						content: assistantContent,
					}
				: undefined;

		return {
			turn: {
				text,
				reasoning: reasoning || undefined,
				toolCalls,
				invalidToolCalls,
				usage,
				truncated,
				responseId,
			},
			assistantMessage,
		};
	}

	private processToolCallChunk(
		chunk: LlmsProviders.ApiStreamChunk & { type: "tool_calls" },
		pendingMap: Map<
			string,
			{ name?: string; arguments: string | null; signature?: string }
		>,
		aliasMap: Map<string, string>,
	): void {
		const { tool_call } = chunk;
		const functionId = tool_call.function.id;
		const callId = tool_call.call_id;
		const canonicalId =
			(functionId ? aliasMap.get(functionId) : undefined) ??
			(callId ? aliasMap.get(callId) : undefined) ??
			functionId ??
			callId ??
			`call_${Date.now()}`;
		if (functionId) {
			aliasMap.set(functionId, canonicalId);
		}
		if (callId) {
			aliasMap.set(callId, canonicalId);
		}

		let pending = pendingMap.get(canonicalId);
		if (!pending) {
			pending = { name: undefined, arguments: null };
			pendingMap.set(canonicalId, pending);
		}

		if (tool_call.function.name) {
			pending.name = tool_call.function.name;
		}

		if (tool_call.function.arguments != null) {
			if (typeof tool_call.function.arguments === "string") {
				// Provider handlers are responsible for normalizing cumulative
				// snapshots into deltas. Re-interpreting string chunks here can
				// corrupt valid payloads when a later suffix happens to start with
				// "[" or "{" inside a JSON string value.
				pending.arguments =
					(pending.arguments ?? "") + tool_call.function.arguments;
			} else {
				pending.arguments = JSON.stringify(tool_call.function.arguments);
			}
		}
		if (chunk.signature) {
			pending.signature = chunk.signature;
		}
	}

	private finalizePendingToolCalls(
		pendingMap: Map<
			string,
			{ name?: string; arguments: string | null; signature?: string }
		>,
	): PendingToolCall[] {
		const toolCalls: PendingToolCall[] = [];
		for (const [id, pending] of pendingMap.entries()) {
			if (!pending.name || pending.arguments == null) {
				continue;
			}
			// Treat empty string as empty object — tools with no parameters
			// receive "" from OpenAI-compatible streaming deltas.
			const argsToParse = pending.arguments || "{}";
			const parsed = this.parseToolArguments(argsToParse);
			if (!parsed.ok) {
				continue;
			}
			toolCalls.push({
				id,
				name: pending.name,
				input: parsed.value,
				signature: pending.signature,
			});
		}
		return toolCalls;
	}

	private collectInvalidToolCalls(
		pendingMap: Map<
			string,
			{ name?: string; arguments: string | null; signature?: string }
		>,
	): Array<{
		id: string;
		name?: string;
		input?: unknown;
		reason: "missing_name" | "missing_arguments" | "invalid_arguments";
	}> {
		const invalid: Array<{
			id: string;
			name?: string;
			input?: unknown;
			reason: "missing_name" | "missing_arguments" | "invalid_arguments";
		}> = [];
		for (const [id, pending] of pendingMap.entries()) {
			if (!pending.name) {
				invalid.push({
					id,
					input: this.buildInvalidToolInput(pending.arguments ?? ""),
					reason: "missing_name",
				});
				continue;
			}
			if (pending.arguments == null) {
				invalid.push({
					id,
					name: pending.name,
					input: {},
					reason: "missing_arguments",
				});
				continue;
			}
			// Treat empty string as empty object — tools with no parameters
			// receive "" from OpenAI-compatible streaming deltas.
			const argsToParse = pending.arguments || "{}";
			const parsed = this.parseToolArguments(argsToParse);
			if (!parsed.ok) {
				invalid.push({
					id,
					name: pending.name,
					input: this.buildInvalidToolInput(pending.arguments, parsed.error),
					reason: "invalid_arguments",
				});
			}
		}
		return invalid;
	}

	private buildInvalidToolInput(value: string, parseError?: string): unknown {
		const trimmed = value.trim();
		if (!trimmed) {
			return {};
		}
		return parseError
			? { raw_arguments: value, parse_error: parseError }
			: { raw_arguments: value };
	}

	private toPersistedInvalidToolInput(input: unknown): Record<string, unknown> {
		if (input && typeof input === "object" && !Array.isArray(input)) {
			return input as Record<string, unknown>;
		}
		if (Array.isArray(input)) {
			return { raw_arguments: JSON.stringify(input) };
		}
		if (input === undefined) {
			return {};
		}
		return { raw_arguments: String(input) };
	}

	private tryParseJson(value: string): unknown | undefined {
		const parsed = parseJsonStream(value);
		return parsed === value ? undefined : parsed;
	}

	private parseToolArguments(
		value: string,
	): { ok: true; value: unknown } | { ok: false; error: string } {
		const trimmed = value.trim();
		if (!trimmed) {
			return { ok: false, error: "Tool call arguments were empty." };
		}

		const parsed = this.tryParseJson(value);
		if (parsed !== undefined) {
			return { ok: true, value: parsed };
		}

		if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
			return {
				ok: false,
				error: "Tool call arguments must be encoded as a JSON object or array.",
			};
		}

		return {
			ok: false,
			error:
				"Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
		};
	}
}
