import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageRefContent } from "@cline/shared";

/**
 * Session blob store.
 *
 * Binary tool output (images from read_files, etc.) is content-addressed on
 * disk under `<session artifacts dir>/blobs/` at persist time. Conversation
 * history then references the blob instead of carrying base64 through the
 * session transport, which previously re-shipped multi-megabyte image payloads
 * on every attach, event replay, and model request serialization (see upstream
 * issue cline/cline#14707).
 */

/**
 * Images at or above this base64-encoded size stop inlining into history and
 * become `image_ref` blocks. Smaller images (inline icons, tiny screenshots)
 * stay inline so simple clients do not need blob plumbing.
 */
export const IMAGE_BLOB_INLINE_THRESHOLD_BASE64_CHARS = 16 * 1024;

const BLOB_MEDIA_TYPES: Record<string, { ext: string }> = {
	"image/png": { ext: "png" },
	"image/jpeg": { ext: "jpg" },
	"image/gif": { ext: "gif" },
	"image/webp": { ext: "webp" },
};

const IMAGE_REF_TYPE = "image_ref";

export function isImageRefContent(value: unknown): value is ImageRefContent {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as { type?: unknown }).type === IMAGE_REF_TYPE &&
		typeof (value as { blobId?: unknown }).blobId === "string" &&
		typeof (value as { mediaType?: unknown }).mediaType === "string"
	);
}

export function sessionBlobsDir(artifactsDir: string): string {
	return join(artifactsDir, "blobs");
}

/**
 * Validate a caller-supplied blob filename (sessionId + stem) against the
 * strict content-addressed shape so path traversal can never escape the
 * session's blobs directory.
 */
export function resolveSessionBlobPath(
	artifactsDir: string,
	blobId: string,
	mediaType: string,
): string | undefined {
	if (!/^[a-f0-9]{64}$/.test(blobId)) {
		return undefined;
	}
	const entry = BLOB_MEDIA_TYPES[mediaType];
	if (!entry) {
		return undefined;
	}
	return join(sessionBlobsDir(artifactsDir), `${blobId}.${entry.ext}`);
}

/**
 * Store decoded image bytes under the session artifacts dir and return the
 * reference block that replaces the inline `image` content. Idempotent:
 * identical bytes dedupe to the same file and existing files are never
 * rewritten. Returns undefined for non-image media or suspicious input so
 * callers can leave the content untouched.
 */
export function storeImageBlob(
	artifactsDir: string,
	base64Data: string,
	mediaType: string,
	source?: string,
): ImageRefContent | undefined {
	if (typeof base64Data !== "string" || base64Data.length === 0) {
		return undefined;
	}
	const entry = BLOB_MEDIA_TYPES[mediaType];
	if (!entry) {
		return undefined;
	}
	const bytes = Buffer.from(base64Data, "base64");
	if (bytes.length === 0) {
		return undefined;
	}
	const blobId = createHash("sha256").update(bytes).digest("hex");
	const dir = sessionBlobsDir(artifactsDir);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const blobPath = join(dir, `${blobId}.${entry.ext}`);
	if (!existsSync(blobPath)) {
		writeFileSync(blobPath, bytes);
	}
	return {
		type: IMAGE_REF_TYPE,
		blobId,
		mediaType,
		bytes: bytes.length,
		...(source !== undefined && source.trim()
			? { source: source.trim() }
			: {}),
	};
}

/**
 * Replace qualifying inline image content with `image_ref` blocks, returning a
 * new message array (input objects are never mutated: the live runtime
 * conversation keeps raw bytes so the in-flight turn can still send the image
 * to the model once).
 */
export function blobifyStoredMessageMedia(
	messages: unknown[],
	artifactsDir: string,
	thresholdBase64Chars = IMAGE_BLOB_INLINE_THRESHOLD_BASE64_CHARS,
): { messages: unknown[]; refCount: number } {
	let refCount = 0;

	const convert = (value: unknown): unknown => {
		if (Array.isArray(value)) {
			let changed = false;
			const next = value.map((item) => {
				const out = convert(item);
				if (out !== item) {
					changed = true;
				}
				return out;
			});
			return changed ? next : value;
		}
		if (value !== null && typeof value === "object") {
			const record = value as Record<string, unknown>;
			if (
				record.type === "image" &&
				typeof record.data === "string" &&
				record.data.length >= thresholdBase64Chars &&
				typeof record.mediaType === "string"
			) {
				const ref = storeImageBlob(
					artifactsDir,
					record.data,
					record.mediaType,
					typeof record.source === "string" ? record.source : undefined,
				);
				if (ref) {
					refCount += 1;
					return ref;
				}
			}
			let changed = false;
			const next: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(record)) {
				const out = convert(item);
				if (out !== item) {
					changed = true;
				}
				next[key] = out;
			}
			return changed ? next : value;
		}
		return value;
	};

	let changed = false;
	const next = messages.map((message) => {
		const out = convert(message);
		if (out !== message) {
			changed = true;
		}
		return out;
	});
	return changed ? { messages: next, refCount } : { messages, refCount: 0 };
}