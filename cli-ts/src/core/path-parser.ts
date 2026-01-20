/**
 * Path parser for @path syntax and file attachment handling
 *
 * Provides utilities for:
 * - Parsing @path references from message text
 * - Detecting image files by extension
 * - Converting image files to base64 data URLs
 */

import fs from "fs"
import path from "path"

/**
 * Supported image extensions (what Anthropic API accepts)
 */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"])

/**
 * MIME types for image extensions
 */
const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
}

/**
 * Result of parsing @path references from a message
 */
export interface ParsedAttachments {
	/** Message with @paths removed */
	cleanedMessage: string
	/** Non-image file paths (absolute) */
	files: string[]
	/** Base64 data URLs for images */
	images: string[]
	/** Warnings for files that couldn't be processed */
	warnings: string[]
}

/**
 * Check if a file path is an image based on extension
 */
export function isImageFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return IMAGE_EXTENSIONS.has(ext)
}

/**
 * Convert an image file to a base64 data URL
 *
 * @param filePath - Path to the image file
 * @returns Base64 data URL (data:image/type;base64,...)
 * @throws Error if file doesn't exist or isn't a valid image type
 */
export function fileToBase64DataUrl(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	const mimeType = IMAGE_MIME_TYPES[ext]

	if (!mimeType) {
		throw new Error(`Unsupported image format: ${ext}. Supported formats: ${Array.from(IMAGE_EXTENSIONS).join(", ")}`)
	}

	if (!fs.existsSync(filePath)) {
		throw new Error(`Image file not found: ${filePath}`)
	}

	const buffer = fs.readFileSync(filePath)
	const base64 = buffer.toString("base64")

	return `data:${mimeType};base64,${base64}`
}

/**
 * Parse @path references from a message string
 *
 * Supports:
 * - @./relative/path - relative to cwd
 * - @/absolute/path - absolute path
 * - @path/without/dot - relative to cwd
 *
 * @paths must be preceded by whitespace or be at start of string
 * @paths end at whitespace or end of string
 *
 * @param message - The message text to parse
 * @param cwd - Current working directory for resolving relative paths
 * @returns Parsed attachments with cleaned message, files, images, and warnings
 */
export function parseAtPaths(message: string, cwd: string): ParsedAttachments {
	const files: string[] = []
	const images: string[] = []
	const warnings: string[] = []

	// Regex to match @path patterns
	// Must be at start or preceded by whitespace
	// Path continues until whitespace or end of string
	// Path must contain at least one character after @
	const atPathRegex = /(?:^|\s)@([^\s@]+)/g

	const matches: Array<{ fullMatch: string; path: string; index: number }> = []
	let match: RegExpExecArray | null

	while ((match = atPathRegex.exec(message)) !== null) {
		const fullMatch = match[0]
		const pathPart = match[1]

		// Skip if path is empty or just whitespace
		if (!pathPart || !pathPart.trim()) {
			continue
		}

		matches.push({
			fullMatch,
			path: pathPart,
			index: match.index,
		})
	}

	// Process matches in reverse order so we can safely remove them from the message
	let cleanedMessage = message
	for (let i = matches.length - 1; i >= 0; i--) {
		const { fullMatch, path: pathPart } = matches[i]

		// Resolve the path
		let absolutePath: string
		if (path.isAbsolute(pathPart)) {
			absolutePath = pathPart
		} else {
			absolutePath = path.resolve(cwd, pathPart)
		}

		// Check if file exists
		if (!fs.existsSync(absolutePath)) {
			warnings.push(`File not found: ${pathPart}`)
			continue
		}

		// Check if it's a directory
		if (fs.statSync(absolutePath).isDirectory()) {
			warnings.push(`Cannot attach directory: ${pathPart}`)
			continue
		}

		// Determine if it's an image or regular file
		if (isImageFile(absolutePath)) {
			try {
				const dataUrl = fileToBase64DataUrl(absolutePath)
				images.push(dataUrl)
				// Remove the @path from the message (preserve leading whitespace if present)
				const hasLeadingSpace = fullMatch.startsWith(" ") || fullMatch.startsWith("\t")
				cleanedMessage = cleanedMessage.replace(fullMatch, hasLeadingSpace ? " " : "")
			} catch (error) {
				warnings.push(`Failed to read image: ${pathPart} - ${(error as Error).message}`)
			}
		} else {
			files.push(absolutePath)
			// Remove the @path from the message (preserve leading whitespace if present)
			const hasLeadingSpace = fullMatch.startsWith(" ") || fullMatch.startsWith("\t")
			cleanedMessage = cleanedMessage.replace(fullMatch, hasLeadingSpace ? " " : "")
		}
	}

	// Clean up multiple spaces that may have been left
	cleanedMessage = cleanedMessage.replace(/\s+/g, " ").trim()

	return {
		cleanedMessage,
		files,
		images,
		warnings,
	}
}

/**
 * Process explicit file paths from CLI options
 *
 * Unlike parseAtPaths, this throws errors for missing files (strict mode)
 *
 * @param filePaths - Array of file paths from CLI options
 * @param cwd - Current working directory for resolving relative paths
 * @returns Object with files (paths) and images (base64 data URLs)
 * @throws Error if any file doesn't exist
 */
export function processExplicitFiles(
	filePaths: string[],
	cwd: string,
): {
	files: string[]
	images: string[]
} {
	const files: string[] = []
	const images: string[] = []

	for (const filePath of filePaths) {
		// Resolve the path
		let absolutePath: string
		if (path.isAbsolute(filePath)) {
			absolutePath = filePath
		} else {
			absolutePath = path.resolve(cwd, filePath)
		}

		// Check if file exists (strict - throw error)
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`File not found: ${filePath}`)
		}

		// Check if it's a directory
		if (fs.statSync(absolutePath).isDirectory()) {
			throw new Error(`Cannot attach directory: ${filePath}`)
		}

		// Determine if it's an image or regular file
		if (isImageFile(absolutePath)) {
			const dataUrl = fileToBase64DataUrl(absolutePath)
			images.push(dataUrl)
		} else {
			files.push(absolutePath)
		}
	}

	return { files, images }
}

/**
 * Process explicit image paths from CLI options
 *
 * @param imagePaths - Array of image paths from CLI options
 * @param cwd - Current working directory for resolving relative paths
 * @returns Array of base64 data URLs
 * @throws Error if any file doesn't exist or isn't a valid image
 */
export function processExplicitImages(imagePaths: string[], cwd: string): string[] {
	const images: string[] = []

	for (const imagePath of imagePaths) {
		// Resolve the path
		let absolutePath: string
		if (path.isAbsolute(imagePath)) {
			absolutePath = imagePath
		} else {
			absolutePath = path.resolve(cwd, imagePath)
		}

		// Check if file exists (strict - throw error)
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`Image file not found: ${imagePath}`)
		}

		// Check if it's actually an image
		if (!isImageFile(absolutePath)) {
			throw new Error(
				`Not a supported image format: ${imagePath}. Supported formats: ${Array.from(IMAGE_EXTENSIONS).join(", ")}`,
			)
		}

		const dataUrl = fileToBase64DataUrl(absolutePath)
		images.push(dataUrl)
	}

	return images
}
