import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
/**
 * 给定的文件路径中提取文本内容。函数首先尝试访问文件，如果文件不存在则抛出错误。
 * 接着获取文件扩展名，根据不同的扩展名调用不同的函数来提取文本内容，
 * 如对于.pdf 文件调用 extractTextFromPDF 函数，
 * 对于.docx 文件调用 extractTextFromDOCX 函数等。
 * 如果文件扩展名不在特定的几种类型中，会判断文件是否为二进制文件，
 * 如果不是二进制文件，则使用 fs.readFile 读取文件内容并以 utf8 编码返回文本，
 * 否则抛出错误表示无法读取该文件类型的文本内容。
 * @param filePath 文件路径
 * @returns
 */
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
