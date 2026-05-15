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
