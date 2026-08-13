import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MaterializedGeneratedImage {
	path: string;
	mediaType: string;
	byteLength: number;
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/svg+xml": "svg",
};

/**
 * Persist a generated image where terminal users can open it with their usual
 * local tools. Each image gets a private temporary directory so concurrent
 * sessions cannot overwrite one another.
 */
export function materializeGeneratedImage(image: {
	data: string;
	mediaType: string;
}): MaterializedGeneratedImage | undefined {
	const mediaType = image.mediaType.trim().toLowerCase();
	if (!mediaType.startsWith("image/") || image.data.length === 0) {
		return undefined;
	}

	let directory: string | undefined;
	try {
		const bytes = Buffer.from(image.data, "base64");
		if (bytes.byteLength === 0) {
			return undefined;
		}
		directory = mkdtempSync(join(tmpdir(), "cline-generated-image-"));
		const extension = IMAGE_EXTENSIONS[mediaType] ?? "img";
		const path = join(directory, `generated.${extension}`);
		writeFileSync(path, bytes, { mode: 0o600 });
		return { path, mediaType, byteLength: bytes.byteLength };
	} catch {
		if (directory !== undefined) {
			rmSync(directory, { recursive: true, force: true });
		}
		return undefined;
	}
}
