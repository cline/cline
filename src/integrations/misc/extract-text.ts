import * as path from "path"
// @ts-ignore-next-line
import pdf from "pdf-parse/lib/pdf-parse"
import mammoth from "mammoth"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"

async function extractTextFromPDF(filePath: string): Promise<string> {
	const dataBuffer = await fs.readFile(filePath)
	const data = await pdf(dataBuffer)
	return addLineNumbers(data.text)
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
	const result = await mammoth.extractRawText({ path: filePath })
	return addLineNumbers(result.value)
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

	return addLineNumbers(extractedText)
}

/**
 * Map of supported binary file formats to their extraction functions
 */
const SUPPORTED_BINARY_FORMATS = {
	".pdf": extractTextFromPDF,
	".docx": extractTextFromDOCX,
	".ipynb": extractTextFromIPYNB,
} as const

/**
 * Returns the list of supported binary file formats that can be processed by extractTextFromFile
 */
export function getSupportedBinaryFormats(): string[] {
	return Object.keys(SUPPORTED_BINARY_FORMATS)
}

export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(`File not found: ${filePath}`)
	}

	const fileExtension = path.extname(filePath).toLowerCase()

	// Check if we have a specific extractor for this format
	const extractor = SUPPORTED_BINARY_FORMATS[fileExtension as keyof typeof SUPPORTED_BINARY_FORMATS]
	if (extractor) {
		return extractor(filePath)
	}

	// Handle other files
	const isBinary = await isBinaryFile(filePath).catch(() => false)

	if (!isBinary) {
		return addLineNumbers(await fs.readFile(filePath, "utf8"))
	} else {
		throw new Error(`Cannot read text for file type: ${fileExtension}`)
	}
}

export function addLineNumbers(content: string, startLine: number = 1): string {
	// If content is empty, return empty string - empty files should not have line numbers
	// If content is empty but startLine > 1, return "startLine | " because we know the file is not empty
	// but the content is empty at that line offset
	if (content === "") {
		return startLine === 1 ? "" : `${startLine} | \n`
	}

	// Split into lines and handle trailing line feeds (\n)
	const lines = content.split("\n")
	const lastLineEmpty = lines[lines.length - 1] === ""
	if (lastLineEmpty) {
		lines.pop()
	}

	const maxLineNumberWidth = String(startLine + lines.length - 1).length
	const numberedContent = lines
		.map((line, index) => {
			const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, " ")
			return `${lineNumber} | ${line}`
		})
		.join("\n")

	return numberedContent + "\n"
}
// Checks if every line in the content has line numbers prefixed (e.g., "1 | content" or "123 | content")
// Line numbers must be followed by a single pipe character (not double pipes)
export function everyLineHasLineNumbers(content: string): boolean {
	const lines = content.split(/\r?\n/) // Handles both CRLF (carriage return (\r) + line feed (\n)) and LF (line feed (\n)) line endings
	return lines.length > 0 && lines.every((line) => /^\s*\d+\s+\|(?!\|)/.test(line))
}

/**
 * Strips line numbers from content while preserving the actual content.
 *
 * @param content The content to process
 * @param aggressive When false (default): Only strips lines with clear number patterns like "123 | content"
 *                   When true: Uses a more lenient pattern that also matches lines with just a pipe character,
 *                   which can be useful when LLMs don't perfectly format the line numbers in diffs
 * @returns The content with line numbers removed
 */
export function stripLineNumbers(content: string, aggressive: boolean = false): string {
	// Split into lines to handle each line individually
	const lines = content.split(/\r?\n/)

	// Process each line
	const processedLines = lines.map((line) => {
		// Match line number pattern and capture everything after the pipe
		const match = aggressive ? line.match(/^\s*(?:\d+\s)?\|\s(.*)$/) : line.match(/^\s*\d+\s+\|(?!\|)\s?(.*)$/)
		return match ? match[1] : line
	})

	// Join back with original line endings (carriage return (\r) + line feed (\n) or just line feed (\n))
	const lineEnding = content.includes("\r\n") ? "\r\n" : "\n"
	return processedLines.join(lineEnding)
}

/**
 * Truncates multi-line output while preserving context from both the beginning and end.
 * When truncation is needed, it keeps 20% of the lines from the start and 80% from the end,
 * with a clear indicator of how many lines were omitted in between.
 *
 * @param content The multi-line string to truncate
 * @param lineLimit Optional maximum number of lines to keep. If not provided or 0, returns the original content
 * @returns The truncated string with an indicator of omitted lines, or the original content if no truncation needed
 *
 * @example
 * // With 10 line limit on 25 lines of content:
 * // - Keeps first 2 lines (20% of 10)
 * // - Keeps last 8 lines (80% of 10)
 * // - Adds "[...15 lines omitted...]" in between
 */
