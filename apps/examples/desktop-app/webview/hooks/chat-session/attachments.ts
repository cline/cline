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
// the prompt text. Kept as the single source of truth so consumers that need
// to match a transcript user message back to its send payload (e.g. the
// failed-turn Retry action) compute the exact same label.
export function buildUserPromptDisplayLabel(
	prompt: string,
	attachedFiles: readonly File[],
): string {
	const trimmed = prompt.trim();
	const attachedFileCount = attachedFiles.filter(
		(file) => !file.type.startsWith("image/"),
	).length;
	return attachedFileCount > 0
		? `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[attached ${attachedFileCount} file${attachedFileCount === 1 ? "" : "s"}]`
		: trimmed;
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
