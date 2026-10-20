import {
	DEFAULT_MAX_IMAGE_BASE64_BYTES,
	DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	SUPPORTED_IMAGE_MEDIA_TYPES,
} from "@cline/shared/browser";

export function cloudImageAttachmentError(
	files: Pick<File, "size">[],
): string | undefined {
	if (files.length > 5) return "Attach up to 5 images.";
	const encodedSizes = files.map((file) => 4 * Math.ceil(file.size / 3));
	if (encodedSizes.some((size) => size > DEFAULT_MAX_IMAGE_BASE64_BYTES)) {
		return "Each image must be 3.75 MB or smaller.";
	}
	if (
		encodedSizes.reduce((total, size) => total + size, 0) >
		DEFAULT_MAX_TOTAL_MEDIA_BYTES
	) {
		return "Attachments must be 6 MB or smaller in total.";
	}
	return undefined;
}

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

export function isSupportedImageAttachment(
	file: Pick<File, "name" | "type">,
): boolean {
	return (
		imageAttachmentMediaType(file) !== undefined &&
		!isUnsupportedImageAttachment(file)
	);
}
