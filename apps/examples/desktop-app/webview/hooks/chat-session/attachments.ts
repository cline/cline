import { validateImageMedia } from "@cline/shared/browser";
import type { ChatMessageImage } from "@/lib/chat-schema";
import type { SerializedAttachmentFile, SerializedAttachments } from "./types";

async function readFileAsDataUrl(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const value = typeof reader.result === "string" ? reader.result : "";
			resolve(value);
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("failed reading file"));
		};
		reader.readAsDataURL(file);
	});
}

export async function serializeAttachments(
	files: File[],
): Promise<SerializedAttachments> {
	const userImages: string[] = [];
	const userFiles: SerializedAttachmentFile[] = [];

	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const dataUrl = await readFileAsDataUrl(file);
			if (dataUrl) {
				userImages.push(dataUrl);
			}
			continue;
		}

		const content = await file.text();
		userFiles.push({
			name: file.name,
			content,
		});
	}

	return { userImages, userFiles };
}

// The transcript stores non-image attachments as a display label appended to
// the prompt text. Every label producer (the optimistic send path builds it
// from File objects, the queued-turn start event from an attachment count)
// must go through these helpers so the transcript stays consistent no matter
// which side rendered the user bubble.
const ATTACHED_FILES_SUFFIX_PATTERN = /\n*\[attached \d+ files?\]$/;

export function buildUserPromptDisplayLabelFromCount(
	prompt: string,
	attachedFileCount: number,
): string {
	const trimmed = prompt.trim();
	if (attachedFileCount <= 0) {
		return trimmed;
	}
	const suffix = `[attached ${attachedFileCount} file${attachedFileCount === 1 ? "" : "s"}]`;
	return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${suffix}`;
}

export function buildUserPromptDisplayLabel(
	prompt: string,
	attachedFiles: readonly File[],
): string {
	return buildUserPromptDisplayLabelFromCount(
		prompt,
		attachedFiles.filter((file) => !file.type.startsWith("image/")).length,
	);
}

// Recovers the raw prompt text from a transcript user label. Used by the
// retry fallback that only has the transcript to work from — the attachment
// suffix is display decoration and must not be re-sent as prompt text.
export function stripAttachedFilesSuffix(label: string): string {
	return label.replace(ATTACHED_FILES_SUFFIX_PATTERN, "").trim();
}

export function toChatMessageImages(
	userImages: string[],
	idPrefix: string,
): ChatMessageImage[] {
	const images: ChatMessageImage[] = [];
	for (const [index, value] of userImages.entries()) {
		const validation = validateImageMedia(undefined, value);
		if (!validation.ok) {
			continue;
		}
		images.push({
			id: `${idPrefix}_image_${index}`,
			mediaType: validation.mediaType,
			data: validation.base64,
		});
	}
	return images;
}
