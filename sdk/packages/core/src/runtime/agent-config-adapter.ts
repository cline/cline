/**
 * Cross-shape adapters between the **legacy host API** types
 * (`ApiHandler`, `Tool`, `MessageWithMetadata`) and the **new
 * runtime contract** types (`AgentModel`, `AgentTool`,
 * `AgentMessage`) consumed by `AgentRuntime`.
 *
 * @see PLAN.md §3.1   — pure adapters; introduced alongside the core
 *                       runtime port.
 * @see PLAN.md §3.2.1 — consumed by `createAgentRuntimeConfig` to
 *                       populate the `model`, `tools`, and
 *                       `initialMessages` fields.
 *
 * These functions are intentionally **pure** (stateless adapters —
 * they allocate fresh closures / arrays on every call and hold no
 * internal state). Any state a consumer needs (e.g. an `AbortSignal`
 * or a conversation id for `ToolContext.conversationId`) is injected
 * per-call via the second-arg options object.
 */

import type {
	ApiHandler,
	ApiStreamChunk,
	ToolDefinition,
} from "@clinebot/llms";
import type {
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTextPart,
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	Tool,
	ToolContext,
	ToolResultContent,
	ToolUseContent,
} from "@clinebot/shared";

// =============================================================================
// ApiHandler → AgentModel
// =============================================================================

/**
 * Context describing the model the `ApiHandler` talks to. This is
 * used to populate `AgentMessage.modelInfo` on assistant messages
 * emitted by the runtime. Matches PLAN.md §3.2.1 —
 * `messageModelInfo = { id: modelId, provider: providerId, family:
 * providerConfig?.family }`.
 */
export interface ApiHandlerAgentModelOptions {
	/** Optional provider-family hint (e.g. `"claude-3.5"`). Attached as metadata. */
	readonly family?: string;
	/**
	 * Optional abort-signal factory. When provided, the returned
	 * `AgentModel.stream()` installs the signal on the handler via
	 * `handler.setAbortSignal()` before each call, and threads
	 * `request.signal` through for per-turn abort semantics.
	 */
	readonly getAbortSignal?: () => AbortSignal | undefined;
}

/**
 * Build an `AgentModel` adapter around an existing `ApiHandler`.
 *
 * The returned adapter:
 *
 *  1. Converts `AgentModelRequest.messages` (`AgentMessage[]`) back
 *     into `LlmsProviders.Message[]` via
 *     {@link agentMessagesToMessages}.
 *  2. Converts `AgentModelRequest.tools`
 *     (`AgentToolDefinition[]`) to `LlmsProviders.ToolDefinition[]`.
 *  3. Invokes `handler.createMessage(systemPrompt, messages, tools)`.
 *  4. Iterates the returned `ApiStream` and yields
 *     `AgentModelEvent`s produced by {@link apiStreamChunkToAgentModelEvent}.
 */
export function apiHandlerToAgentModel(
	handler: ApiHandler,
	options: ApiHandlerAgentModelOptions = {},
): AgentModel {
	return {
		async stream(
			request: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
			const signal = options.getAbortSignal?.() ?? request.signal;
			handler.setAbortSignal?.(signal);
			const systemPrompt = request.systemPrompt ?? "";
			const messages = agentMessagesToMessages(request.messages);
			const tools = agentToolDefinitionsToToolDefinitions(request.tools);
			const stream = handler.createMessage(systemPrompt, messages, tools);
			return translateApiStream(stream);
		},
	};
}

/**
 * Translate an `ApiStream` (async generator of `ApiStreamChunk`)
 * into an async iterable of `AgentModelEvent`. Exposed for tests;
 * production callers go through {@link apiHandlerToAgentModel}.
 */
export async function* translateApiStream(
	stream: AsyncIterable<ApiStreamChunk>,
): AsyncIterable<AgentModelEvent> {
	let sawFinish = false;
	try {
		for await (const chunk of stream) {
			const event = apiStreamChunkToAgentModelEvent(chunk);
			if (event) {
				yield event;
			}
			if (chunk.type === "done") {
				sawFinish = true;
			}
		}
	} catch (error) {
		yield {
			type: "finish",
			reason: "error",
			error: error instanceof Error ? error.message : String(error),
		};
		return;
	}
	if (!sawFinish) {
		yield { type: "finish", reason: "stop" };
	}
}

/**
 * Map a single `ApiStreamChunk` to the corresponding
 * `AgentModelEvent`. Returns `undefined` for chunks that carry no
 * runtime-observable payload (currently none — but the hook exists
 * so we can silently drop future additions without type breakage).
 */
