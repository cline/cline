import ExcelJS from "exceljs"
import fs from "fs/promises"
import * as iconv from "iconv-lite"
import { isBinaryFile } from "isbinaryfile"
import * as chardet from "jschardet"
import mammoth from "mammoth"
import * as path from "path"
// @ts-expect-error-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"
import { sanitizeNotebookForLLM } from "./notebook-utils"

export async function detectEncoding(fileBuffer: Buffer, fileExtension?: string): Promise<string> {
	const detected = chardet.detect(fileBuffer)
	if (typeof detected === "string") {
		return detected
	} else if (detected && (detected as any).encoding) {
		return (detected as any).encoding
	} else {
		if (fileExtension) {
			const isBinary = await isBinaryFile(fileBuffer).catch(() => false)
			if (isBinary) {
				throw new Error(`Cannot read text for file type: ${fileExtension}`)
			}
		}
		return "utf8"
	}
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
export async function callTextExtractionFunctions(filePath: string): Promise<string> {
	const fileExtension = path.extname(filePath).toLowerCase()

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
		case ".xlsx":
			content = await extractTextFromExcel(filePath)
			break
		default:
			// Check file size with stat() first - faster than reading entire file for size check
			const fileStat = await fs.stat(filePath)
			if (fileStat.size > 20 * 1000 * 1024) {
				// 20MB limit (20 * 1000 * 1024 bytes, decimal MB)
				throw new Error(`File is too large to read into context.`)
			}
			const fileBuffer = await fs.readFile(filePath)
			const encoding = await detectEncoding(fileBuffer, fileExtension)
			content = iconv.decode(fileBuffer, encoding)
	}

	// Truncate content if it exceeds 400KB to prevent context overflow
	return truncateContent(content)
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
	const fileBuffer = await fs.readFile(filePath)
	const encoding = await detectEncoding(fileBuffer)
	const data = iconv.decode(fileBuffer, encoding)

	// Strip all outputs to reduce context size - outputs aren't needed for understanding
	// notebook structure. For Jupyter commands, the specific cell's outputs are included
	// separately via sanitizeCellForLLM which preserves text outputs.
	return sanitizeNotebookForLLM(data, true)
}

/**
 * Format the data inside Excel cells
 */
function formatCellValue(cell: ExcelJS.Cell): string {
	const value = cell.value
	if (value === null || value === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	// Handle dates - ExcelJS can parse them as Date objects
	if (value instanceof Date) {
		return value.toISOString().split("T")[0] // Just the date part
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	// Handle formulas - get the calculated result
	if (typeof value === "object" && "formula" in value) {
		if ("result" in value && value.result !== undefined && value.result !== null) {
			return value.result.toString()
		} else {
			return `[Formula: ${value.formula}]`
		}
	}

	return value.toString()
}

/**
 * Extract and format text from xlsx files
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	const workbook = new ExcelJS.Workbook()
	let excelText = ""

	try {
		await workbook.xlsx.readFile(filePath)

		workbook.eachSheet((worksheet, _sheetId) => {
			// Skip hidden sheets
			if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
				return
			}

			excelText += `--- Sheet: ${worksheet.name} ---\n`

			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				// Optional: limit processing for very large sheets
				if (rowNumber > 50000) {
					excelText += `[... truncated at row ${rowNumber} ...]\n`
					return false
				}

				const rowTexts: string[] = []
				let hasContent = false

				row.eachCell({ includeEmpty: true }, (cell, _colNumber) => {
					const cellText = formatCellValue(cell)
					if (cellText.trim()) {
						hasContent = true
					}
					rowTexts.push(cellText)
				})

				// Only add rows with actual content
				if (hasContent) {
					excelText += rowTexts.join("\t") + "\n"
				}

				return true
			})

			excelText += "\n" // Blank line between sheets
		})

		return excelText.trim()
	} catch (error: any) {
		Logger.error(`Error extracting text from Excel ${filePath}:`, error)
		throw new Error(`Failed to extract text from Excel: ${error.message}`)
	}
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
