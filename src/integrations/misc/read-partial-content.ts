import { createReadStream } from "fs"

/**
 * Reads partial content from a single-line file up to a specified character limit.
 * Uses streaming to avoid loading the entire file into memory for very large files.
 *
 * @param filePath - Path to the file to read
 * @param maxChars - Maximum number of characters to read
 * @returns Promise resolving to the partial content as a string
 */
export function readPartialSingleLineContent(filePath: string, maxChars: number): Promise<string> {
	return new Promise((resolve, reject) => {
		// Use smaller chunks and set end position to limit reading
		const stream = createReadStream(filePath, {
			encoding: "utf8",
			highWaterMark: 16 * 1024, // Smaller 16KB chunks for better control
			start: 0,
			end: Math.min(maxChars * 2, maxChars + 1024 * 1024), // Read at most 2x maxChars or maxChars + 1MB buffer
		})
		let content = ""
		let totalRead = 0
		let streamDestroyed = false

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
					resolve(content)
					return
				}

				if (chunkStr.length <= remainingChars) {
					content += chunkStr
					totalRead += chunkStr.length
				} else {
					const truncated = chunkStr.substring(0, remainingChars)
					content += truncated
					totalRead += remainingChars
					streamDestroyed = true
					stream.destroy()
					resolve(content)
				}

				// Safety check - if we somehow exceed the limit, stop immediately
				if (totalRead >= maxChars) {
					streamDestroyed = true
					stream.destroy()
					resolve(content.substring(0, maxChars))
				}
			} catch (error) {
				streamDestroyed = true
				stream.destroy()
				reject(error)
			}
		})

		stream.on("end", () => {
			resolve(content)
		})

		stream.on("error", (error: Error) => {
			reject(error)
		})
	})
}
