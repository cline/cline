import type { Anthropic } from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import {
	type ClineAssistantThinkingBlock,
	type ClineStorageMessage,
	getImageDataUrl,
} from "@/shared/messages/content";

/**
 * DeepSeek Reasoner message format with reasoning_content support.
 */
export type DeepSeekReasonerMessage = OpenAI.Chat.ChatCompletionMessageParam & {
	reasoning_content?: string;
};

/**
 * Adds reasoning_content to OpenAI-compatible messages.
 * DeepSeek only needs it during tool calling in the current turn. Providers such as Moonshot K3
 * can include previous turns and filter reasoning by its originating message.
 */
export function addReasoningContent(
	openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[],
	originalMessages: ClineStorageMessage[],
	options: {
		includePreviousTurns?: boolean;
		shouldIncludeReasoning?: (message: ClineStorageMessage) => boolean;
	} = {},
): DeepSeekReasonerMessage[] {
	const { includePreviousTurns = false, shouldIncludeReasoning = () => true } = options;

	// Find last user message index (start of current turn)
	// If no user message exists (lastUserIndex = -1), all messages are in the "current turn",
	// so reasoning_content will be added to all assistant messages. This is intentional.
	let lastUserIndex = -1;
	for (let i = openAiMessages.length - 1; i >= 0; i--) {
		if (openAiMessages[i].role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	// Extract thinking content from original messages, keyed by assistant index
	const thinkingByIndex = new Map<number, string>();
	let assistantIdx = 0;
	for (const msg of originalMessages) {
		if (msg.role === "assistant") {
			if (Array.isArray(msg.content) && shouldIncludeReasoning(msg)) {
				const thinking = msg.content
					.filter(
						(p): p is ClineAssistantThinkingBlock => p.type === "thinking",
					)
					.map((p) => p.thinking)
					.join("\n");
				if (thinking) {
					thinkingByIndex.set(assistantIdx, thinking);
				}
			}
			assistantIdx++;
		}
	}

	// Add reasoning_content to assistant messages in the requested scope.
	let aiIdx = 0;
	return openAiMessages.map((msg, i): DeepSeekReasonerMessage => {
		if (msg.role === "assistant") {
			const thinking = thinkingByIndex.get(aiIdx++);
			if (thinking && (includePreviousTurns || i >= lastUserIndex)) {
				return { ...msg, reasoning_content: thinking };
			}
		}
		return msg;
	});
}

/**
 * Converts Anthropic messages to OpenAI format and merges consecutive messages with the same role.
 * This is required for DeepSeek Reasoner which does not support successive messages with the same role.
 * DeepSeek highly recommends using 'user' role instead of 'system' role for optimal performance.
 *
 * @param messages Array of Anthropic messages
 * @returns Array of OpenAI messages where consecutive messages with the same role are merged together
 */
export function convertToR1Format(
	messages: Anthropic.Messages.MessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
	return messages.reduce<OpenAI.Chat.ChatCompletionMessageParam[]>(
		(merged, message) => {
			const lastMessage = merged[merged.length - 1];
			let messageContent:
				| string
				| (
						| OpenAI.Chat.ChatCompletionContentPartText
						| OpenAI.Chat.ChatCompletionContentPartImage
				  )[] = "";
			let hasImages = false;

			if (Array.isArray(message.content)) {
				const textParts: string[] = [];
				const imageParts: OpenAI.Chat.ChatCompletionContentPartImage[] = [];

				message.content.forEach((part) => {
					if (part.type === "text") {
						textParts.push(part.text);
					}
					if (part.type === "image") {
						hasImages = true;
						imageParts.push({
							type: "image_url",
							image_url: { url: getImageDataUrl(part.source) },
						});
					}
				});

				if (hasImages) {
					const parts: (
						| OpenAI.Chat.ChatCompletionContentPartText
						| OpenAI.Chat.ChatCompletionContentPartImage
					)[] = [];
					if (textParts.length > 0) {
						parts.push({ type: "text", text: textParts.join("\n") });
					}
					parts.push(...imageParts);
					messageContent = parts;
				} else {
					messageContent = textParts.join("\n");
				}
			} else {
				messageContent = message.content;
			}

			// If the last message has the same role, merge the content
			if (lastMessage?.role === message.role) {
				if (
					typeof lastMessage.content === "string" &&
					typeof messageContent === "string"
				) {
					lastMessage.content += `\n${messageContent}`;
				} else {
					const lastContent = Array.isArray(lastMessage.content)
						? lastMessage.content
						: [{ type: "text" as const, text: lastMessage.content || "" }];

					const newContent = Array.isArray(messageContent)
						? messageContent
						: [{ type: "text" as const, text: messageContent }];

					if (message.role === "assistant") {
						const mergedContent = [
							...lastContent,
							...newContent,
						] as OpenAI.Chat.ChatCompletionAssistantMessageParam["content"];
						lastMessage.content = mergedContent;
					} else {
						const mergedContent = [
							...lastContent,
							...newContent,
						] as OpenAI.Chat.ChatCompletionUserMessageParam["content"];
						lastMessage.content = mergedContent;
					}
				}
			} else {
				// Adds new message with the correct type based on role
				if (message.role === "assistant") {
					const newMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
						role: "assistant",
						content:
							messageContent as OpenAI.Chat.ChatCompletionAssistantMessageParam["content"],
					};
					merged.push(newMessage);
				} else {
					const newMessage: OpenAI.Chat.ChatCompletionUserMessageParam = {
						role: "user",
						content:
							messageContent as OpenAI.Chat.ChatCompletionUserMessageParam["content"],
					};
					merged.push(newMessage);
				}
			}
			return merged;
		},
		[],
	);
}
