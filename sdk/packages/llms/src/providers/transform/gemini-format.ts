/**
 * Gemini Message Format Converter
 *
 * Converts our unified Message format to Google Gemini's Content format.
 */

import { formatFileContentBlock, parseJsonStream } from "@clinebot/shared";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
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

/**
 * Convert messages to Gemini format
 */
export function convertToGeminiMessages(messages: Message[]): Content[] {
	const toolNameByCallId = new Map<string, string>();
	return messages
		.map((message) => convertMessage(message, toolNameByCallId))
		.filter((m): m is Content => m !== null);
}

function convertMessage(
	message: Message,
	toolNameByCallId: Map<string, string>,
): Content | null {
	const { role, content } = message;

	// Map roles: Gemini uses "user" and "model"
	const geminiRole = role === "assistant" ? "model" : "user";

	// Simple string content
	if (typeof content === "string") {
		return {
			role: geminiRole,
			parts: [{ text: content }],
		};
	}

	// Array content
	const parts = convertContentBlocks(content, toolNameByCallId);
	if (parts.length === 0) {
		return null;
	}

	return {
		role: geminiRole,
		parts,
	};
}

function convertContentBlocks(
	content: ContentBlock[],
	toolNameByCallId: Map<string, string>,
): Part[] {
	const parts: Part[] = [];

	for (const block of content) {
		if (block.type === "tool_use") {
			toolNameByCallId.set(block.id, block.name);
		}
		const converted = convertContentBlock(block, toolNameByCallId);
		if (converted) {
			parts.push(converted);
		}
	}

	return parts;
}

function convertContentBlock(
	block: ContentBlock,
	toolNameByCallId: Map<string, string>,
): Part | null {
	switch (block.type) {
		case "text": {
			const textBlock = block as TextContent;
			const part: Part = { text: textBlock.text };
			if (textBlock.signature) {
				(part as any).thoughtSignature = textBlock.signature;
			}
			return part;
		}

		case "file": {
			const fileBlock = block as FileContent;
			const part: Part = {
				text: formatFileContentBlock(fileBlock.path, fileBlock.content),
			};

			return part;
		}

		case "image": {
			const imageBlock = block as ImageContent;
			return {
				inlineData: {
					mimeType: imageBlock.mediaType,
					data: imageBlock.data,
				},
			};
		}

		case "tool_use": {
			const toolBlock = block as ToolUseContent;
			const part: Part = {
				functionCall: {
					id: toolBlock.id,
					name: toolBlock.name,
					args: normalizeToolUseInput(toolBlock.input),
				},
			};
			if (toolBlock.signature) {
				(part as any).thoughtSignature = toolBlock.signature;
			}
			return part;
		}

		case "tool_result": {
			const resultBlock = block as ToolResultContent;
			let responseContent: Record<string, unknown>;

			if (typeof resultBlock.content === "string") {
				responseContent = { result: parseJsonStream(resultBlock.content) };
			} else {
				responseContent = {
					result: serializeToolResultContent(resultBlock.content),
				};
			}

			if (resultBlock.is_error) {
				responseContent.error = true;
			}

			return {
				functionResponse: {
					id: resultBlock.tool_use_id,
					name:
						toolNameByCallId.get(resultBlock.tool_use_id) ??
						resultBlock.tool_use_id,
					response: responseContent,
				},
			};
		}

		case "thinking": {
			const thinkingBlock = block as ThinkingContent;
			// Gemini uses thought: true to mark thinking blocks
			const part = {
				text: thinkingBlock.thinking,
				thought: true,
			} as Part;
			if (thinkingBlock.signature) {
				(part as any).thoughtSignature = thinkingBlock.signature;
			}
			return part;
		}

		default:
			return null;
	}
}

/**
 * Allowed JSON Schema properties per Gemini's supported subset.
 * See: https://ai.google.dev/gemini-api/docs/structured-output
 */
const GEMINI_ALLOWED_PROPERTIES = new Set([
	// Common
	"type",
	"title",
	"description",
	"enum",
	// Object
	"properties",
	"required",
	"additionalProperties",
	// String
	"format",
	// Number / Integer
	"minimum",
	"maximum",
	// Array
	"items",
	"prefixItems",
	"minItems",
	"maxItems",
]);

/**
 * Recursively sanitize a JSON Schema to only include properties supported by Gemini.
 * Converts exclusiveMinimum/exclusiveMaximum to minimum/maximum as a best-effort fallback.
 */
function sanitizeSchemaForGemini(schema: unknown): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return schema;
	}

	const input = schema as Record<string, unknown>;
	const output: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(input)) {
		if (!GEMINI_ALLOWED_PROPERTIES.has(key)) {
			continue;
		}

		if (key === "properties" && value && typeof value === "object") {
			const sanitized: Record<string, unknown> = {};
			for (const [propName, propSchema] of Object.entries(
				value as Record<string, unknown>,
			)) {
				sanitized[propName] = sanitizeSchemaForGemini(propSchema);
			}
			output[key] = sanitized;
		} else if (key === "items" || key === "additionalProperties") {
			output[key] =
				typeof value === "object" && value !== null
					? sanitizeSchemaForGemini(value)
					: value;
		} else if (key === "prefixItems" && Array.isArray(value)) {
			output[key] = value.map((item) => sanitizeSchemaForGemini(item));
		} else {
			output[key] = value;
		}
	}

	// Convert exclusiveMinimum/exclusiveMaximum to minimum/maximum
	if (input.exclusiveMinimum !== undefined && output.minimum === undefined) {
		output.minimum = input.exclusiveMinimum;
	}
	if (input.exclusiveMaximum !== undefined && output.maximum === undefined) {
		output.maximum = input.exclusiveMaximum;
	}

	return output;
}

/**
 * Convert tool definitions to Gemini format
 */
export function convertToolsToGemini(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
): FunctionDeclaration[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: sanitizeSchemaForGemini(
			tool.inputSchema,
		) as FunctionDeclaration["parameters"],
	}));
}