export function truncateOutput(content: string, lineLimit?: number): string {
	if (!lineLimit) {
		return content
	}

	// Count total lines
	let totalLines = 0
	let pos = -1
	while ((pos = content.indexOf("\n", pos + 1)) !== -1) {
		totalLines++
	}
	totalLines++ // Account for last line without line feed (\n)

	if (totalLines <= lineLimit) {
		return content
	}

	const beforeLimit = Math.floor(lineLimit * 0.2) // 20% of lines before
	const afterLimit = lineLimit - beforeLimit // remaining 80% after

	// Find start section end position
	let startEndPos = -1
	let lineCount = 0
	pos = 0
	while (lineCount < beforeLimit && (pos = content.indexOf("\n", pos)) !== -1) {
		startEndPos = pos
		lineCount++
		pos++
	}

	// Find end section start position
	let endStartPos = content.length
	lineCount = 0
	pos = content.length
	while (lineCount < afterLimit && (pos = content.lastIndexOf("\n", pos - 1)) !== -1) {
		endStartPos = pos + 1 // Start after the line feed (\n)
		lineCount++
	}

	const omittedLines = totalLines - lineLimit
	const startSection = content.slice(0, startEndPos + 1)
	const endSection = content.slice(endStartPos)
	return startSection + `\n[...${omittedLines} lines omitted...]\n\n` + endSection
}

/**
 * Applies run-length encoding to compress repeated lines in text.
 * Only compresses when the compression description is shorter than the repeated content.
 *
 * @param content The text content to compress
 * @returns The compressed text with run-length encoding applied
 */
export function applyRunLengthEncoding(content: string): string {
	if (!content) {
		return content
	}

	let result = ""
	let pos = 0
	let repeatCount = 0
	let prevLine = null

	while (pos < content.length) {
		const nextNewlineIdx = content.indexOf("\n", pos) // Find next line feed (\n) index
		const currentLine = nextNewlineIdx === -1 ? content.slice(pos) : content.slice(pos, nextNewlineIdx + 1)

		if (prevLine === null) {
			prevLine = currentLine
		} else if (currentLine === prevLine) {
			repeatCount++
		} else {
			if (repeatCount > 0) {
				const compressionDesc = `<previous line repeated ${repeatCount} additional times>\n`
				if (compressionDesc.length < prevLine.length * (repeatCount + 1)) {
					result += prevLine + compressionDesc
				} else {
					for (let i = 0; i <= repeatCount; i++) {
						result += prevLine
					}
				}
				repeatCount = 0
			} else {
				result += prevLine
			}
			prevLine = currentLine
		}

		pos = nextNewlineIdx === -1 ? content.length : nextNewlineIdx + 1
	}

	if (repeatCount > 0 && prevLine !== null) {
		const compressionDesc = `<previous line repeated ${repeatCount} additional times>\n`
		if (compressionDesc.length < prevLine.length * repeatCount) {
			result += prevLine + compressionDesc
		} else {
			for (let i = 0; i <= repeatCount; i++) {
				result += prevLine
			}
		}
	} else if (prevLine !== null) {
		result += prevLine
	}

	return result
}

/**
 * Processes carriage returns (\r) in terminal output to simulate how a real terminal would display content.
 * This function is optimized for performance by using in-place string operations and avoiding memory-intensive
 * operations like split/join.
 *
 * Key features:
 * 1. Processes output line-by-line to maximize chunk processing
 * 2. Uses string indexes and substring operations instead of arrays
 * 3. Single-pass traversal of the entire input
 * 4. Special handling for multi-byte characters (like emoji) to prevent corruption
 * 5. Replacement of partially overwritten multi-byte characters with spaces
 *
 * @param input The terminal output to process
 * @returns The processed terminal output with carriage returns (\r) handled
 */