export function apiStreamChunkToAgentModelEvent(
	chunk: ApiStreamChunk,
): AgentModelEvent | undefined {
	switch (chunk.type) {
		case "text":
			return { type: "text-delta", text: chunk.text };
		case "reasoning": {
			const metadata: Record<string, unknown> = {};
			if (chunk.signature !== undefined) {
				metadata.signature = chunk.signature;
			}
			if (chunk.details !== undefined) {
				metadata.details = chunk.details;
			}
			return {
				type: "reasoning-delta",
				text: chunk.reasoning,
				redacted: chunk.redacted_data !== undefined,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}
		case "tool_calls": {
			const fn = chunk.tool_call.function;
			const args = fn.arguments;
			const inputText = typeof args === "string" ? args : undefined;
			const input =
				args && typeof args === "object" ? (args as unknown) : undefined;
			const metadata: Record<string, unknown> = {};
			if (chunk.signature !== undefined) {
				metadata.thoughtSignature = chunk.signature;
			}
			return {
				type: "tool-call-delta",
				toolCallId: fn.id ?? chunk.tool_call.call_id,
				toolName: fn.name,
				inputText,
				input,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}
		case "usage":
			return {
				type: "usage",
				usage: {
					inputTokens: chunk.inputTokens,
					outputTokens: chunk.outputTokens,
					cacheReadTokens: chunk.cacheReadTokens,
					cacheWriteTokens: chunk.cacheWriteTokens,
					totalCost: chunk.totalCost,
				},
			};
		case "done":
			if (chunk.success === false) {
				return { type: "finish", reason: "error", error: chunk.error };
			}
			if (chunk.incompleteReason === "max_tokens") {
				return { type: "finish", reason: "max-tokens" };
			}
			return { type: "finish", reason: "stop" };
		default: {
			const _exhaustive: never = chunk;
			return _exhaustive;
		}
	}
}

// =============================================================================
// Tool[] → AgentTool[]
// =============================================================================

/**
 * Options threaded into every adapted tool's `ToolContext`.
 */
export interface ToolAdapterOptions {
	/**
	 * Conversation id bound to every `ToolContext.conversationId`
	 * the tool's `execute()` receives. The new runtime scopes tools
	 * by `AgentToolContext.agentId`/`.runId`; the legacy `ToolContext`
	 * requires `conversationId` separately, so the caller
	 * (`SessionRuntime`) supplies it once at adapter-construction
	 * time.
	 */
	readonly conversationId: string;
	/**
	 * Optional metadata merged into every tool execution
	 * (`AgentConfig.toolContextMetadata` equivalent).
	 */
	readonly metadata?: Record<string, unknown>;
}

/**
 * Adapt a legacy `Tool<TInput, TOutput>` to the new
 * `AgentTool<TInput, TOutput>`.
 *
 *  - name/description/inputSchema flow through verbatim;
 *  - `execute(input, AgentToolContext)` is wrapped so the legacy
 *    signature `execute(input, ToolContext, onChange)` receives the
 *    correct fields and the return value is boxed into an
 *    `AgentToolResult`.
 */
export function toolToAgentTool<TInput, TOutput>(
	tool: Tool<TInput, TOutput>,
	options: ToolAdapterOptions,
): AgentTool<TInput, TOutput> {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
		async execute(
			input: TInput,
			context: AgentToolContext,
		): Promise<AgentToolResult<TOutput>> {
			const legacyContext: ToolContext = {
				agentId: context.agentId,
				conversationId: options.conversationId,
				iteration: context.iteration,
				abortSignal: context.signal,
				metadata: options.metadata,
			};
			try {
				const output = await tool.execute(
					input,
					legacyContext,
					context.emitUpdate,
				);
				return { output };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					output: message as unknown as TOutput,
					isError: true,
				};
			}
		},
	};
}

/**
 * Convenience bulk-adapter for `AgentConfig.tools`.
 */
export function toolsToAgentTools(
	tools: readonly Tool[],
	options: ToolAdapterOptions,
): AgentTool[] {
	return tools.map((tool) => toolToAgentTool(tool, options));
}

// =============================================================================
// MessageWithMetadata[] ↔ AgentMessage[]
// =============================================================================

