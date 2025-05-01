import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import * as chardet from "jschardet"
import * as iconv from "iconv-lite"

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
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
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
			const fileBuffer = await fs.readFile(filePath)
			if (fileBuffer.byteLength > 300 * 1024) {
				throw new Error(`File is too large to read into context.`)
			}
			const encoding = await detectEncoding(fileBuffer, fileExtension)
			return iconv.decode(fileBuffer, encoding)
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
	const fileBuffer = await fs.readFile(filePath)
	const encoding = await detectEncoding(fileBuffer)
	const data = iconv.decode(fileBuffer, encoding)
	const notebook = JSON.parse(data)
	let extractedText = ""

	for (const cell of notebook.cells) {
		if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
			extractedText += cell.source.join("\n") + "\n"
		}
	}

	return extractedText
}
