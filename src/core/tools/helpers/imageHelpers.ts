import path from "path"
import * as fs from "fs/promises"
import { t } from "../../../i18n"
import prettyBytes from "pretty-bytes"

/**
 * Default maximum allowed image file size in bytes (5MB)
 */
export const DEFAULT_MAX_IMAGE_FILE_SIZE_MB = 5

/**
 * Default maximum total memory usage for all images in a single read operation (20MB)
 * This is a cumulative limit - as each image is processed, its size is added to the total.
 * If including another image would exceed this limit, it will be skipped with a notice.
 * Example: With a 20MB limit, reading 3 images of 8MB, 7MB, and 10MB would process
 * the first two (15MB total) but skip the third to stay under the limit.
 */
export const DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB = 20

/**
 * Supported image formats that can be displayed
 */
export const SUPPORTED_IMAGE_FORMATS = [
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".bmp",
	".ico",
	".tiff",
	".tif",
	".avif",
] as const

export const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".tiff": "image/tiff",
	".tif": "image/tiff",
	".avif": "image/avif",
}

/**
 * Result of image validation
 */
export interface ImageValidationResult {
	isValid: boolean
	reason?: "size_limit" | "memory_limit" | "unsupported_model"
	notice?: string
	sizeInMB?: number
}

/**
 * Result of image processing
 */
export interface ImageProcessingResult {
	dataUrl: string
	buffer: Buffer
	sizeInKB: number
	sizeInMB: number
	notice: string
}

/**
 * Reads an image file and returns both the data URL and buffer
 */
export async function readImageAsDataUrlWithBuffer(filePath: string): Promise<{ dataUrl: string; buffer: Buffer }> {
	const fileBuffer = await fs.readFile(filePath)
	const base64 = fileBuffer.toString("base64")
	const ext = path.extname(filePath).toLowerCase()

	const mimeType = IMAGE_MIME_TYPES[ext] || "image/png"
	const dataUrl = `data:${mimeType};base64,${base64}`

	return { dataUrl, buffer: fileBuffer }
}

/**
 * Checks if a file extension is a supported image format
 */
export function isSupportedImageFormat(extension: string): boolean {
	return SUPPORTED_IMAGE_FORMATS.includes(extension.toLowerCase() as (typeof SUPPORTED_IMAGE_FORMATS)[number])
}

/**
 * Validates if an image can be processed based on size limits and model support
 */
export async function validateImageForProcessing(
	fullPath: string,
	supportsImages: boolean,
	maxImageFileSize: number,
	maxTotalImageSize: number,
	currentTotalMemoryUsed: number,
): Promise<ImageValidationResult> {
	// Check if model supports images
	if (!supportsImages) {
		return {
			isValid: false,
			reason: "unsupported_model",
			notice: "Image file detected but current model does not support images. Skipping image processing.",
		}
	}

	const imageStats = await fs.stat(fullPath)
	const imageSizeInMB = imageStats.size / (1024 * 1024)

	// Check individual file size limit
	if (imageStats.size > maxImageFileSize * 1024 * 1024) {
		const imageSizeFormatted = prettyBytes(imageStats.size)
		return {
			isValid: false,
			reason: "size_limit",
			notice: t("tools:readFile.imageTooLarge", {
				size: imageSizeFormatted,
				max: maxImageFileSize,
			}),
			sizeInMB: imageSizeInMB,
		}
	}

	// Check total memory limit
	if (currentTotalMemoryUsed + imageSizeInMB > maxTotalImageSize) {
		const currentMemoryFormatted = prettyBytes(currentTotalMemoryUsed * 1024 * 1024)
		const fileMemoryFormatted = prettyBytes(imageStats.size)
		return {
			isValid: false,
			reason: "memory_limit",
			notice: `Image skipped to avoid size limit (${maxTotalImageSize}MB). Current: ${currentMemoryFormatted} + this file: ${fileMemoryFormatted}. Try fewer or smaller images.`,
			sizeInMB: imageSizeInMB,
		}
	}

	return {
		isValid: true,
		sizeInMB: imageSizeInMB,
	}
}

/**
 * Processes an image file and returns the result
 */
export async function processImageFile(fullPath: string): Promise<ImageProcessingResult> {
	const imageStats = await fs.stat(fullPath)
	const { dataUrl, buffer } = await readImageAsDataUrlWithBuffer(fullPath)
	const imageSizeInKB = Math.round(imageStats.size / 1024)
	const imageSizeInMB = imageStats.size / (1024 * 1024)
	const noticeText = t("tools:readFile.imageWithSize", { size: imageSizeInKB })

	return {
		dataUrl,
		buffer,
		sizeInKB: imageSizeInKB,
		sizeInMB: imageSizeInMB,
		notice: noticeText,
	}
}

/**
 * Memory tracker for image processing
 */
export class ImageMemoryTracker {
	private totalMemoryUsed: number = 0

	/**
	 * Gets the current total memory used in MB
	 */
	getTotalMemoryUsed(): number {
		return this.totalMemoryUsed
	}

	/**
	 * Adds to the total memory used
	 */
	addMemoryUsage(sizeInMB: number): void {
		this.totalMemoryUsed += sizeInMB
	}

	/**
	 * Resets the memory tracker
	 */
	reset(): void {
		this.totalMemoryUsed = 0
	}
}
