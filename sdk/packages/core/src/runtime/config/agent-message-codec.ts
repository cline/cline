import type {
	AgentMessage,
	AgentMessagePart,
	AgentTextPart,
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "@clinebot/shared";

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

export function messagesToAgentMessages(
	messages: readonly MessageWithMetadata[],
): AgentMessage[] {
	return messages.flatMap(messageToAgentMessages);
}

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

export function agentMessagesToMessagesWithMetadata(
	messages: readonly AgentMessage[],
): MessageWithMetadata[] {
	return messages.map(agentMessageToMessageWithMetadata);
}

export function agentMessagesToMessages(
	messages: readonly AgentMessage[],
): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		const content = message.content
			.map(agentPartToContentBlock)
			.filter((block): block is ContentBlock => block !== undefined);
		const role = message.role === "tool" ? "user" : message.role;
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
			return { type: "image", image: block.data, mediaType: block.mediaType };
		case "file":
			return { type: "file", path: block.path, content: block.content };
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
		case "image":
			return typeof part.image === "string"
				? ({
						type: "image",
						data: part.image,
						mediaType: part.mediaType ?? "image/png",
					} satisfies ImageContent)
				: undefined;
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
	}
}

function metricsToAgentMetrics(
	metrics: MessageWithMetadata["metrics"],
): AgentMessage["metrics"] {
	if (!metrics) return undefined;
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
	if (!metrics) return undefined;
	return {
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cacheReadTokens: metrics.cacheReadTokens,
		cacheWriteTokens: metrics.cacheWriteTokens,
		cost: metrics.cost,
	};
}

let msgSeq = 0;
function generateMessageId(): string {
	msgSeq += 1;
	return `msg_${Date.now().toString(36)}_${msgSeq.toString(36)}`;
}
