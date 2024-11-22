import fs from "fs/promises"
import { stat } from "fs/promises"



export interface LargeFileResult {
    content: string
    isPartial: boolean
    totalSize: number
    loadedSize: number
}

export async function readFileWithSizeCheck(filePath: string, maxFileSize: number, chunkSize: number): Promise<LargeFileResult> {
    const MAX_FILE_SIZE = maxFileSize * 1024
    const CHUNK_SIZE = chunkSize * 10

    const stats = await stat(filePath)
    const fileSize = stats.size

    if (fileSize <= MAX_FILE_SIZE) {
        // If file is small enough, read it entirely
        const content = await fs.readFile(filePath, "utf8")
        return {
            content,
            isPartial: false,
            totalSize: fileSize,
            loadedSize: fileSize
        }
    }

    // If file is too large, read only the first chunk
    const fileHandle = await fs.open(filePath, "r")
    const buffer = Buffer.alloc(CHUNK_SIZE)
    
    try {
        const { bytesRead } = await fileHandle.read(buffer, 0, CHUNK_SIZE, 0)
        const content = buffer.toString("utf8", 0, bytesRead)
        
        return {
            content,
            isPartial: true,
            totalSize: fileSize,
            loadedSize: bytesRead
        }
    } finally {
        await fileHandle.close()
    }
}

export async function readNextChunk(filePath: string, offset: number, maxFileSize: number, chunkSize: number): Promise<LargeFileResult> {
    const MAX_FILE_SIZE = maxFileSize * 1024
    const CHUNK_SIZE = chunkSize * 10

    const stats = await stat(filePath)
    const fileSize = stats.size
    
    const fileHandle = await fs.open(filePath, "r")
    const buffer = Buffer.alloc(CHUNK_SIZE)
    
    try {
        const { bytesRead } = await fileHandle.read(buffer, 0, CHUNK_SIZE, offset)
        const content = buffer.toString("utf8", 0, bytesRead)
        
        return {
            content,
            isPartial: offset + bytesRead < fileSize,
            totalSize: fileSize,
            loadedSize: offset + bytesRead
        }
    } finally {
        await fileHandle.close()
    }
}
