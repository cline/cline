import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"
import sizeOf from "image-size"

export async function selectImages(): Promise<string[]> {
	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Select",
		filters: {
			Images: ["png", "jpg", "jpeg", "webp"], // supported by anthropic and openrouter
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return []
	}

	const processedImagePromises = fileUris.map(async (uri) => {
		const imagePath = uri.fsPath
		let buffer: Buffer
		try {
			// Read the file into a buffer first
			buffer = await fs.readFile(imagePath)
			// Convert Node.js Buffer to Uint8Array
			const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
			const dimensions = sizeOf(uint8Array) // Get dimensions from Uint8Array
			if (dimensions.width! > 7500 || dimensions.height! > 7500) {
				console.warn(`Image dimensions exceed 7500px, skipping: ${imagePath}`)
				vscode.window.showErrorMessage(
					`Image too large: ${path.basename(imagePath)} was skipped (dimensions exceed 7500px).`,
				)
				return null
			}
		} catch (error) {
			console.error(`Error reading file or getting dimensions for ${imagePath}:`, error)
			vscode.window.showErrorMessage(`Could not read dimensions for ${path.basename(imagePath)}, skipping.`)
			return null
		}

		// If dimensions are valid, proceed to convert the existing buffer to base64
		const base64 = buffer.toString("base64")
		const mimeType = getMimeType(imagePath)
		return `data:${mimeType};base64,${base64}`
	})

	const dataUrlsWithNulls = await Promise.all(processedImagePromises)
	return dataUrlsWithNulls.filter((url) => url !== null) as string[] // Filter out skipped images
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
