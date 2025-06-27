import * as path from "path"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import { callTextExtractionFunctions } from "./extract-text"
import { extractImageContent } from "./extract-images"

export type FileContentResult = {
	text: string
	imageBlock?: Anthropic.ImageBlockParam
}

/**
 * Extract content from a file, handling both text and images
 * Extra logic for handling images based on whether the model supports images
 */
export async function extractFileContent(absolutePath: string, modelSupportsImages: boolean): Promise<FileContentResult> {
	// Check if file exists first
	try {
		await fs.access(absolutePath)
	} catch (error) {
		throw new Error(`File not found: ${absolutePath}`)
	}

	const fileExtension = path.extname(absolutePath).toLowerCase()
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const isImage = imageExtensions.includes(fileExtension)

	if (isImage && modelSupportsImages) {
		const imageResult = await extractImageContent(absolutePath)

		if (imageResult.success) {
			return {
				text: "Successfully read image",
				imageBlock: imageResult.imageBlock,
			}
		} else {
			throw new Error(imageResult.error)
		}
	} else if (isImage && !modelSupportsImages) {
		throw new Error(`Current model does not support image input`)
	} else {
		// Handle text files using existing extraction functions
		try {
			const textContent = await callTextExtractionFunctions(absolutePath)
			return {
				text: textContent,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Error reading file: ${errorMessage}`)
		}
	}
}
