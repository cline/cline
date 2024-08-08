import * as vscode from "vscode"
import fs from "fs/promises"
import sharp from "sharp"

export async function selectAndProcessImages(): Promise<string[]> {
	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Select",
		filters: {
			Images: ["png", "jpg", "jpeg", "gif", "webp", "tiff", "avif", "svg"], // sharp can convert these to webp which both anthropic and openrouter support
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return []
	}

	return await Promise.all(
		fileUris.map(async (uri) => {
			const imagePath = uri.fsPath
			const originalBuffer = await fs.readFile(imagePath)
			return convertToWebpBase64(originalBuffer)
		})
	)
}

export async function processPastedImages(base64Strings: string[]): Promise<string[]> {
	return await Promise.all(
		base64Strings.map(async (base64) => {
			const buffer = Buffer.from(base64, "base64")
			return convertToWebpBase64(buffer)
		})
	)
}

async function convertToWebpBase64(buffer: Buffer): Promise<string> {
	const processedBuffer = await sharp(buffer)
		/*
                Anthropic docs recommendations:
                - To improve time-to-first-token resize images to no more than 1.15 megapixels (and within 1568 pixels in both dimensions)
                - WebP is a newer image format that's more efficient than PNG and JPEG, so ideal for keeping token usage low. (ive seen the following compression decrease size by 10x)
                */
		.resize(1568, 1568, {
			fit: "inside", // maintain aspect ratio
			withoutEnlargement: true, // don't enlarge smaller images
		})
		.webp({
			// NOTE: consider increasing effort from 4 to 6 (max), this may increase processing time by up to ~500ms
			quality: 80,
		})
		.toBuffer()

	const base64 = processedBuffer.toString("base64")

	// console.log({
	// 	originalSize: buffer.length,
	// 	processedSize: processedBuffer.length,
	// 	base64,
	// })

	return base64
}
