import fs from "node:fs"
import path from "node:path"

export function jsonParseSafe<T>(data: string, defaultValue: T): T {
	try {
		return JSON.parse(data) as T
	} catch {
		return defaultValue
	}
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"])

/**
 * Check if a file path is an image based on extension
 */
export function isImagePath(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return IMAGE_EXTENSIONS.has(ext)
}

/**
 * Get MIME type for an image extension
 */
function getMimeType(ext: string): string {
	const mimeTypes: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
	}
	return mimeTypes[ext.toLowerCase()] || "image/png"
}

/**
 * Convert an image file path to a base64 data URL
 */
export async function imageFileToDataUrl(filePath: string): Promise<string> {
	const resolvedPath = path.resolve(filePath)
	const ext = path.extname(resolvedPath).toLowerCase()
	const mimeType = getMimeType(ext)

	const buffer = await fs.promises.readFile(resolvedPath)
	const base64 = buffer.toString("base64")

	return `data:${mimeType};base64,${base64}`
}

/**
 * Parse input text and extract image file paths.
 * Supports formats like: "prompt text @/path/to/image.png" or just file paths
 * Returns the clean prompt text and array of image paths
 */
export function parseImagesFromInput(input: string): { prompt: string; imagePaths: string[] } {
	const imagePaths: string[] = []

	// Match @/path/to/image.ext patterns (with space or at start)
	const atPathPattern = /(?:^|\s)@(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))/gi
	let match: RegExpExecArray | null
	while ((match = atPathPattern.exec(input)) !== null) {
		imagePaths.push(match[1])
	}

	// Also match standalone absolute paths that look like images
	const standalonePathPattern = /(?:^|\s)(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))(?:\s|$)/gi
	while ((match = standalonePathPattern.exec(input)) !== null) {
		const p = match[1]
		if (!imagePaths.includes(p)) {
			imagePaths.push(p)
		}
	}

	// Remove the image references from the prompt
	const prompt = input.replace(atPathPattern, " ").replace(standalonePathPattern, " ").replace(/\s+/g, " ").trim()

	return { prompt, imagePaths }
}

/**
 * Process image file paths into base64 data URLs
 * Returns only successfully converted images
 */
export async function processImagePaths(imagePaths: string[]): Promise<string[]> {
	const dataUrls: string[] = []

	for (const imagePath of imagePaths) {
		try {
			const resolvedPath = path.resolve(imagePath)
			if (fs.existsSync(resolvedPath) && isImagePath(resolvedPath)) {
				const dataUrl = await imageFileToDataUrl(resolvedPath)
				dataUrls.push(dataUrl)
			}
		} catch {
			// Skip files that can't be read
		}
	}

	return dataUrls
}
