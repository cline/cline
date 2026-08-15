import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";

// Restricted to the media types message serialization accepts
// (SUPPORTED_IMAGE_MEDIA_TYPES); anything else would render an attachment
// chip but be silently dropped from the sent message.
const EXTENSION_BY_MEDIA_TYPE: Record<
	(typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number],
	string
> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function isSupportedImageMediaType(
	mediaType: string,
): mediaType is (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number] {
	return (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

function pastedImageName(
	mediaType: (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number],
	index: number,
): string {
	const extension = EXTENSION_BY_MEDIA_TYPE[mediaType];
	const stamp = new Date()
		.toISOString()
		.replaceAll(":", "-")
		.replace(/\.\d+Z$/, "");
	const suffix = index > 0 ? `-${index + 1}` : "";
	return `pasted-image-${stamp}${suffix}.${extension}`;
}

/**
 * Extracts image files from a clipboard paste. Clipboard images arrive with
 * generic names (e.g. "image.png"), so each is renamed to a timestamped
 * "pasted-image-…" file to keep attachment chips and dedupe keys distinct.
 *
 * Only media types supported by message serialization are extracted;
 * unsupported formats (e.g. BMP, SVG) are left to the default paste behavior
 * rather than shown as attachments that would be dropped on send.
 */
export function imageFilesFromClipboard(
	clipboardData: Pick<DataTransfer, "items"> | null,
): File[] {
	if (!clipboardData) {
		return [];
	}
	const files: File[] = [];
	for (const item of clipboardData.items) {
		if (item.kind !== "file" || !isSupportedImageMediaType(item.type)) {
			continue;
		}
		const file = item.getAsFile();
		if (!file || !isSupportedImageMediaType(file.type)) {
			continue;
		}
		files.push(
			new File([file], pastedImageName(file.type, files.length), {
				type: file.type,
				lastModified: Date.now(),
			}),
		);
	}
	return files;
}
