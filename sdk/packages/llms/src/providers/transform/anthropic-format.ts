/**
 * Anthropic Message Format Converter
 *
 * Converts our unified Message format to Anthropic's MessageParam format.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { formatFileContentBlock } from "@clinebot/shared";
import type {
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "../types/messages";
import { normalizeToolUseInput } from "./content-format";

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContentBlock = Anthropic.ContentBlockParam;

/**
 * Convert messages to Anthropic format
 *
 * @param messages - Messages to convert
 * @param enableCaching - Whether to add cache control markers
 */
export function convertToAnthropicMessages(
	messages: Message[],
	enableCaching = false,
): AnthropicMessage[] {
	const userMessageIndices = messages.reduce<number[]>(
		(indices, message, index) => {
			if (message.role === "user") {
				indices.push(index);
			}
			return indices;
		},
		[],
	);
	const cacheableMessageIndices = enableCaching
		? new Set(userMessageIndices.slice(-2))
		: new Set<number>();
	const result: AnthropicMessage[] = [];

	for (const [index, message] of messages.entries()) {
		const converted = convertMessage(
			message,
			cacheableMessageIndices.has(index),
		);
		if (converted) {
			result.push(converted);
		}
	}

	return result;
}

function convertMessage(
	message: Message,
	addCacheControl: boolean,
): AnthropicMessage | null {
	const { role, content } = message;

	// Simple string content
	if (typeof content === "string") {
		const textBlock: AnthropicContentBlock = { type: "text", text: content };
		if (addCacheControl) {
			(textBlock as any).cache_control = { type: "ephemeral" };
		}
		return { role, content: [textBlock] };
	}

	// Array content - need to process blocks
	const blocks = convertContentBlocks(content, addCacheControl);
	if (blocks.length === 0) {
		return null;
	}

	return { role, content: blocks };
}

function convertContentBlocks(
	content: ContentBlock[],
	addCacheControl: boolean,
): AnthropicContentBlock[] {
	const blocks: AnthropicContentBlock[] = [];

	for (let i = 0; i < content.length; i++) {
		const block = content[i];
		const isLast = i === content.length - 1;
		const converted = convertContentBlock(block, addCacheControl && isLast);
		if (converted) {
			blocks.push(converted);
		}
	}

	return blocks;
}

function convertContentBlock(
	block: ContentBlock,
	addCacheControl: boolean,
): AnthropicContentBlock | null {
	switch (block.type) {
		case "text": {
			const textBlock = block as TextContent;
			const result: AnthropicContentBlock = {
				type: "text",
				text: textBlock.text,
			};
			if (addCacheControl) {
				(result as any).cache_control = { type: "ephemeral" };
			}
			return result;
		}

		case "file": {
			const fileBlock = block as FileContent;
			return {
				type: "text",
				text: formatFileContentBlock(fileBlock.path, fileBlock.content),
			};
		}

		case "image": {
			const imageBlock = block as ImageContent;
			return {
				type: "image",
				source: {
					type: "base64",
					media_type: imageBlock.mediaType as
						| "image/jpeg"
						| "image/png"
						| "image/gif"
						| "image/webp",
					data: imageBlock.data,
				},
			};
		}

		case "tool_use": {
			const toolBlock = block as ToolUseContent;
			return {
				type: "tool_use",
				id: toolBlock.id,
				name: toolBlock.name,
				input: normalizeToolUseInput(toolBlock.input),
			};
		}

		case "tool_result": {
			const resultBlock = block as ToolResultContent;
			let resultContent: Anthropic.ToolResultBlockParam["content"];

			if (typeof resultBlock.content === "string") {
				resultContent = resultBlock.content;
			} else {
				// Convert array of text/image to Anthropic format
				resultContent = resultBlock.content.map((item) => {
					if (item.type === "text") {
						return { type: "text" as const, text: item.text };
					} else if (item.type === "file") {
						const fileItem = item as FileContent;
						return {
							type: "text" as const,
							text: formatFileContentBlock(fileItem.path, fileItem.content),
						};
					} else {
						return {
							type: "image" as const,
							source: {
								type: "base64" as const,
								media_type: item.mediaType as
									| "image/jpeg"
									| "image/png"
									| "image/gif"
									| "image/webp",
								data: item.data,
							},
						};
					}
				});
			}

			return {
				type: "tool_result",
				tool_use_id: resultBlock.tool_use_id,
				content: resultContent,
				is_error: resultBlock.is_error,
			};
		}

		case "thinking": {
			const thinkingBlock = block as ThinkingContent;
			return {
				type: "thinking",
				thinking: thinkingBlock.thinking,
				signature: thinkingBlock.signature,
			} as any; // Anthropic SDK types may not include this yet
		}

		case "redacted_thinking": {
			const redactedBlock = block as RedactedThinkingContent;
			return {
				type: "redacted_thinking",
				data: redactedBlock.data,
			} as any;
		}

		default:
			return null;
	}
}

/**
 * Convert tool definitions to Anthropic format
 */
export function convertToolsToAnthropic(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
): Anthropic.Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
	}));
}
