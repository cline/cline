import fs from "fs/promises"
import sizeOf from "image-size"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

/**
 * Supports processing of images and other file types
 * For models which don't support images, will not allow them to be selected
 */
export async function selectFiles(imagesAllowed: boolean): Promise<{ images: string[]; files: string[] }> {
	const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] // supported by anthropic and openrouter
	const OTHER_FILE_EXTENSIONS = ["xml", "json", "txt", "log", "md", "docx", "ipynb", "pdf", "xlsx", "csv"]

	const showDialogueResponse = await HostProvider.window.showOpenDialogue({
		canSelectMany: true,
		openLabel: "Select",
		filters: {
			files: imagesAllowed ? [...IMAGE_EXTENSIONS, ...OTHER_FILE_EXTENSIONS] : OTHER_FILE_EXTENSIONS,
		},
	})

	const filePaths = showDialogueResponse.paths

	if (!filePaths || filePaths.length === 0) {
		return { images: [], files: [] }
	}

	const processFilesPromises = filePaths.map(async (filePath) => {
		const fileExtension = path.extname(filePath).toLowerCase().substring(1)

		const isImage = IMAGE_EXTENSIONS.includes(fileExtension)

		if (isImage) {
			let buffer: Buffer
			try {
				// Read the file into a buffer first
				buffer = await fs.readFile(filePath)
				// Convert Node.js Buffer to Uint8Array
				const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
				const dimensions = sizeOf(uint8Array) // Get dimensions from Uint8Array
				if (dimensions.width! > 7680 || dimensions.height! > 7680) {
					console.warn(`Image dimensions exceed 7500px, skipping: ${filePath}`)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Image too large: ${path.basename(filePath)} was skipped (dimensions exceed 7500px).`,
					})
					return null
				}
			} catch (error) {
				console.error(`Error reading file or getting dimensions for ${filePath}:`, error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Could not read dimensions for ${path.basename(filePath)}, skipping.`,
				})
				return null
			}

			// If dimensions are valid, proceed to convert the existing buffer to base64
			const base64 = buffer.toString("base64")
			const mimeType = getMimeType(filePath)

			return { type: "image", data: `data:${mimeType};base64,${base64}` }
		} else {
			// for standard models we will check the size of the file to ensure its not too large
			try {
				const stats = await fs.stat(filePath)
				if (stats.size > 20 * 1000 * 1024) {
					console.warn(`File too large, skipping: ${filePath}`)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `File too large: ${path.basename(filePath)} was skipped (size exceeds 20MB).`,
					})
					return null
				}
			} catch (error) {
				console.error(`Error checking file size for ${filePath}:`, error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Could not check file size for ${path.basename(filePath)}, skipping.`,
				})
				return null
			}
			return { type: "file", data: filePath }
		}
	})

	const dataUrlsWithNulls = await Promise.all(processFilesPromises)
	const dataUrlsWithoutNulls = dataUrlsWithNulls.filter((item) => item !== null)

	const images: string[] = []
	const files: string[] = []

	for (const item of dataUrlsWithoutNulls) {
		if (item.type === "image") {
			images.push(item.data)
		} else {
			files.push(item.data)
		}
	}

	return { images, files }
}

export function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpeg":
		case ".jpg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		default:
			throw new Error(`Unsupported file type: ${ext}`)
	}
}
