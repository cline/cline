import { Anthropic } from "@anthropic-ai/sdk"
import fs from "fs/promises"
import sizeOf from "image-size"
import { getMimeType } from "./process-files"

/**
 * Extract image content without VSCode dependencies
 * Returns success/error result to avoid throwing exceptions
 */
export async function extractImageContent(
	filePath: string,
): Promise<{ success: true; imageBlock: Anthropic.ImageBlockParam } | { success: false; error: string }> {
	try {
		// Read the file into a buffer
		const buffer = await fs.readFile(filePath)

		// Convert Node.js Buffer to Uint8Array for image-size
		const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

		// Get dimensions from Uint8Array
		const dimensions = sizeOf(uint8Array)

		if (!dimensions.width || !dimensions.height) {
			return { success: false, error: "Could not determine image dimensions, so image could not be read" }
		}

		if (dimensions.width > 7500 || dimensions.height > 7500) {
			return {
				success: false,
				error: "Image dimensions exceed 7500px by 7500px, so image could not be read",
			}
		}

		// Convert buffer to base64
		const base64 = buffer.toString("base64")
		const mimeType = getMimeType(filePath) as "image/jpeg" | "image/png" | "image/webp"

		// Create the image block in Anthropic format
		const imageBlock: Anthropic.ImageBlockParam = {
			type: "image",
			source: {
				type: "base64",
				media_type: mimeType,
				data: base64,
			},
		}

		return { success: true, imageBlock }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		return { success: false, error: `Error reading image: ${errorMessage}` }
	}
}
