import { Anthropic } from "@anthropic-ai/sdk"
import { Content, FunctionCallPart, FunctionResponsePart, InlineDataPart, Part, TextPart } from "@google-cloud/vertexai"

function convertAnthropicContentToVertexGemini(content: Anthropic.Messages.MessageParam["content"]): Part[] {
	if (typeof content === "string") {
		return [{ text: content } as TextPart]
	}

	return content.flatMap((block) => {
		switch (block.type) {
			case "text":
				return { text: block.text } as TextPart
			case "image":
				if (block.source.type !== "base64") {
					throw new Error("Unsupported image source type")
				}
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				} as InlineDataPart
			case "tool_use":
				return {
					functionCall: {
						name: block.name,
						args: block.input,
					},
				} as FunctionCallPart
			case "tool_result":
				const name = block.tool_use_id.split("-")[0]
				if (!block.content) {
					return []
				}
				if (typeof block.content === "string") {
					return {
						functionResponse: {
							name,
							response: {
								name,
								content: block.content,
							},
						},
					} as FunctionResponsePart
				} else {
					// The only case when tool_result could be array is when the tool failed and we're providing ie user feedback potentially with images
					const textParts = block.content.filter((part) => part.type === "text")
					const imageParts = block.content.filter((part) => part.type === "image")
					const text = textParts.length > 0 ? textParts.map((part) => part.text).join("\n\n") : ""
					const imageText = imageParts.length > 0 ? "\n\n(See next part for image)" : ""
					return [
						{
							functionResponse: {
								name,
								response: {
									name,
									content: text + imageText,
								},
							},
						} as FunctionResponsePart,
						...imageParts.map(
							(part) =>
								({
									inlineData: {
										data: part.source.data,
										mimeType: part.source.media_type,
									},
								}) as InlineDataPart,
						),
					]
				}
			default:
				throw new Error(`Unsupported content block type: ${(block as any).type}`)
		}
	})
}

export function convertAnthropicMessageToVertexGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToVertexGemini(message.content),
	}
}
