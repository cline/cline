import fs from "fs/promises"
import * as iconv from "iconv-lite"
import { isBinaryFile } from "isbinaryfile"
import * as chardet from "jschardet"
import * as path from "path"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"

export async function detectEncoding(fileBuffer: Buffer, fileExtension?: string): Promise<string> {
	const detected = chardet.detect(fileBuffer)
	if (typeof detected === "string") {
		return detected
	}
	if (detected && (detected as any).encoding) {
		return (detected as any).encoding
	}
	if (fileExtension) {
		const isBinary = await isBinaryFile(fileBuffer).catch(() => false)
		if (isBinary) {
			throw new Error(`Cannot read text for file type: ${fileExtension}`)
		}
	}
	return "utf8"
}

export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (_error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return callTextExtractionFunctions(filePath)
}

/**
 * Expects the fs.access call to have already been performed prior to calling.
 * Content is automatically truncated if it exceeds 400KB to prevent context overflow.
 */
async function callTextExtractionFunctions(filePath: string): Promise<string> {
	const fileExtension = path.extname(filePath).toLowerCase()

	let content: string

	// Plain text and source files are the supported attachment boundary.
	const fileStat = await fs.stat(filePath)
	if (fileStat.size > 20 * 1000 * 1024) {
		throw new Error(`File is too large to read into context.`)
	}
	const fileBuffer = await fs.readFile(filePath)
	const encoding = await detectEncoding(fileBuffer, fileExtension)
	content = iconv.decode(fileBuffer, encoding)

	// Truncate content if it exceeds 400KB to prevent context overflow
	return truncateContent(content)
}

/**
 * Helper function used to load file(s) and format them into a string
 */
export async function processFilesIntoText(files: string[]): Promise<string> {
	const fileContentsPromises = files.map(async (filePath) => {
		try {
			// Check if file exists and is binary
			//const isBinary = await isBinaryFile(filePath).catch(() => false)
			//if (isBinary) {
			//	return `<file_content path="${filePath.toPosix()}">\n(Binary file, unable to display content)\n</file_content>`
			//}
			const content = await extractTextFromFile(filePath)
			return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
		} catch (error) {
			Logger.error(`Error processing file ${filePath}:`, error)
			return `<file_content path="${filePath.toPosix()}">\nError fetching content: ${error.message}\n</file_content>`
		}
	})

	const fileContents = await Promise.all(fileContentsPromises)

	const validFileContents = fileContents.filter((content) => content !== null).join("\n\n")

	if (validFileContents) {
		return `Files attached by the user:\n\n${validFileContents}`
	}

	// returns empty string if no files were loaded properly
	return ""
}
