import { Message } from "ollama"
import {
	ClineAssistantToolUseBlock,
	ClineImageContentBlock,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content"

export function convertToOllamaMessages(anthropicMessages: Omit<ClineStorageMessage, "modelInfo">[]): Message[] {
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
					nonToolMessages: (ClineTextContentBlock | ClineImageContentBlock)[]
					toolMessages: ClineUserToolResultContentBlock[]
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
					// Note: Ollama SDK expects raw base64 data without data URI prefix for the `images` field
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										// Strip data URI prefix if present (e.g., "data:image/png;base64,")
										const base64Data = part.source.data.replace(/^data:[^;]+;base64,/, "")
										toolResultImages.push(base64Data)
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
				const nonToolImages: string[] = []
				if (nonToolMessages.length > 0) {
					const nonToolContent: string = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								// Strip data URI prefix if present (e.g., "data:image/png;base64,")
								const base64Data = part.source.data.replace(/^data:[^;]+;base64,/, "")
								nonToolImages.push(base64Data)
								return "(see following user message for image)"
							}
							return part.text
						})
						.join("\n")

					ollamaMessages.push({
						role: "user",
						content: nonToolContent,
						images: nonToolImages.length > 0 ? nonToolImages : undefined,
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (ClineTextContentBlock | ClineImageContentBlock)[]
					toolMessages: ClineAssistantToolUseBlock[]
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
				let content = ""
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
