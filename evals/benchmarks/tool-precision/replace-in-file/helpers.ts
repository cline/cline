import { Anthropic } from "@anthropic-ai/sdk"

const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) {
					return {
						type: "image",
						source: { type: "base64", media_type: "image/webp", data: dataUrl },
					} as Anthropic.ImageBlockParam
				}
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: { type: "base64", media_type: mimeType, data: base64 },
				} as Anthropic.ImageBlockParam
			})
		: []
}

export const formatResponse = {
	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},
}

export function log(isVerbose: boolean, message: string) {
	if (isVerbose) {
		console.log(message)
	}
}
