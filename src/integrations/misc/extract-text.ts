import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import { readFileWithSizeCheck, readNextChunk } from "../../utils/large-file"

export async function extractTextFromFile(filePath: string, enableLargeFileCheck: boolean = false, largeFileCheckMaxSize: number = Number.MAX_VALUE, largeFileCheckChunkSize: number = Number.MAX_VALUE): Promise<string> {
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
                if (enableLargeFileCheck) {
                    const result = await readFileWithSizeCheck(filePath, largeFileCheckMaxSize, largeFileCheckChunkSize)
                    if (result.isPartial) {
                        return `${result.content}\n\n[Note: This is a partial content (${(result.loadedSize / 1024).toFixed(1)}KB of ${(result.totalSize / 1024).toFixed(1)}KB). The file is large, so only the first part is shown. To read more, use the read_next_chunk tool with offset ${result.loadedSize}.]`
                    }
                    return result.content
                }
                return await fs.readFile(filePath, "utf8")
            } else {
                throw new Error(`Cannot read text for file type: ${fileExtension}`)
            }
    }
}

export async function extractNextChunk(filePath: string, offset: number, largeFileCheckMaxSize: number, largeFileCheckChunkSize: number): Promise<string> {
    try {
        await fs.access(filePath)
    } catch (error) {
        throw new Error(`File not found: ${filePath}`)
    }

    const result = await readNextChunk(filePath, offset, largeFileCheckMaxSize, largeFileCheckChunkSize)
    if (result.isPartial) {
        return `${result.content}\n\n[Note: This is a partial content (${(result.loadedSize / 1024).toFixed(1)}KB of ${(result.totalSize / 1024).toFixed(1)}KB). To read more, use the read_next_chunk tool with offset ${result.loadedSize}.]`
    }
    return result.content
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
