import { createReadStream } from "fs"
import * as fs from "fs/promises"
import { countFileLines } from "./line-counter"

/**
 * Result of a partial file read operation
 */
export interface PartialReadResult {
	content: string
	charactersRead: number
	totalCharacters: number // from file stats
	linesRead: number
	totalLines: number // from line counter
	lastLineRead: number // which line we stopped at
}

/**
 * Reads partial content from a file up to a specified character limit.
 * Works for both single-line and multi-line files, tracking line numbers.
 * Uses streaming to avoid loading the entire file into memory for very large files.
 *
 * @param filePath - Path to the file to read
 * @param maxChars - Maximum number of characters to read
 * @returns Promise resolving to the partial read result with metadata
 */
export async function readPartialContent(filePath: string, maxChars: number): Promise<PartialReadResult> {
	// Get file stats and line count
	const [stats, totalLines] = await Promise.all([fs.stat(filePath), countFileLines(filePath)])

	const totalCharacters = stats.size

	// Handle edge cases
	if (maxChars <= 0 || totalCharacters === 0) {
		return {
			content: "",
			charactersRead: 0,
			totalCharacters,
			linesRead: 0,
			totalLines,
			lastLineRead: 0,
		}
	}

	return new Promise((resolve, reject) => {
		// Use smaller chunks and set end position to limit reading
		const stream = createReadStream(filePath, {
			encoding: "utf8",
			highWaterMark: 16 * 1024, // Smaller 16KB chunks for better control
			start: 0,
			end: Math.max(0, Math.min(maxChars * 2, maxChars + 1024 * 1024)), // Read at most 2x maxChars or maxChars + 1MB buffer
		})

		let content = ""
		let totalRead = 0
		let currentLine = 1
		let streamDestroyed = false
		let hasContent = false

		stream.on("data", (chunk: string | Buffer) => {
			// Early exit if stream was already destroyed
			if (streamDestroyed) {
				return
			}

			try {
				const chunkStr = typeof chunk === "string" ? chunk : chunk.toString("utf8")
				const remainingChars = maxChars - totalRead

				if (remainingChars <= 0) {
					streamDestroyed = true
					stream.destroy()
					resolve({
						content,
						charactersRead: totalRead,
						totalCharacters,
						linesRead: hasContent ? currentLine : 0,
						totalLines,
						lastLineRead: hasContent ? currentLine : 0,
					})
					return
				}

				let chunkToAdd: string
				if (chunkStr.length <= remainingChars) {
					chunkToAdd = chunkStr
					totalRead += chunkStr.length
				} else {
					chunkToAdd = chunkStr.substring(0, remainingChars)
					totalRead += remainingChars
				}

				// Mark that we have content
				if (chunkToAdd.length > 0) {
					hasContent = true
				}

				// Count newlines in the chunk we're adding
				for (let i = 0; i < chunkToAdd.length; i++) {
					if (chunkToAdd[i] === "\n") {
						currentLine++
					}
				}

				content += chunkToAdd

				// Check if we've reached the character limit
				if (totalRead >= maxChars) {
					streamDestroyed = true
					stream.destroy()

					// Ensure we don't exceed maxChars
					if (content.length > maxChars) {
						content = content.substring(0, maxChars)
						// Recount lines in the final content
						currentLine = 1
						hasContent = content.length > 0
						for (let i = 0; i < content.length; i++) {
							if (content[i] === "\n") {
								currentLine++
							}
						}
					}

					resolve({
						content,
						charactersRead: Math.min(totalRead, maxChars),
						totalCharacters,
						linesRead: hasContent ? currentLine : 0,
						totalLines,
						lastLineRead: hasContent ? currentLine : 0,
					})
				}
			} catch (error) {
				streamDestroyed = true
				stream.destroy()
				reject(error)
			}
		})

		stream.on("end", () => {
			resolve({
				content,
				charactersRead: totalRead,
				totalCharacters,
				linesRead: hasContent ? currentLine : 0,
				totalLines,
				lastLineRead: hasContent ? currentLine : 0,
			})
		})

		stream.on("error", (error: Error) => {
			reject(error)
		})
	})
}

/**
 * Legacy function for backward compatibility.
 * @deprecated Use readPartialContent instead
 */
export async function readPartialSingleLineContent(filePath: string, maxChars: number): Promise<string> {
	const result = await readPartialContent(filePath, maxChars)
	return result.content
}