/**
 * Normalize a single `MessageWithMetadata` into an `AgentMessage`.
 *
 * Role mapping: the legacy `MessageRole` is `"user" | "assistant"`.
 * `tool_result` content blocks on user messages are hoisted into a
 * dedicated `AgentMessage` with role `"tool"` — matching how the new
 * runtime's tool executor emits tool messages
 * (`packages/agents/src/agent-runtime.ts` tool-finished path).
 */
export function messageToAgentMessages(
	message: MessageWithMetadata,
): AgentMessage[] {
	const blocks = normalizeContentBlocks(message.content);
	const toolResults = blocks.filter(
		(block): block is ToolResultContent => block.type === "tool_result",
	);
	const nonToolResults = blocks.filter((block) => block.type !== "tool_result");

	const out: AgentMessage[] = [];

	if (nonToolResults.length > 0 || toolResults.length === 0) {
		out.push({
			id: message.id ?? generateMessageId(),
			role: message.role,
			content: nonToolResults.map(contentBlockToAgentPart),
			createdAt: message.ts ?? Date.now(),
			metadata: message.metadata,
			modelInfo: message.modelInfo,
			metrics: metricsToAgentMetrics(message.metrics),
		});
	}

	for (const toolResult of toolResults) {
		out.push({
			id: `${message.id ?? generateMessageId()}_tool_${toolResult.tool_use_id}`,
			role: "tool",
			content: [toolResultContentToAgentPart(toolResult)],
			createdAt: message.ts ?? Date.now(),
			metadata: message.metadata,
		});
	}

	return out;
}

/**
 * Bulk-adapter: `MessageWithMetadata[]` → `AgentMessage[]`. A single
 * legacy message with both text and tool-result blocks may expand
 * into multiple agent messages (see {@link messageToAgentMessages}).
 */
export function messagesToAgentMessages(
	messages: readonly MessageWithMetadata[],
): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (const message of messages) {
		out.push(...messageToAgentMessages(message));
	}
	return out;
}

/**
 * Reverse adapter: `AgentMessage` → `MessageWithMetadata`. Best-effort
 * preservation of id/metadata/modelInfo/metrics; tool-message
 * tool-result parts are rendered as `tool_result` content blocks on
 * a user message (matching legacy storage conventions).
 */
export function agentMessageToMessageWithMetadata(
	message: AgentMessage,
): MessageWithMetadata {
	const content = message.content
		.map(agentPartToContentBlock)
		.filter((block): block is ContentBlock => block !== undefined);
	return {
		id: message.id,
		role: message.role === "tool" ? "user" : message.role,
		content,
		ts: message.createdAt,
		metadata: message.metadata,
		modelInfo: message.modelInfo,
		metrics: agentMetricsToMetrics(message.metrics),
	};
}

/**
 * Bulk-adapter for the reverse direction.
 */
export function agentMessagesToMessagesWithMetadata(
	messages: readonly AgentMessage[],
): MessageWithMetadata[] {
	return messages.map(agentMessageToMessageWithMetadata);
}

/**
 * Lossy but adequate: `AgentMessage[]` → `LlmsProviders.Message[]`.
 * Used to feed the legacy `ApiHandler.createMessage()` in
 * {@link apiHandlerToAgentModel}. Drops fields that the handler
 * does not consume (id, ts, metrics, modelInfo).
 */
export function agentMessagesToMessages(
	messages: readonly AgentMessage[],
): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		const content = message.content
			.map(agentPartToContentBlock)
			.filter((block): block is ContentBlock => block !== undefined);
		const role = message.role === "tool" ? "user" : message.role;

		// AI SDK validates that assistant tool calls are followed by a single
		// tool-result message containing results for every call in that turn.
		// The AgentRuntime stores each executed tool as its own role:"tool"
		// message; merge adjacent tool messages back into one legacy user
		// message so multi-tool turns round-trip correctly.
		const previous = out[out.length - 1];
		if (
			role === "user" &&
			content.length > 0 &&
			content.every((block) => block.type === "tool_result") &&
			previous?.role === "user" &&
			Array.isArray(previous.content) &&
			previous.content.every((block) => block.type === "tool_result")
		) {
			previous.content.push(...content);
			continue;
		}

		out.push({ role, content });
	}
	return out;
}

/**
 * Map runtime `AgentToolDefinition[]` to legacy
 * `LlmsProviders.ToolDefinition[]`. Structurally identical today —
 * but typing them separately keeps the adapter explicit.
 */
