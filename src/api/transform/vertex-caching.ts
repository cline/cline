import { Anthropic } from "@anthropic-ai/sdk"

interface VertexTextBlock {
	type: "text"
	text: string
	cache_control?: { type: "ephemeral" }
}

interface VertexImageBlock {
	type: "image"
	source: {
		type: "base64"
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
		data: string
	}
}

type VertexContentBlock = VertexTextBlock | VertexImageBlock

interface VertexMessage extends Omit<Anthropic.Messages.MessageParam, "content"> {
	content: string | VertexContentBlock[]
}

export function formatMessageForCache(message: Anthropic.Messages.MessageParam, shouldCache: boolean): VertexMessage {
	// Assistant messages are kept as-is since they can't be cached
	if (message.role === "assistant") {
		return message as VertexMessage
	}

	// For string content, we convert to array format with optional cache control
	if (typeof message.content === "string") {
		return {
			...message,
			content: [
				{
					type: "text" as const,
					text: message.content,
					// For string content, we only have one block so it's always the last
					...(shouldCache && { cache_control: { type: "ephemeral" } }),
				},
			],
		}
	}

	// For array content, find the last text block index once before mapping
	const lastTextBlockIndex = message.content.reduce(
		(lastIndex, content, index) => (content.type === "text" ? index : lastIndex),
		-1,
	)

	// Then use this pre-calculated index in the map function.
	return {
		...message,
		content: message.content.map((content, contentIndex) => {
			// Images and other non-text content are passed through unchanged.
			if (content.type === "image") {
				return content as VertexImageBlock
			}

			// Check if this is the last text block using our pre-calculated index.
			const isLastTextBlock = contentIndex === lastTextBlockIndex

			return {
				type: "text" as const,
				text: (content as { text: string }).text,
				...(shouldCache && isLastTextBlock && { cache_control: { type: "ephemeral" } }),
			}
		}),
	}
}
