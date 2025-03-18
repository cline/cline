import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import * as vscode from "vscode"
import { isBinaryFile } from "isbinaryfile"
const decoder = new TextDecoder("utf-8")
export async function extractTextFromFile(filePath: string | vscode.Uri): Promise<string> {
	filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	let fileSizeInKB = 0
	try {
		fileSizeInKB = (await vscode.workspace.fs.stat(filePath)).size / 1000
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}
	const fileExtension = path.extname(filePath.fsPath).toLowerCase()
	switch (fileExtension) {
		case ".pdf":
			return extractTextFromPDF(filePath)
		case ".docx":
			return extractTextFromDOCX(filePath)
		case ".ipynb":
			return extractTextFromIPYNB(filePath)
		default:
			if (fileSizeInKB > 300) {
				throw new Error(`File is too large to read into context.`)
			}
			const buffer = Buffer.from(await vscode.workspace.fs.readFile(filePath))
			const isBinary = await isBinaryFile(buffer).catch(() => false)
			if (!isBinary) {
				return decoder.decode(buffer)
			} else {
				throw new Error(`Cannot read text for file type: ${fileExtension}`)
			}
	}
}

async function extractTextFromPDF(filePath: string | vscode.Uri): Promise<string> {
	filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	const dataBuffer = await vscode.workspace.fs.readFile(filePath)
	const data = await pdf(dataBuffer)
	return data.text
}

async function extractTextFromDOCX(filePath: string | vscode.Uri): Promise<string> {
	filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	const dataBuffer = await vscode.workspace.fs.readFile(filePath)
	const result = await mammoth.extractRawText({ arrayBuffer: dataBuffer })
	return result.value
}

async function extractTextFromIPYNB(filePath: string | vscode.Uri): Promise<string> {
	filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	const data = decoder.decode(await vscode.workspace.fs.readFile(filePath))
	const notebook = JSON.parse(data)
	let extractedText = ""

	for (const cell of notebook.cells) {
		if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
			extractedText += cell.source.join("\n") + "\n"
		}
	}

	return extractedText
}
