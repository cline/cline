const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/bmp": "bmp",
	"image/svg+xml": "svg",
};

function pastedImageName(mediaType: string, index: number): string {
	const extension = EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "png";
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
 */
export function imageFilesFromClipboard(
	clipboardData: Pick<DataTransfer, "items"> | null,
): File[] {
	if (!clipboardData) {
		return [];
	}
	const files: File[] = [];
	for (const item of clipboardData.items) {
		if (item.kind !== "file" || !item.type.startsWith("image/")) {
			continue;
		}
		const file = item.getAsFile();
		if (!file) {
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
