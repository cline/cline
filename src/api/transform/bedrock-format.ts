import { Anthropic } from "@anthropic-ai/sdk"
import { ContentBlock, ImageBlock, ImageFormat, ImageSource, Message } from "@aws-sdk/client-bedrock-runtime"

// Override ImageSource.bytes to allow a base64 string
// Bytes only work when using the SDK directly, not when using the API
type ImageSourceWithBase64 = Omit<ImageSource, "bytes"> & {
	bytes: string
}

// Custom ImageBlock using the new image source type
type ImageBlockWithBase64 = Omit<ImageBlock, "source"> & {
	source: ImageSourceWithBase64
}

// Custom ContentBlock using the new image block type
type ImageMemberWithBase64 = Omit<ContentBlock.ImageMember, "image"> & {
	image: ImageBlockWithBase64
}

// Rebuild the union type, replacing the ImageMember only
type ContentBlockWithBase64Image = Exclude<ContentBlock, ContentBlock.ImageMember> | ImageMemberWithBase64

// Custom Message using the new content block type
type MessageWithBase64Image = Omit<Message, "content"> & {
	content: ContentBlockWithBase64Image[] | undefined
}

function getValidImageFormat(mediaType: string): ImageFormat {
	const format = mediaType.split("/")[1]?.toLowerCase()

	switch (format) {
		case ImageFormat.PNG:
		case ImageFormat.JPEG:
		case ImageFormat.GIF:
		case ImageFormat.WEBP:
			return format as ImageFormat
		default:
			throw new Error(`Unsupported image format: ${format}`)
	}
}

export function convertAnthropicMessagesToBedrock(messages: Anthropic.Messages.MessageParam[]): MessageWithBase64Image[] {
	return messages.map((m) => {
		const contentBlocks: ContentBlockWithBase64Image[] = []

		if (typeof m.content === "string") {
			contentBlocks.push({ text: m.content })
		} else if (Array.isArray(m.content)) {
			for (const block of m.content) {
				if (block.type === "text") {
					if (!block.text) {
						throw new Error('Text block is missing the "text" field.')
					}
					contentBlocks.push({ text: block.text })
				} else if (block.type === "image") {
					if (!block.source) {
						throw new Error('Image block is missing the "source" field.')
					}

					const { type, media_type, data } = block.source

					if (!type || !media_type || !data) {
						throw new Error('Image source must have "type", "media_type", and "data" fields.')
					}

					if (type !== "base64") {
						throw new Error(`Unsupported image source type: ${type}. Only "base64" is supported.`)
					}

					const format = getValidImageFormat(media_type)

					contentBlocks.push({
						image: {
							format,
							source: {
								bytes: data,
							},
						},
					})
				} else {
					throw new Error(`Unsupported content block type: ${block.type}`)
				}
			}
		} else {
			throw new Error("Unsupported content format.")
		}

		return {
			role: m.role,
			content: contentBlocks,
		}
	})
}
