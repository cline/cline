import * as path from "path"
import pdf from "pdf-parse"
import mammoth from "mammoth"
import { isBinaryFile } from "isbinaryfile"
import fs from "fs/promises"

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
		default:
			const isBinary = await isBinaryFile(filePath)
			if (!isBinary) {
				return await fs.readFile(filePath, "utf8")
			} else {
				throw new Error(`Unsupported file type: ${fileExtension}`)
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
