/**
 * R1 Message Format Converter
 *
 * Handles the special message format required by DeepSeek Reasoner and other R1-based models.
 * Key requirements:
 * 1. Consecutive messages with the same role must be merged
 * 2. reasoning_content should be passed back during tool calling in the same turn
 * 3. No temperature parameter for reasoner models
 */

import type {
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "@clinebot/shared";
import { formatFileContentBlock } from "@clinebot/shared";
import type OpenAI from "openai";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
type OpenAIContentPart = OpenAI.Chat.ChatCompletionContentPart;

/**
 * DeepSeek Reasoner message format with reasoning_content support
 */
export type R1Message = OpenAI.Chat.ChatCompletionMessageParam & {
	reasoning_content?: string;
};

/**
 * Convert messages to R1 format
 *
 * This handles:
 * 1. Converting content blocks to OpenAI format
 * 2. Merging consecutive messages with the same role
 * 3. Adding reasoning_content for tool calling continuations
 */
export function convertToR1Messages(messages: Message[]): R1Message[] {
	// First convert to OpenAI format
	const openAiMessages = messages.flatMap(convertMessageToOpenAI);

	// Then merge consecutive same-role messages
	const merged = mergeConsecutiveMessages(openAiMessages);

	// Finally add reasoning_content for current turn assistant messages
	return addReasoningContent(merged, messages);
}

/**
 * Convert a single message to OpenAI format (without merging)
 */
function convertMessageToOpenAI(message: Message): OpenAIMessage[] {
	const { role, content } = message;

	// Simple string content
	if (typeof content === "string") {
		return [{ role, content } as OpenAIMessage];
	}

	// Array content - need to process blocks
	if (role === "assistant") {
		return [convertAssistantMessage(content)];
	} else {
		return convertUserMessage(content);
	}
}

function convertAssistantMessage(content: ContentBlock[]): OpenAIMessage {
	const textParts: string[] = [];
	const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

	for (const block of content) {
		switch (block.type) {
			case "text":
				textParts.push((block as TextContent).text);
				break;
			case "file": {
				const fileBlock = block as FileContent;
				textParts.push(
					formatFileContentBlock(fileBlock.path, fileBlock.content),
				);
				break;
			}
			case "tool_use": {
				const toolUse = block as ToolUseContent;
				toolCalls.push({
					id: toolUse.id,
					type: "function",
					function: {
						name: toolUse.name,
						arguments: JSON.stringify(normalizeToolUseInput(toolUse.input)),
					},
				});
				break;
			}
			case "thinking":
				// Thinking blocks are handled separately via reasoning_content
				break;
		}
	}

	const message: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
		role: "assistant",
		content: textParts.length > 0 ? textParts.join("\n") : null,
	};

	if (toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	return message;
}

function convertUserMessage(content: ContentBlock[]): OpenAIMessage[] {
	const messages: OpenAIMessage[] = [];

	// Convert all tool results to separate tool messages
	const toolResults = content.filter(
		(b) => b.type === "tool_result",
	) as ToolResultContent[];
	for (const result of toolResults) {
		messages.push({
			role: "tool",
			tool_call_id: result.tool_use_id,
			content: serializeToolResultContent(result.content),
		});
	}

	// Regular user message with text/images
	const userContent = content.filter((b) => b.type !== "tool_result");
	const parts: OpenAIContentPart[] = [];

	for (const block of userContent) {
		switch (block.type) {
			case "text":
				parts.push({ type: "text", text: (block as TextContent).text });
				break;
			case "image": {
				const img = block as ImageContent;
				parts.push({
					type: "image_url",
					image_url: {
						url: `data:${img.mediaType};base64,${img.data}`,
					},
				});
				break;
			}
			case "file": {
				const fileBlock = block as FileContent;
				parts.push({
					type: "text",
					text: formatFileContentBlock(fileBlock.path, fileBlock.content),
				});
				break;
			}
		}
	}
	if (parts.length === 0) {
		return messages;
	}

	messages.push({
		role: "user",
		content:
			parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts,
	});

	return messages;
}

/**
 * Merge consecutive messages with the same role
 *
 * DeepSeek Reasoner does not support successive messages with the same role,
 * so we need to merge them together.
 */
function mergeConsecutiveMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
	return messages.reduce<OpenAIMessage[]>((merged, message) => {
		const lastMessage = merged[merged.length - 1];

		// Never merge tool messages: each tool response has its own tool_call_id.
		if (lastMessage?.role === message.role && message.role !== "tool") {
			mergeMessageContent(lastMessage, message);
		} else {
			merged.push({ ...message });
		}

		return merged;
	}, []);
}

/**
 * Merge content from source message into target message
 */
function mergeMessageContent(
	target: OpenAIMessage,
	source: OpenAIMessage,
): void {
	const targetContent = (target as any).content;
	const sourceContent = (source as any).content;

	if (typeof targetContent === "string" && typeof sourceContent === "string") {
		(target as any).content = `${targetContent}\n${sourceContent}`;
	} else {
		// Convert to array format and merge
		const targetArray = normalizeToArray(targetContent);
		const sourceArray = normalizeToArray(sourceContent);
		(target as any).content = [...targetArray, ...sourceArray];
	}
}

function normalizeToArray(
	content: string | null | OpenAIContentPart[],
): (
	| OpenAI.Chat.ChatCompletionContentPartText
	| OpenAI.Chat.ChatCompletionContentPartImage
)[] {
	if (content === null || content === undefined) {
		return [];
	}
	if (Array.isArray(content)) {
		return content as (
			| OpenAI.Chat.ChatCompletionContentPartText
			| OpenAI.Chat.ChatCompletionContentPartImage
		)[];
	}
	return [{ type: "text" as const, text: content }];
}

/**
 * Add reasoning_content to assistant messages for DeepSeek Reasoner
 *
 * Per DeepSeek API: reasoning_content should be passed back during tool calling
 * in the same turn, and omitted when starting a new turn.
 */
function addReasoningContent(
	openAiMessages: OpenAIMessage[],
	originalMessages: Message[],
): R1Message[] {
	// Find last user message index (start of current turn)
	let lastUserIndex = -1;
	for (let i = openAiMessages.length - 1; i >= 0; i--) {
		if (openAiMessages[i].role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	// Extract thinking content from original messages, keyed by assistant message index
	const thinkingByIndex = new Map<number, string>();
	let assistantIdx = 0;

	for (const msg of originalMessages) {
		if (msg.role === "assistant") {
			if (Array.isArray(msg.content)) {
				const thinking = msg.content
					.filter((p): p is ThinkingContent => p.type === "thinking")
					.map((p) => p.thinking)
					.join("\n");
				if (thinking) {
					thinkingByIndex.set(assistantIdx, thinking);
				}
			}
			assistantIdx++;
		}
	}

	// Add reasoning_content only to assistant messages in current turn
	let aiIdx = 0;
	return openAiMessages.map((msg, i): R1Message => {
		if (msg.role === "assistant") {
			const thinking = thinkingByIndex.get(aiIdx++);
			if (thinking && i >= lastUserIndex) {
				return { ...msg, reasoning_content: thinking };
			}
		}
		return msg;
	});
}
