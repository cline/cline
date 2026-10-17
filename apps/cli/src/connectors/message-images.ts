import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The pictures a message carries, saved where a command can hand them on.
 *
 * The connector used to read only a message's text, so a screenshot captioned `/task …` reached
 * the card as its caption alone -- and the picture was the clearest part of the demand.
 */

export interface IncomingImages {
	/** The directory holding them, so whoever used them can remove it. */
	dir: string;
	paths: string[];
	/** Images the message had that could not be downloaded. */
	failed: number;
	/** Images Kanban would refuse -- wrong type or too large -- left out so the card still gets filed. */
	refused: number;
}

/** What the chat library gives for an attachment; only what this needs. */
export interface MessageAttachmentLike {
	type?: string;
	mimeType?: string;
	name?: string;
	/** Bytes, when the platform says before download (Telegram's `file_size`). */
	size?: number;
	fetchData?: () => Promise<Buffer>;
}

/** Kanban's own limit: a card stores images base64 inside the board's state file. */
export const MAX_MESSAGE_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
};

/** A photo, or a picture sent "as a file" -- Telegram sends that as a document. */
function isImage(attachment: MessageAttachmentLike): boolean {
	return (
		attachment.type === "image" ||
		(attachment.mimeType?.startsWith("image/") ?? false)
	);
}

/** One of the types Kanban attaches; anything else would be saved under a name that lies. */
function extensionFor(attachment: MessageAttachmentLike): string | undefined {
	const mimeType =
		attachment.mimeType ??
		(attachment.type === "image" ? "image/jpeg" : undefined);
	return mimeType ? EXTENSION_BY_MIME_TYPE[mimeType] : undefined;
}

export async function saveMessageImages(input: {
	attachments: readonly MessageAttachmentLike[] | undefined;
	rootDir: string;
}): Promise<IncomingImages | undefined> {
	const images = (input.attachments ?? []).filter(isImage);
	if (images.length === 0) {
		return undefined;
	}
	const dir = join(input.rootDir, randomUUID());
	await mkdir(dir, { recursive: true });
	const paths: string[] = [];
	let failed = 0;
	let refused = 0;
	for (const [index, image] of images.entries()) {
		// Refused here rather than by Kanban: Kanban refuses the whole card over one bad picture,
		// and the demand in the caption deserves its card regardless.
		const extension = extensionFor(image);
		if (!extension || (image.size ?? 0) > MAX_MESSAGE_IMAGE_BYTES) {
			refused += 1;
			continue;
		}
		try {
			if (!image.fetchData) {
				throw new Error("no way to download it");
			}
			const data = await image.fetchData();
			if (data.length > MAX_MESSAGE_IMAGE_BYTES) {
				refused += 1;
				continue;
			}
			const path = join(dir, `image-${index + 1}.${extension}`);
			await writeFile(path, data);
			paths.push(path);
		} catch {
			// The demand in the caption still deserves its card; the reply says what was lost.
			failed += 1;
		}
	}
	return { dir, paths, failed, refused };
}

/** Removes leftovers -- `/task --brainstorm` keeps its pictures until the agent has used them. */
export async function pruneOldImageDirs(
	rootDir: string,
	maxAgeMs: number,
	now = Date.now(),
): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(rootDir);
	} catch {
		return;
	}
	await Promise.all(
		entries.map(async (entry) => {
			const path = join(rootDir, entry);
			try {
				const info = await stat(path);
				if (now - info.mtimeMs > maxAgeMs) {
					await rm(path, { recursive: true, force: true });
				}
			} catch {
				// Gone already, or not ours to touch: either way nothing to do.
			}
		}),
	);
}
