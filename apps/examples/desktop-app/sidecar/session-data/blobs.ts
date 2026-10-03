import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { resolveSessionDataDir } from "@cline/shared/storage";

/**
 * Strict reader for session image blobs exposed over local HTTP
 * (`GET /blob/<sessionId>/<filename>`). Session ids and blob filenames are
 * validated so a crafted path can never escape the session data root.
 */

const BLOB_FILE_EXT_MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/** Media type -> file extension, mirroring BLOB_FILE_EXT_MEDIA_TYPES. */
const BLOB_MEDIA_TYPE_EXT: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}$/;
const BLOB_FILENAME_PATTERN = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/;

export interface SessionBlobFile {
	bytes: Buffer;
	mediaType: string;
	/** Absolute path the blob was served from. */
	path: string;
}

/**
 * Resolves a validated blob path beneath the session's `blobs/` directory.
 * The session id shape and the content-addressed filename are both validated,
 * and containment is asserted as defense in depth, so neither a crafted HTTP
 * request nor a crafted history entry can escape the session data root.
 */
function resolveSessionBlobFilePath(
	sessionId: string,
	filename: string,
): { path: string; mediaType: string } | undefined {
	if (!SESSION_ID_PATTERN.test(sessionId)) {
		return undefined;
	}
	const match = BLOB_FILENAME_PATTERN.exec(filename);
	if (!match) {
		return undefined;
	}
	const mediaType = BLOB_FILE_EXT_MEDIA_TYPES[match[2]];
	const blobsDir = resolve(join(resolveSessionDataDir(), sessionId, "blobs"));
	const blobPath = resolve(join(blobsDir, match[0]));
	if (!isAbsolute(blobPath) || !blobPath.startsWith(blobsDir)) {
		return undefined;
	}
	return { path: blobPath, mediaType };
}

export function readSessionBlobFile(
	sessionId: string,
	filename: string,
): SessionBlobFile | undefined {
	const resolved = resolveSessionBlobFilePath(sessionId, filename);
	if (!resolved || !existsSync(resolved.path)) {
		return undefined;
	}
	try {
		return {
			bytes: readFileSync(resolved.path),
			mediaType: resolved.mediaType,
			path: resolved.path,
		};
	} catch {
		return undefined;
	}
}

/**
 * Inlines a referenced blob as base64 for the history projection.
 *
 * `image_ref` keeps stored session files and hub-transported records small,
 * but the bundled desktop UI renders images as
 * `data:${mediaType};base64,${data}` — a blob URL cannot be substituted without
 * shipping a new frontend — so the UI projection pays for the bytes while
 * history on disk stays a reference. A ref whose file is missing degrades to
 * "image not rendered" instead of a broken payload.
 */
export function readSessionBlobBase64(
	sessionId: string,
	blobId: string,
	mediaType: string,
): string | undefined {
	const ext = BLOB_MEDIA_TYPE_EXT[mediaType];
	if (!ext) {
		return undefined;
	}
	const resolved = resolveSessionBlobFilePath(sessionId, `${blobId}.${ext}`);
	if (!resolved || !existsSync(resolved.path)) {
		return undefined;
	}
	try {
		return readFileSync(resolved.path).toString("base64");
	} catch {
		return undefined;
	}
}