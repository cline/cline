import { validateImageMedia } from "@cline/shared/browser";
import type { ChatMessageImage } from "@/lib/chat-schema";
import { imageAttachmentMediaType } from "@/lib/image-attachments";
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
		const mediaType = imageAttachmentMediaType(file);
		if (mediaType) {
			const dataUrl = await readFileAsDataUrl(
				new File([file], file.name, { type: mediaType }),
			);
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
