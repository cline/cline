import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import { estimateContentSize, estimateFileSize, wouldExceedSizeLimit, getMaxAllowedSize } from "../../utils/content-size"
import { ContentTooLargeError } from "../../shared/errors"

/**
 * Checks if terminal output would exceed size limits and returns the content if safe
 * @param content The terminal output content to check
 * @param contextWindow Context window limit in tokens
 * @param command The command that generated this output (for error reporting)
 * @returns The validated content
 * @throws ContentTooLargeError if content exceeds size limit
 */
export async function extractTextFromTerminal(content: string | Buffer, contextWindow: number, command: string): Promise<string> {
	console.debug(`[TERMINAL_SIZE_CHECK] Checking size for command output: ${command}`)

	// Convert to string but don't trim yet
	const rawContent = content.toString()
	console.debug(`[TERMINAL_SIZE_CHECK] Raw content length: ${rawContent.length}`)

	// Check size before trimming
	const sizeEstimate = estimateContentSize(rawContent, contextWindow)
	console.debug(`[TERMINAL_SIZE_CHECK] Content size: ${sizeEstimate.bytes} bytes`)
	console.debug(`[TERMINAL_SIZE_CHECK] Estimated tokens: ${sizeEstimate.estimatedTokens}`)
	console.debug(`[TERMINAL_SIZE_CHECK] Context window: ${contextWindow}`)

	if (sizeEstimate.wouldExceedLimit) {
		console.debug(`[TERMINAL_SIZE_CHECK] Output exceeds size limit`)
		throw new ContentTooLargeError({
			type: "terminal",
			command,
			size: sizeEstimate,
		})
	}

	// Only trim after size check passes
	const cleanContent = rawContent.trim()
	console.debug(`[TERMINAL_SIZE_CHECK] Clean content length: ${cleanContent.length}`)
	console.debug(`[TERMINAL_SIZE_CHECK] Size check passed`)
	return cleanContent
}

export async function extractTextFromFile(
	filePath: string,
	contextWindow: number = 64_000 /* minimum context (Deepseek) */,
): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	console.debug(`[FILE_READ_CHECK] Checking size for file: ${filePath}`)

	// Get file stats to check size
	const stats = await fs.stat(filePath)
	console.debug(`[FILE_SIZE_CHECK] File size: ${stats.size} bytes`)

	// Calculate max allowed size from context window
	const maxAllowedSize = getMaxAllowedSize(contextWindow)
	console.debug(`[FILE_SIZE_CHECK] Max allowed size: ${maxAllowedSize} tokens`)

	// Check if file size would exceed limit before attempting to read
	// This is more efficient than creating a full SizeEstimate object when we just need a boolean check
	if (wouldExceedSizeLimit(stats.size, contextWindow)) {
		console.debug(`[FILE_SIZE_CHECK] File exceeds size limit`)
		// Only create the full size estimate when we need it for the error
		const sizeEstimate = await estimateFileSize(filePath, maxAllowedSize)
		throw new ContentTooLargeError({
			type: "file",
			path: filePath,
			size: sizeEstimate,
		})
	}
	console.debug(`[FILE_SIZE_CHECK] File size check passed`)
	const fileExtension = path.extname(filePath).toLowerCase()
	console.debug(`[FILE_READ] Reading file: ${filePath}`)
	let content: string
	switch (fileExtension) {
		case ".pdf":
			content = await extractTextFromPDF(filePath)
			break
		case ".docx":
			content = await extractTextFromDOCX(filePath)
			break
		case ".ipynb":
			content = await extractTextFromIPYNB(filePath)
			break
		default:
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				content = await fs.readFile(filePath, "utf8")
			} else {
				throw new Error(`Cannot read text for file type: ${fileExtension}`)
			}
	}
	console.debug(`[FILE_READ_COMPLETE] File read complete. Content length: ${content.length} chars`)
	return content
}

async function extractTextFromPDF(filePath: string): Promise<string> {
	const dataBuffer = await fs.readFile(filePath)
	const data = await pdf(dataBuffer)
	return data.text
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
	const result = await mammoth.extractRawText({ path: filePath })
	return result.value
}

async function extractTextFromIPYNB(filePath: string): Promise<string> {
	const data = await fs.readFile(filePath, "utf8")
	const notebook = JSON.parse(data)
	let extractedText = ""

	for (const cell of notebook.cells) {
		if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
			extractedText += cell.source.join("\n") + "\n"
		}
	}

	return extractedText
}
