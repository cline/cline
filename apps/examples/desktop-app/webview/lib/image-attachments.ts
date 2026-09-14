import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	jpe: "image/jpeg",
	jfif: "image/jpeg",
	pjpeg: "image/jpeg",
	pjp: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	heic: "image/heic",
	heif: "image/heif",
	avif: "image/avif",
	tif: "image/tiff",
	tiff: "image/tiff",
	ico: "image/x-icon",
};

/** Keep validation, draft previews, and serialization consistent when MIME is absent. */
export function imageAttachmentMediaType(
	file: Pick<File, "name" | "type">,
): string | undefined {
	if (file.type.toLowerCase().startsWith("image/"))
		return file.type.toLowerCase();
	const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
	return Object.hasOwn(IMAGE_MEDIA_TYPES, extension)
		? IMAGE_MEDIA_TYPES[extension]
		: undefined;
}

/** Recognize all images, but only accept formats supported by the image pipeline. */
export function isUnsupportedImageAttachment(
	file: Pick<File, "name" | "type">,
): boolean {
	const mediaType = imageAttachmentMediaType(file);
	return (
		mediaType !== undefined &&
		!(SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)
	);
}
