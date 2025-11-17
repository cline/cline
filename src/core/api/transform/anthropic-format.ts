import Anthropic from "@anthropic-ai/sdk"
import { ClineContent, ClineStorageMessage } from "@/shared/messages/content"

/**
 * Sanitize Anthropic messages by removing reasoning details and adding ephemeral cache control
 * to the last two user messages to prevent them from being stored in Anthropic's cache.
 */
export function sanitizeAnthropicMessages(
	messages: Array<ClineStorageMessage>,
	lastUserMsgIndex?: number,
	secondLastMsgUserIndex?: number,
): Array<Anthropic.Messages.MessageParam> {
	return messages.map((_message, index) => {
		const message = removeUnknownParams(_message)
		const addCacheControl = lastUserMsgIndex !== undefined && secondLastMsgUserIndex !== undefined
		// Construct message
		if (addCacheControl && (index === lastUserMsgIndex || index === secondLastMsgUserIndex)) {
			return {
				...message,
				content:
					typeof message.content === "string"
						? [
								{
									type: "text",
									text: message.content,
									cache_control: {
										type: "ephemeral",
									},
								},
							]
						: message.content.map((content, contentIndex) =>
								contentIndex === message.content.length - 1
									? {
											...content,
											cache_control: {
												type: "ephemeral",
											},
										}
									: content,
							),
			}
		}

		return {
			...message,
			content:
				typeof message.content === "string"
					? [
							{
								type: "text",
								text: message.content,
							},
						]
					: message.content,
		}
	})
}

/**
 * Remove reasoning details and other known params that are not Anthropic specific.
 */
function removeUnknownParams(param: ClineStorageMessage): Anthropic.Messages.MessageParam {
	// Construct new content array with known Anthropic content blocks only.
	return {
		role: param.role === "user" ? "user" : "assistant",
		content: Array.isArray(param.content) ? param.content.map(sanitizeAnthropicContentBlock) : param.content, // String content remains unchanged
	}
}

/**
 * Clean a content block by removing Cline-specific fields and returning only provider-compatible fields
 */
function sanitizeAnthropicContentBlock(block: ClineContent): Anthropic.ContentBlock {
	// Fast path: if no reasoning_details property exists, return as-is
	// Including reasoning_details in non-openrouter/cline providers may cause API errors
	if (!("reasoning_details" in block)) {
		return block as Anthropic.ContentBlock
	}

	// Remove reasoning_details from text blocks
	// biome-ignore lint/correctness/noUnusedVariables: intentional destructuring to remove property
	const { reasoning_details, ...cleanBlock } = block
	return cleanBlock as Anthropic.ContentBlock
}
