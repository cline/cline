import { readFileSync } from "node:fs";

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".svg",
]);

export function isImagePath(filePath: string): boolean {
	const normalized = filePath.toLowerCase();
	for (const extension of IMAGE_EXTENSIONS) {
		if (normalized.endsWith(extension)) {
			return true;
		}
	}
	return false;
}

export function getImageMimeType(filePath: string): string {
	const ext = filePath.toLowerCase().split(".").pop() || "";
	const mimeTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		bmp: "image/bmp",
		svg: "image/svg+xml",
	};
	return mimeTypes[ext] || "image/png";
}

export function bufferToImageDataUrl(buffer: Buffer, mimeType: string): string {
	return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function loadImageAsDataUrl(filePath: string): string {
	try {
		const buffer = readFileSync(filePath);
		return bufferToImageDataUrl(buffer, getImageMimeType(filePath));
	} catch (error) {
		throw new Error(
			`Failed to load image from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
