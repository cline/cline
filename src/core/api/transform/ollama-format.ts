import { Anthropic } from "@anthropic-ai/sdk"
import { Message } from "ollama"

export function convertToOllamaMessages(anthropicMessages: Anthropic.Messages.MessageParam[]): Message[] {
	const ollamaMessages: Message[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			ollamaMessages.push({
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			})
		} else {
			if (anthropicMessage.role === "user") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool result messages FIRST since they must follow the tool use messages
				const toolResultImages: string[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the Ollama SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										toolResultImages.push(`data:${part.source.media_type};base64,${part.source.data}`)
										return "(see following user message for image)"
									}
									return part.text
								})
								.join("\n") ?? ""
					}
					ollamaMessages.push({
						role: "user",
						images: toolResultImages.length > 0 ? toolResultImages : undefined,
						content: content,
					})
				})

				// Process non-tool messages
				if (nonToolMessages.length > 0) {
					ollamaMessages.push({
						role: "user",
						content: nonToolMessages
							.map((part) => {
								if (part.type === "image") {
									return `data:${part.source.media_type};base64,${part.source.data}`
								}
								return part.text
							})
							.join("\n"),
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						} // assistant cannot send tool_result messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages
				let content: string = ""
				if (nonToolMessages.length > 0) {
					content = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								return "" // impossible as the assistant cannot send images
							}
							return part.text
						})
						.join("\n")
				}

				ollamaMessages.push({
					role: "assistant",
					content,
				})
			}
		}
	}

	return ollamaMessages
}