export function processCarriageReturns(input: string): string {
	// Quick check: if no carriage returns (\r), return the original input
	if (input.indexOf("\r") === -1) return input

	let output = ""
	let i = 0
	const len = input.length

	// Single-pass traversal of the entire input
	while (i < len) {
		// Find current line's end position (line feed (\n) or end of text)
		let lineEnd = input.indexOf("\n", i)
		if (lineEnd === -1) lineEnd = len

		// Check if current line contains carriage returns (\r)
		let crPos = input.indexOf("\r", i)
		if (crPos === -1 || crPos >= lineEnd) {
			// No carriage returns (\r) in this line, copy entire line
			output += input.substring(i, lineEnd)
		} else {
			// Line has carriage returns (\r), handle overwrite logic
			let curLine = input.substring(i, crPos)
			curLine = processLineWithCarriageReturns(input, curLine, crPos, lineEnd)
			output += curLine
		}

		// 'curLine' now holds the processed content of the line *without* its original terminating line feed (\n) character.
		// 'lineEnd' points to the position of that line feed (\n) in the original input, or to the end of the input string if no line feed (\n) was found.
		// This check explicitly adds the line feed (\n) character back *only if* one was originally present at this position (lineEnd < len).
		// This ensures we preserve the original structure, correctly handling inputs both with and without a final line feed (\n),
		// rather than incorrectly injecting a line feed (\n) if the original input didn't end with one.
		if (lineEnd < len) output += "\n"

		// Move to next line
		i = lineEnd + 1
	}

	return output
}

/**
 * Processes backspace characters (\b) in terminal output using index operations.
 * Uses indexOf to efficiently locate and handle backspaces.
 *
 * Technically terminal only moves the cursor and overwrites in-place,
 * but we assume \b is destructive as an optimization which is acceptable
 * for all progress spinner cases and most terminal output cases.
 *
 * @param input The terminal output to process
 * @returns The processed output with backspaces handled
 */
export function processBackspaces(input: string): string {
	let output = ""
	let pos = 0
	let bsPos = input.indexOf("\b")

	while (bsPos !== -1) {
		// Fast path: exclude char before backspace
		output += input.substring(pos, bsPos - 1)

		// Move past backspace
		pos = bsPos + 1

		// Count consecutive backspaces
		let count = 0
		while (input[pos] === "\b") {
			count++
			pos++
		}

		// Trim output mathematically for consecutive backspaces
		if (count > 0 && output.length > 0) {
			output = output.substring(0, Math.max(0, output.length - count))
		}

		// Find next backspace
		bsPos = input.indexOf("\b", pos)
	}

	// Add remaining content
	if (pos < input.length) {
		output += input.substring(pos)
	}

	return output
}

/**
 * Helper function to process a single line with carriage returns.
 * Handles the overwrite logic for a line that contains one or more carriage returns (\r).
 *
 * @param input The original input string
 * @param initialLine The line content up to the first carriage return
 * @param initialCrPos The position of the first carriage return in the line
 * @param lineEnd The position where the line ends
 * @returns The processed line with carriage returns handled
 */
function processLineWithCarriageReturns(
	input: string,
	initialLine: string,
	initialCrPos: number,
	lineEnd: number,
): string {
	let curLine = initialLine
	let crPos = initialCrPos

	while (crPos < lineEnd) {
		// Find next carriage return (\r) or line end (line feed (\n))
		let nextCrPos = input.indexOf("\r", crPos + 1)
		if (nextCrPos === -1 || nextCrPos >= lineEnd) nextCrPos = lineEnd

		// Extract segment after carriage return (\r)
		let segment = input.substring(crPos + 1, nextCrPos)

		// Skip empty segments
		if (segment !== "") {
			// Determine how to handle overwrite
			if (segment.length >= curLine.length) {
				// Complete overwrite
				curLine = segment
			} else {
				// Partial overwrite - need to check for multi-byte character boundary issues
				const potentialPartialChar = curLine.charAt(segment.length)
				const segmentLastCharCode = segment.length > 0 ? segment.charCodeAt(segment.length - 1) : 0
				const partialCharCode = potentialPartialChar.charCodeAt(0)

				// Simplified condition for multi-byte character detection
				if (
					(segmentLastCharCode >= 0xd800 && segmentLastCharCode <= 0xdbff) || // High surrogate at end of segment
					(partialCharCode >= 0xdc00 && partialCharCode <= 0xdfff) || // Low surrogate at overwrite position
					(curLine.length > segment.length + 1 && partialCharCode >= 0xd800 && partialCharCode <= 0xdbff) // High surrogate followed by another character
				) {
					// If a partially overwritten multi-byte character is detected, replace with space
					const remainPart = curLine.substring(segment.length + 1)
					curLine = segment + " " + remainPart
				} else {
					// Normal partial overwrite
					curLine = segment + curLine.substring(segment.length)
				}
			}
		}

		crPos = nextCrPos
	}

	return curLine
}
