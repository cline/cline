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
	ToolResultContent,
	ToolUseContent,
} from "../types/messages";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";

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
		convertMessage(
			message,
			enableCaching && index === lastUserIndex,
			enableCaching,
		),
	);
}

function convertMessage(
	message: Message,
	addCacheControl: boolean,
	preserveStructuredUserContent: boolean,
): OpenAIMessage[] {
	const { role, content } = message;

	// Simple string content
	if (typeof content === "string") {
		if (
			role !== "user" ||
			(!addCacheControl && !preserveStructuredUserContent)
		) {
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
		return convertUserMessage(
			content,
			addCacheControl,
			preserveStructuredUserContent,
		);
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
				// OpenAI doesn't have native thinking blocks, skip
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

function convertUserMessage(
	content: ContentBlock[],
	addCacheControl: boolean,
	preserveStructuredUserContent: boolean,
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
			parts.length === 1 &&
			parts[0].type === "text" &&
			!addCacheControl &&
			!preserveStructuredUserContent
				? parts[0].text
				: (parts as unknown as OpenAI.Chat.ChatCompletionUserMessageParam["content"]),
	});

	return messages;
}

/**
 * Normalize a JSON Schema for OpenAI strict mode.
 *
 * Strict mode requires:
 * - `additionalProperties: false` on every object
 * - All properties listed in `required` (optional ones become nullable)
 */
function normalizeForStrictMode(schema: unknown): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return schema;
	}

	const s = { ...(schema as Record<string, unknown>) };

	// Remove $schema – OpenAI rejects it
	delete s.$schema;

	if (s.type === "object") {
		s.additionalProperties = false;

		const properties = s.properties as Record<string, unknown> | undefined;
		const required = (s.required as string[] | undefined) ?? [];

		if (properties) {
			const allKeys = Object.keys(properties);
			const requiredSet = new Set(required);

			// Make every property required; wrap non-required ones as nullable
			const normalized: Record<string, unknown> = {};
			for (const key of allKeys) {
				let prop = normalizeForStrictMode(properties[key]);
				if (!requiredSet.has(key)) {
					// Wrap as nullable via anyOf
					prop = { anyOf: [prop, { type: "null" }] };
				}
				normalized[key] = prop;
			}
			s.properties = normalized;
			s.required = allKeys;
		}
	}

	// Recurse into nested schemas
	if (s.items) {
		s.items = Array.isArray(s.items)
			? s.items.map((i) => normalizeForStrictMode(i))
			: normalizeForStrictMode(s.items);
	}
	for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
		if (Array.isArray(s[keyword])) {
			s[keyword] = (s[keyword] as unknown[]).map((i) =>
				normalizeForStrictMode(i),
			);
		}
	}

	return s;
}

/**
 * Convert tool definitions to OpenAI format
 */
export function convertToolsToOpenAI(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
	options?: { strict?: boolean },
): OpenAI.Chat.ChatCompletionTool[] {
	const strict = options?.strict ?? true;
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: normalizeForStrictMode(
				tool.inputSchema,
			) as OpenAI.FunctionParameters,
			strict,
		},
	}));
}

/**
 * Build tool params for OpenAI request
 */
export function getOpenAIToolParams(
	tools?: Array<{ name: string; description: string; inputSchema: unknown }>,
	options?: { strict?: boolean },
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
