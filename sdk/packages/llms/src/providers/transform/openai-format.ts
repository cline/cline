/**
 * OpenAI Message Format Converter
 *
 * Converts our unified Message format to OpenAI's ChatCompletionMessageParam format.
 */

import { formatFileContentBlock } from "@clinebot/shared";
import type OpenAI from "openai";
import type {
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "../types/messages";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";
import { normalizeToolInputSchema } from "./tool-schema";

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
type OpenAIContentPart = OpenAI.Chat.ChatCompletionContentPart;

/**
 * Convert messages to OpenAI format
 */
export function convertToOpenAIMessages(
	messages: Message[],
	enableCaching = false,
): OpenAIMessage[] {
	const lastUserIndex = enableCaching
		? messages.map((m) => m.role).lastIndexOf("user")
		: -1;
	return messages.flatMap((message, index) =>
		convertMessage(message, enableCaching && index === lastUserIndex),
	);
}

function convertMessage(
	message: Message,
	addCacheControl: boolean,
): OpenAIMessage[] {
	const { role, content } = message;

	// Simple string content
	if (typeof content === "string") {
		if (role !== "user" || !addCacheControl) {
			return [{ role, content } as OpenAIMessage];
		}

		return [
			{
				role,
				content: [
					{
						type: "text",
						text: content,
						cache_control: { type: "ephemeral" },
					},
				],
			} as unknown as OpenAIMessage,
		];
	}

	// Array content - need to process blocks
	if (role === "assistant") {
		return [convertAssistantMessage(content)];
	} else {
		return convertUserMessage(content, addCacheControl);
	}
}

function convertAssistantMessage(content: ContentBlock[]): OpenAIMessage {
	const textParts: string[] = [];
	const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
	const reasoningParts: string[] = [];
	const reasoningDetails: unknown[] = [];

	for (const block of content) {
		switch (block.type) {
			case "text":
				textParts.push((block as TextContent).text);
				break;
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
			case "thinking": {
				const thinkingBlock = block as ThinkingContent;
				if (thinkingBlock.thinking) {
					reasoningParts.push(thinkingBlock.thinking);
				}
				const details = Array.isArray(thinkingBlock.details)
					? thinkingBlock.details
					: Array.isArray(thinkingBlock.summary)
						? thinkingBlock.summary
						: [];
				if (details.length > 0) {
					reasoningDetails.push(...details);
				}
				break;
			}
		}
	}

	const message: OpenAI.Chat.ChatCompletionAssistantMessageParam & {
		reasoning?: string;
		reasoning_content?: string;
		reasoning_details?: unknown[];
	} = {
		role: "assistant",
		content: textParts.length > 0 ? textParts.join("\n") : null,
	};

	if (toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	if (reasoningParts.length > 0) {
		const reasoningText = reasoningParts.join("\n");
		message.reasoning = reasoningText;
		message.reasoning_content = reasoningText;
	}

	if (reasoningDetails.length > 0) {
		message.reasoning_details = reasoningDetails;
	}

	return message;
}

function convertUserMessage(
	content: ContentBlock[],
	addCacheControl: boolean,
): OpenAIMessage[] {
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

	// Preserve any non-tool user content as a regular user message
	const userContent = content.filter((b) => b.type !== "tool_result");
	if (userContent.length === 0) {
		return messages;
	}

	const parts: OpenAIContentPart[] = [];

	for (const block of userContent) {
		switch (block.type) {
			case "text":
				parts.push({ type: "text", text: (block as TextContent).text });
				break;
			case "file": {
				const fileBlock = block as FileContent;
				parts.push({
					type: "text",
					text: formatFileContentBlock(fileBlock.path, fileBlock.content),
				});
				break;
			}
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
		}
	}
	if (parts.length === 0) {
		return messages;
	}

	if (addCacheControl) {
		for (let i = parts.length - 1; i >= 0; i--) {
			if (parts[i].type === "text") {
				parts[i] = {
					...(parts[i] as OpenAI.Chat.ChatCompletionContentPartText),
					cache_control: { type: "ephemeral" },
				} as unknown as OpenAIContentPart;
				break;
			}
		}
	}

	messages.push({
		role: "user",
		content:
			parts.length === 1 && parts[0].type === "text" && !addCacheControl
				? parts[0].text
				: (parts as unknown as OpenAI.Chat.ChatCompletionUserMessageParam["content"]),
	});

	return messages;
}

/**
 * Convert tool definitions to OpenAI format
 */
export function convertToolsToOpenAI(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
	options?: { normalizeInputSchemas?: boolean; strict?: boolean },
): OpenAI.Chat.ChatCompletionTool[] {
	const strict = options?.strict ?? true;
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: (options?.normalizeInputSchemas
				? normalizeToolInputSchema(tool.inputSchema)
				: tool.inputSchema) as OpenAI.FunctionParameters,
			strict,
		},
	}));
}

/**
 * Build tool params for OpenAI request
 */
export function getOpenAIToolParams(
	tools?: Array<{ name: string; description: string; inputSchema: unknown }>,
	options?: { normalizeInputSchemas?: boolean; strict?: boolean },
): {
	tools?: OpenAI.Chat.ChatCompletionTool[];
	tool_choice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
} {
	if (!tools || tools.length === 0) {
		return {};
	}

	return {
		tools: convertToolsToOpenAI(tools, options),
		tool_choice: "auto",
	};
}
