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
