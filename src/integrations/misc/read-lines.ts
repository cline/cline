/**
 * credits @BorisChumichev
 *
 * https://github.com/BorisChumichev/node-nthline
 *
 * This module extend functionality of reading lines from a file
 * Now you can read a range of lines from a file
 */
import { createReadStream } from "fs"
import { createInterface } from "readline"

const outOfRangeError = (filepath: string, n: number) => {
	return new RangeError(`Line with index ${n} does not exist in '${filepath}'. Note that line indexing is zero-based`)
}

/**
 * Reads a range of lines from a file.
 *
 * @param filepath - Path to the file to read
 * @param endLine - Optional. The line number to stop reading at (inclusive). If undefined, reads to the end of file.
 * @param startLine - Optional. The line number to start reading from (inclusive). If undefined, starts from line 0.
 * @returns Promise resolving to a string containing the read lines joined with newlines
 * @throws {RangeError} If line numbers are invalid or out of range
 */
export function readLines(filepath: string, endLine?: number, startLine?: number): Promise<string> {
	return new Promise((resolve, reject) => {
		// Validate input parameters
		// Check startLine validity if provided
		if (startLine !== undefined && (startLine < 0 || startLine % 1 !== 0)) {
			return reject(
				new RangeError(`Invalid startLine: ${startLine}. Line numbers must be non-negative integers.`),
			)
		}

		// Check endLine validity if provided
		if (endLine !== undefined && (endLine < 0 || endLine % 1 !== 0)) {
			return reject(new RangeError(`Invalid endLine: ${endLine}. Line numbers must be non-negative integers.`))
		}

		const effectiveStartLine = startLine === undefined ? 0 : startLine

		// Check startLine and endLine relationship
		if (endLine !== undefined && effectiveStartLine > endLine) {
			return reject(
				new RangeError(`startLine (${effectiveStartLine}) must be less than or equal to endLine (${endLine})`),
			)
		}

		let cursor = 0
		const lines: string[] = []
		const input = createReadStream(filepath)
		const rl = createInterface({ input })

		rl.on("line", (line) => {
			// Only collect lines within the specified range
			if (cursor >= effectiveStartLine && (endLine === undefined || cursor <= endLine)) {
				lines.push(line)
			}

			// Close stream after reaching to_line (if specified)
			if (endLine !== undefined && cursor === endLine) {
				rl.close()
				input.close()
				resolve(lines.join("\n"))
			}

			cursor++
		})

		rl.on("error", reject)

		input.on("end", () => {
			// If we collected some lines but didn't reach to_line, return what we have
			if (lines.length > 0) {
				resolve(lines.join("\n"))
			} else {
				reject(outOfRangeError(filepath, effectiveStartLine))
			}
		})
	})
}