export function agentToolDefinitionsToToolDefinitions(
	tools: AgentModelRequest["tools"],
): ToolDefinition[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

// =============================================================================
// Content-block / part translation
// =============================================================================

function normalizeContentBlocks(content: Message["content"]): ContentBlock[] {
	if (typeof content === "string") {
		return content.length > 0
			? [{ type: "text", text: content } as TextContent]
			: [];
	}
	return [...content];
}

function contentBlockToAgentPart(block: ContentBlock): AgentMessagePart {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "thinking":
			return {
				type: "reasoning",
				text: block.thinking,
				metadata: block.signature
					? { signature: block.signature, details: block.details }
					: block.details
						? { details: block.details }
						: undefined,
			};
		case "redacted_thinking":
			return {
				type: "reasoning",
				text: "",
				redacted: true,
				metadata: { data: block.data },
			};
		case "image":
			return {
				type: "image",
				image: block.data,
				mediaType: block.mediaType,
			};
		case "file":
			return {
				type: "file",
				path: block.path,
				content: block.content,
			};
		case "tool_use":
			return {
				type: "tool-call",
				toolCallId: block.id,
				toolName: block.name,
				input: block.input,
				metadata: block.signature ? { signature: block.signature } : undefined,
			};
		case "tool_result":
			return toolResultContentToAgentPart(block);
		default: {
			const _exhaustive: never = block;
			return _exhaustive;
		}
	}
}

function toolResultContentToAgentPart(
	block: ToolResultContent,
): AgentMessagePart {
	return {
		type: "tool-result",
		toolCallId: block.tool_use_id,
		toolName: "",
		output: block.content,
		isError: block.is_error,
	};
}

function agentPartToContentBlock(
	part: AgentMessagePart,
): ContentBlock | undefined {
	switch (part.type) {
		case "text":
			return { type: "text", text: (part as AgentTextPart).text };
		case "reasoning": {
			if (part.redacted === true) {
				const data =
					(part.metadata as { data?: string } | undefined)?.data ?? "";
				return {
					type: "redacted_thinking",
					data,
				} satisfies RedactedThinkingContent;
			}
			const metadata = part.metadata as
				| { signature?: string; details?: unknown[] }
				| undefined;
			return {
				type: "thinking",
				thinking: part.text,
				signature: metadata?.signature,
				details: metadata?.details,
			} satisfies ThinkingContent;
		}
		case "image": {
			if (typeof part.image !== "string") {
				// Binary images are not round-trippable through the legacy
				// `ImageContent.data: string` field; drop them.
				return undefined;
			}
			return {
				type: "image",
				data: part.image,
				mediaType: part.mediaType ?? "image/png",
			} satisfies ImageContent;
		}
		case "file":
			return {
				type: "file",
				path: part.path,
				content: part.content,
			} satisfies FileContent;
		case "tool-call":
			return {
				type: "tool_use",
				id: part.toolCallId,
				name: part.toolName,
				input: (part.input as Record<string, unknown>) ?? {},
				signature: (part.metadata as { signature?: string } | undefined)
					?.signature,
			} satisfies ToolUseContent;
		case "tool-result": {
			const output = part.output;
			const content =
				typeof output === "string"
					? output
					: Array.isArray(output)
						? (output as ToolResultContent["content"])
						: JSON.stringify(output);
			return {
				type: "tool_result",
				tool_use_id: part.toolCallId,
				content,
				is_error: part.isError,
			} satisfies ToolResultContent;
		}
		default: {
			const _exhaustive: never = part;
			return _exhaustive;
		}
	}
}

function metricsToAgentMetrics(
	metrics: MessageWithMetadata["metrics"],
): AgentMessage["metrics"] {
	if (!metrics) {
		return undefined;
	}
	return {
		inputTokens: metrics.inputTokens ?? 0,
		outputTokens: metrics.outputTokens ?? 0,
		cacheReadTokens: metrics.cacheReadTokens ?? 0,
		cacheWriteTokens: metrics.cacheWriteTokens ?? 0,
		cost: metrics.cost,
	};
}

function agentMetricsToMetrics(
	metrics: AgentMessage["metrics"],
): MessageWithMetadata["metrics"] {
	if (!metrics) {
		return undefined;
	}
	return {
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cacheReadTokens: metrics.cacheReadTokens,
		cacheWriteTokens: metrics.cacheWriteTokens,
		cost: metrics.cost,
	};
}

let _msgSeq = 0;
function generateMessageId(): string {
	_msgSeq += 1;
	return `msg_${Date.now().toString(36)}_${_msgSeq.toString(36)}`;
}
