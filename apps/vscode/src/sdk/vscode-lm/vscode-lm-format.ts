// Converts Cline SDK messages (@cline/llms `Message`) into VS Code Language
// Model API messages (`vscode.LanguageModelChatMessage`).
//
// SDK content blocks (text / image / tool_use / tool_result) map onto VS Code LM
// parts. VS Code LM does not accept images, so image inputs become a text
// placeholder. Tool calls and tool results round-trip as
// `LanguageModelToolCallPart` / `LanguageModelToolResultPart`.

import type { ContentBlock, Message } from "@cline/llms";
import * as vscode from "vscode";
import { Logger } from "@/shared/services/Logger";
import { extractToolOutputText } from "../message-translator";

/**
 * Safely coerce a tool-call input value into a plain object for
 * `LanguageModelToolCallPart`, which requires an object input.
 */
export function asObjectSafe(value: unknown): object {
	if (!value) {
		return {};
	}

	try {
		if (typeof value === "string") {
			return JSON.parse(value);
		}
		if (typeof value === "object") {
			return Object.assign({}, value);
		}
		return {};
	} catch (error) {
		Logger.warn("Cline <Language Model API>: Failed to parse object:", error);
		return {};
	}
}

function imagePlaceholder(mediaType?: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(
		`[Image (${mediaType || "unknown media-type"}) not supported by VSCode LM API]`,
	);
}

/**
 * Render the content of a tool_result block into VS Code LM text parts.
 */
function toolResultTextParts(
	content: ContentBlock & { type: "tool_result" },
): vscode.LanguageModelTextPart[] {
	if (typeof content.content === "string") {
		return [new vscode.LanguageModelTextPart(content.content)];
	}

	// SDK tool executors (run_commands, search_codebase, read_files, MCP, ...)
	// put rich, untyped result objects in `content` — e.g. an array of
	// ToolOperationResult `{ query, result, success, error? }` — rather than typed
	// text/image/file content blocks. Such items have no `.type`/`.text`, so they
	// can only be read via extractToolOutputText (which pulls `.result`/`.error`
	// out of ToolOperationResult[], else falls back to JSON.stringify). When no
	// item looks like a typed content block, treat the whole array as untyped
	// output and extract its text in one pass.
	const isTypedBlock = (
		part: unknown,
	): part is { type: "text" | "image" | "file" } =>
		typeof part === "object" &&
		part !== null &&
		typeof (part as { type?: unknown }).type === "string";

	if (!content.content.some(isTypedBlock)) {
		const text = extractToolOutputText(content.content);
		return [new vscode.LanguageModelTextPart(text)];
	}

	const parts = content.content.map((part) => {
		switch (part.type) {
			case "text":
				return new vscode.LanguageModelTextPart(part.text ?? "");
			case "image":
				return imagePlaceholder(part.mediaType);
			case "file":
				return new vscode.LanguageModelTextPart(part.content ?? "");
			default:
				// Untyped item interleaved with typed blocks — serialize just this item.
				return new vscode.LanguageModelTextPart(extractToolOutputText(part));
		}
	});

	return parts.length > 0 ? parts : [new vscode.LanguageModelTextPart("")];
}

export function convertToVsCodeLmMessages(
	messages: Message[],
): vscode.LanguageModelChatMessage[] {
	const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [];

	for (const message of messages) {
		// Simple string content.
		if (typeof message.content === "string") {
			vsCodeLmMessages.push(
				message.role === "assistant"
					? vscode.LanguageModelChatMessage.Assistant(message.content)
					: vscode.LanguageModelChatMessage.User(message.content),
			);
			continue;
		}

		if (message.role === "user") {
			const toolResults = message.content.filter(
				(part): part is ContentBlock & { type: "tool_result" } =>
					part.type === "tool_result",
			);
			const nonTool = message.content.filter(
				(part) => part.type === "text" || part.type === "image",
			);

			const contentParts = [
				// Tool results first, as VS Code LM tool result parts.
				...toolResults.map(
					(toolResult) =>
						new vscode.LanguageModelToolResultPart(
							toolResult.tool_use_id,
							toolResultTextParts(toolResult),
						),
				),
				// Then text / image-placeholder parts.
				...nonTool.map((part) =>
					part.type === "image"
						? imagePlaceholder(part.mediaType)
						: new vscode.LanguageModelTextPart(
								part.type === "text" ? part.text : "",
							),
				),
			];

			vsCodeLmMessages.push(vscode.LanguageModelChatMessage.User(contentParts));
			continue;
		}

		if (message.role === "assistant") {
			const toolUses = message.content.filter(
				(part): part is ContentBlock & { type: "tool_use" } =>
					part.type === "tool_use",
			);
			const nonTool = message.content.filter(
				(part) => part.type === "text" || part.type === "image",
			);

			const contentParts = [
				// Tool calls first.
				...toolUses.map(
					(toolUse) =>
						new vscode.LanguageModelToolCallPart(
							toolUse.id,
							toolUse.name,
							asObjectSafe(toolUse.input),
						),
				),
				// Then text (images are not generated/produced for assistant turns).
				...nonTool.map((part) =>
					part.type === "image"
						? new vscode.LanguageModelTextPart(
								"[Image generation not supported by VSCode LM API]",
							)
						: new vscode.LanguageModelTextPart(
								part.type === "text" ? part.text : "",
							),
				),
			];

			vsCodeLmMessages.push(
				vscode.LanguageModelChatMessage.Assistant(contentParts),
			);
		}
	}

	// Copilot (and other VS Code LM) models require that the prompt does NOT end
	// on a tool-result message — the final message must be a non-tool-result
	// UserMessage. If we end on tool results, the model can't "see" the output and
	// tends to re-run tools or call random ones. Mirror the official VS Code chat
	// sample (chat-sample/src/toolsPrompt.tsx), which appends a trailing user
	// nudge after tool results.
	if (endsWithToolResult(vsCodeLmMessages)) {
		vsCodeLmMessages.push(
			vscode.LanguageModelChatMessage.User(
				"Above is the result of calling one or more tools. The user cannot see the results, so you should explain them to the user if referencing them in your answer.",
			),
		);
	}

	return vsCodeLmMessages;
}

/**
 * True when the last message is a user message whose content consists of (only)
 * tool result parts.
 */
function endsWithToolResult(
	messages: vscode.LanguageModelChatMessage[],
): boolean {
	const last = messages[messages.length - 1];
	if (!last || !Array.isArray(last.content) || last.content.length === 0) {
		return false;
	}
	return last.content.some(
		(part) => part instanceof vscode.LanguageModelToolResultPart,
	);
}
