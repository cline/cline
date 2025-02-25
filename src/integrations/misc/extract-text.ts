import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import { estimateFileSize, wouldExceedSizeLimit } from "../../utils/content-size"
import { ContentTooLargeError } from "../../shared/errors"

export async function extractTextFromFile(filePath: string, contextLimit: number, usedContext: number = 0): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	// Get file stats to check size
	const stats = await fs.stat(filePath)

	// Check if file size would exceed limit before attempting to read
	// This is more efficient than creating a full SizeEstimate object when we just need a boolean check
	if (wouldExceedSizeLimit(stats.size, contextLimit)) {
		// Only create the full size estimate when we need it for the error
		const sizeEstimate = await estimateFileSize(filePath, contextLimit, usedContext)
		throw new ContentTooLargeError({
			type: "file",
			path: filePath,
			size: sizeEstimate,
		})
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	switch (fileExtension) {
		case ".pdf":
			return extractTextFromPDF(filePath)
		case ".docx":
			return extractTextFromDOCX(filePath)
		case ".ipynb":
			return extractTextFromIPYNB(filePath)
		default:
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				return await fs.readFile(filePath, "utf8")
			} else {
				throw new Error(`Cannot read text for file type: ${fileExtension}`)
			}
	}
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
