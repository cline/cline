import Anthropic from "@anthropic-ai/sdk"
import { ClineStorageMessage } from "@/shared/messages/content"

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
		content: Array.isArray(param.content)
			? param.content.map((item) => {
					return {
						...item,
						// Ensure reasoning_details is removed
						reasoning_details: undefined,
					}
				})
			: param.content, // String content remains unchanged
	}
}
