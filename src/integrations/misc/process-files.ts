import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"
import sizeOf from "image-size"

/**
 * Supports processing of images and other file types
 * For models which don't support images, will not allow them to be selected
 */
export async function selectFiles(imagesAllowed: boolean): Promise<{ images: string[]; files: string[] }> {
	const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] // supported by anthropic and openrouter
	const OTHER_FILE_EXTENSIONS = ["xml", "json", "txt", "log", "md", "docx", "ipynb", "pdf"]

	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Select",
		filters: {
			Files: imagesAllowed ? [...IMAGE_EXTENSIONS, ...OTHER_FILE_EXTENSIONS] : OTHER_FILE_EXTENSIONS,
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return { images: [], files: [] }
	}

	const processFilesPromises = fileUris.map(async (uri) => {
		const filePath = uri.fsPath
		const fileExtension = path.extname(filePath).toLowerCase().substring(1)
		//const fileName = path.basename(filePath)

		const isImage = IMAGE_EXTENSIONS.includes(fileExtension)

		if (isImage) {
			let buffer: Buffer
			try {
				// Read the file into a buffer first
				buffer = await fs.readFile(filePath)
				// Convert Node.js Buffer to Uint8Array
				const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
				const dimensions = sizeOf(uint8Array) // Get dimensions from Uint8Array
				if (dimensions.width! > 7500 || dimensions.height! > 7500) {
					console.warn(`Image dimensions exceed 7500px, skipping: ${filePath}`)
					vscode.window.showErrorMessage(
						`Image too large: ${path.basename(filePath)} was skipped (dimensions exceed 7500px).`,
					)
					return null
				}
			} catch (error) {
				console.error(`Error reading file or getting dimensions for ${filePath}:`, error)
				vscode.window.showErrorMessage(`Could not read dimensions for ${path.basename(filePath)}, skipping.`)
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
					vscode.window.showErrorMessage(`File too large: ${path.basename(filePath)} was skipped (size exceeds 20MB).`)
					return null
				}
			} catch (error) {
				console.error(`Error checking file size for ${filePath}:`, error)
				vscode.window.showErrorMessage(`Could not check file size for ${path.basename(filePath)}, skipping.`)
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

function getMimeType(filePath: string): string {
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
