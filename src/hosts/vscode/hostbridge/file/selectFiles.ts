import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import sizeOf from "image-size"
import { BooleanRequest, StringArrays } from "@/shared/proto/common"

export async function selectFiles(request: BooleanRequest): Promise<StringArrays> {
	try {
		const imagesAllowed = request.value
		const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] // supported by anthropic and openrouter
		const OTHER_FILE_EXTENSIONS = ["xml", "json", "txt", "log", "md", "docx", "ipynb", "pdf", "xlsx", "csv"]

		const options: vscode.OpenDialogOptions = {
			canSelectMany: true,
			openLabel: "Select",
			filters: {
				files: imagesAllowed ? [...IMAGE_EXTENSIONS, ...OTHER_FILE_EXTENSIONS] : OTHER_FILE_EXTENSIONS,
			},
		}

		const fileUris = await vscode.window.showOpenDialog(options)

		if (!fileUris || fileUris.length === 0) {
			return StringArrays.create({ values1: [], values2: [] })
		}

		const images: string[] = []
		const files: string[] = []

		for (const uri of fileUris) {
			const filePath = uri.fsPath
			const extension = path.extname(filePath).slice(1).toLowerCase()

			if (IMAGE_EXTENSIONS.includes(extension) && imagesAllowed) {
				try {
					// Read file once and use for both dimension check and base64 conversion
					const buffer = await fs.readFile(filePath)

					// Check image dimensions
					const dimensions = sizeOf(buffer)
					if (!dimensions.width || !dimensions.height) {
						console.warn(`Could not get dimensions for image: ${filePath}`)
						continue
					}

					if (dimensions.width > 7500 || dimensions.height > 7500) {
						console.warn(`Image dimensions exceed 7500px, skipping: ${filePath}`)
						continue
					}

					// Convert to base64 data URL
					const base64 = buffer.toString("base64")
					const mimeType = `image/${extension === "jpg" ? "jpeg" : extension}`
					const dataUrl = `data:${mimeType};base64,${base64}`

					// Images only go in values1 (thumbnails only, no file path)
					images.push(dataUrl)
				} catch (error) {
					console.error(`Error processing image ${filePath}:`, error)
				}
			} else {
				try {
					// Check file size (20MB limit)
					const stats = await fs.stat(filePath)
					if (stats.size > 20 * 1024 * 1024) {
						console.warn(`File too large, skipping: ${filePath}`)
						continue
					}
					files.push(filePath)
				} catch (error) {
					console.error(`Error checking file ${filePath}:`, error)
				}
			}
		}

		// Ensure we always return arrays, even if empty
		const result = StringArrays.create({
			values1: images.length > 0 ? images : [],
			values2: files.length > 0 ? files : [],
		})
		console.log("VSCode selectFiles result:", {
			values1Count: result.values1?.length || 0,
			values2Count: result.values2?.length || 0,
			values1: result.values1,
			values2: result.values2,
		})
		return result
	} catch (error) {
		console.error("Error selecting images & files:", error)
		// Return empty array on error
		return StringArrays.create({ values1: [], values2: [] })
	}
}
