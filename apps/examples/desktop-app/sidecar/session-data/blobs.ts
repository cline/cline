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

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}$/;
const BLOB_FILENAME_PATTERN = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/;

export interface SessionBlobFile {
	bytes: Buffer;
	mediaType: string;
	/** Absolute path the blob was served from. */
	path: string;
}

export function readSessionBlobFile(
	sessionId: string,
	filename: string,
): SessionBlobFile | undefined {
	if (!SESSION_ID_PATTERN.test(sessionId)) {
		return undefined;
	}
	const match = BLOB_FILENAME_PATTERN.exec(filename);
	if (!match) {
		return undefined;
	}
	const mediaType = BLOB_FILE_EXT_MEDIA_TYPES[match[2]];
	const blobsDir = resolve(
		join(resolveSessionDataDir(), sessionId, "blobs"),
	);
	const blobPath = resolve(join(blobsDir, match[0]));
	// Defense in depth: both components are already validated, but assert
	// containment so a surprising path component can never escape.
	if (!isAbsolute(blobPath) || !blobPath.startsWith(blobsDir)) {
		return undefined;
	}
	if (!existsSync(blobPath)) {
		return undefined;
	}
	try {
		return {
			bytes: readFileSync(blobPath),
			mediaType,
			path: blobPath,
		};
	} catch {
		return undefined;
	}
}