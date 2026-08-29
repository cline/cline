import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeneratedMedia } from "@cline/shared";

export interface MaterializedGeneratedMedia {
	path: string;
	mediaType: string;
	modality: GeneratedMedia["modality"];
	byteLength: number;
}

const materializedMediaDirectories = new Set<string>();
let exitCleanupRegistered = false;

/** Remove temporary files created for terminal display. */
export function cleanupMaterializedGeneratedMedia(): void {
	for (const directory of materializedMediaDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
	materializedMediaDirectories.clear();
}

function trackMaterializedMediaDirectory(directory: string): void {
	materializedMediaDirectories.add(directory);
	if (exitCleanupRegistered) return;
	exitCleanupRegistered = true;
	process.once("exit", cleanupMaterializedGeneratedMedia);
}

const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/svg+xml": "svg",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/ogg": "ogg",
	"video/mp4": "mp4",
	"video/webm": "webm",
};

/**
 * Persist generated media where terminal users can open it with their usual
 * local tools. Each item gets a private temporary directory so concurrent
 * sessions cannot overwrite one another.
 */
export function materializeGeneratedMedia(
	media: GeneratedMedia,
): MaterializedGeneratedMedia | undefined {
	const mediaType = media.mediaType.trim().toLowerCase();
	if (media.source.type !== "base64" || media.source.data.length === 0) {
		return undefined;
	}

	let directory: string | undefined;
	try {
		const bytes = Buffer.from(media.source.data, "base64");
		if (bytes.byteLength === 0) {
			return undefined;
		}
		directory = mkdtempSync(join(tmpdir(), "cline-generated-media-"));
		const extension = MEDIA_EXTENSIONS[mediaType] ?? "bin";
		const path = join(directory, `generated.${extension}`);
		writeFileSync(path, bytes, { mode: 0o600 });
		trackMaterializedMediaDirectory(directory);
		return {
			path,
			mediaType,
			modality: media.modality,
			byteLength: bytes.byteLength,
		};
	} catch {
		if (directory !== undefined) {
			rmSync(directory, { recursive: true, force: true });
		}
		return undefined;
	}
}
