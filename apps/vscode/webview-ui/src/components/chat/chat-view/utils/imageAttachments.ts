export interface ImageAttachmentGateArgs {
	supportsImages: boolean
	shouldDisableFilesAndImages: boolean
	imageCount: number
}

export const shouldProcessImageAttachments = ({
	supportsImages,
	shouldDisableFilesAndImages,
	imageCount,
}: ImageAttachmentGateArgs) => {
	return supportsImages && !shouldDisableFilesAndImages && imageCount > 0
}

const ACCEPTED_IMAGE_SUBTYPES = new Set(["png", "jpeg", "webp"])

export const isAcceptedImageType = (mimeType: string) => {
	const [type, subtype] = mimeType.split("/")
	return type === "image" && ACCEPTED_IMAGE_SUBTYPES.has(subtype)
}
