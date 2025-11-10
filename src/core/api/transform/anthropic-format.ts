import { MessageParam } from "@anthropic-ai/sdk/resources/index"

/**
 * Sanitize Anthropic messages by removing reasoning details and adding ephemeral cache control
 * to the last two user messages to prevent them from being stored in Anthropic's cache.
 */
export function sanitizeAnthropicMessages(
	messages: Array<MessageParam>,
	lastUserMsgIndex?: number,
	secondLastMsgUserIndex?: number,
): Array<MessageParam> {
	return messages.map((_message, index) => {
		const message = removeReasoningDetails(_message)
		const addCacheControl = lastUserMsgIndex !== undefined && secondLastMsgUserIndex !== undefined

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
 * Remove reasoning details from a single Anthropic message parameter
 */
function removeReasoningDetails(param: MessageParam): MessageParam {
	if (Array.isArray(param.content)) {
		return {
			...param,
			content: param.content.map((item) => {
				if (item.type === "text") {
					return {
						...item,
						reasoning_details: undefined,
					}
				}
				return item
			}),
		}
	}
	return param
}
