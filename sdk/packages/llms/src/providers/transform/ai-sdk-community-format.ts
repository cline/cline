import {
	type AiSdkFormatterMessage,
	type AiSdkFormatterPart,
	type AiSdkMessage,
	type AiSdkMessagePart,
	formatFileContentBlock,
	formatMessagesForAiSdk,
} from "@clinebot/shared";
import type { Message } from "../types/messages";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";

export type { AiSdkMessage, AiSdkMessagePart } from "@clinebot/shared";

export function toAiSdkMessages(
	systemContent: string | AiSdkMessagePart[],
	messages: Message[],
	options?: { assistantToolCallArgKey?: "args" | "input" },
): AiSdkMessage[] {
	const normalizedOptions = options ?? { assistantToolCallArgKey: "input" };
	const toolNamesById = new Map<string, string>();
	const normalizedMessages: AiSdkFormatterMessage[] = [];

	for (const message of messages) {
		if (typeof message.content === "string") {
			normalizedMessages.push({ role: message.role, content: message.content });
			continue;
		}

		if (message.role === "assistant") {
			const parts: AiSdkFormatterPart[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
					continue;
				}

				if (block.type === "file") {
					parts.push({
						type: "text",
						text: formatFileContentBlock(block.path, block.content),
					});
					continue;
				}

				if (block.type === "tool_use") {
					toolNamesById.set(block.id, block.name);
					parts.push({
						type: "tool-call",
						toolCallId: block.id,
						toolName: block.name,
						input: normalizeToolUseInput(block.input),
					});
				}
			}

			if (parts.length > 0) {
				normalizedMessages.push({ role: "assistant", content: parts });
			}
			continue;
		}

		const userParts: AiSdkFormatterPart[] = [];
		for (const block of message.content) {
			if (block.type === "text") {
				userParts.push({ type: "text", text: block.text });
				continue;
			}

			if (block.type === "file") {
				userParts.push({
					type: "text",
					text: formatFileContentBlock(block.path, block.content),
				});
				continue;
			}

			if (block.type === "image") {
				userParts.push({
					type: "image",
					image: block.data,
					mediaType: block.mediaType,
				});
				continue;
			}

			if (block.type === "tool_result") {
				if (userParts.length > 0) {
					normalizedMessages.push({
						role: "user",
						content: userParts.splice(0, userParts.length),
					});
				}

				normalizedMessages.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: block.tool_use_id,
							toolName: toolNamesById.get(block.tool_use_id) ?? "tool",
							output: serializeToolResultContent(block.content),
							isError: block.is_error ?? false,
						},
					],
				});
			}
		}

		if (userParts.length > 0) {
			normalizedMessages.push({ role: "user", content: userParts });
		}
	}

	return formatMessagesForAiSdk(
		systemContent,
		normalizedMessages,
		normalizedOptions,
	);
}
