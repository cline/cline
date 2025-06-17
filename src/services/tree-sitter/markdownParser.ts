/**
 * Markdown parser that returns headers and section line ranges
 * This is a special case implementation that doesn't use tree-sitter
 * but is compatible with the parseFile function's capture processing
 */

import { QueryCapture } from "web-tree-sitter"

/**
 * Interface to mimic tree-sitter node structure
 */
interface MockNode {
	startPosition: {
		row: number
	}
	endPosition: {
		row: number
	}
	text: string
	parent?: MockNode
}

/**
 * Interface to mimic tree-sitter capture structure
 */
interface MockCapture {
	node: MockNode
	name: string
	patternIndex: number
}

/**
 * Parse a markdown file and extract headers and section line ranges
 *
 * @param content - The content of the markdown file
 * @returns An array of mock captures compatible with tree-sitter captures
 */
export function parseMarkdown(content: string): QueryCapture[] {
	if (!content || content.trim() === "") {
		return []
	}

	const lines = content.split("\n")
	const captures: MockCapture[] = []

	// Regular expressions for different header types
	const atxHeaderRegex = /^(#{1,6})\s+(.+)$/
	// Setext headers must have at least 3 = or - characters
	const setextH1Regex = /^={3,}\s*$/
	const setextH2Regex = /^-{3,}\s*$/
	// Valid setext header text line should be plain text (not empty, not indented, not a special element)
	const validSetextTextRegex = /^\s*[^#<>!\[\]`\t]+[^\n]$/

	// Find all headers in the document
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		// Check for ATX headers (# Header)
		const atxMatch = line.match(atxHeaderRegex)
		if (atxMatch) {
			const level = atxMatch[1].length
			const text = atxMatch[2].trim()

			// Create a mock node for this header
			const node: MockNode = {
				startPosition: { row: i },
				endPosition: { row: i },
				text: text,
			}

			// Create a mock capture for this header
			captures.push({
				node,
				name: `name.definition.header.h${level}`,
				patternIndex: 0,
			})

			// Also create a definition capture
			captures.push({
				node,
				name: `definition.header.h${level}`,
				patternIndex: 0,
			})

			continue
		}

		// Check for setext headers (underlined headers)
		if (i > 0) {
			// Check for H1 (======)
			if (setextH1Regex.test(line) && validSetextTextRegex.test(lines[i - 1])) {
				const text = lines[i - 1].trim()

				// Create a mock node for this header
				const node: MockNode = {
					startPosition: { row: i - 1 },
					endPosition: { row: i },
					text: text,
				}

				// Create a mock capture for this header
				captures.push({
					node,
					name: "name.definition.header.h1",
					patternIndex: 0,
				})

				// Also create a definition capture
				captures.push({
					node,
					name: "definition.header.h1",
					patternIndex: 0,
				})

				continue
			}

			// Check for H2 (------)
			if (setextH2Regex.test(line) && validSetextTextRegex.test(lines[i - 1])) {
				const text = lines[i - 1].trim()

				// Create a mock node for this header
				const node: MockNode = {
					startPosition: { row: i - 1 },
					endPosition: { row: i },
					text: text,
				}

				// Create a mock capture for this header
				captures.push({
					node,
					name: "name.definition.header.h2",
					patternIndex: 0,
				})

				// Also create a definition capture
				captures.push({
					node,
					name: "definition.header.h2",
					patternIndex: 0,
				})

				continue
			}
		}
	}

	// Calculate section ranges
	// Sort captures by their start position
	captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

	// Group captures by header (name and definition pairs)
	const headerCaptures: MockCapture[][] = []
	for (let i = 0; i < captures.length; i += 2) {
		if (i + 1 < captures.length) {
			headerCaptures.push([captures[i], captures[i + 1]])
		} else {
			headerCaptures.push([captures[i]])
		}
	}

	// Update end positions for section ranges
	for (let i = 0; i < headerCaptures.length; i++) {
		const headerPair = headerCaptures[i]

		if (i < headerCaptures.length - 1) {
			// End position is the start of the next header minus 1
			const nextHeaderStartRow = headerCaptures[i + 1][0].node.startPosition.row
			headerPair.forEach((capture) => {
				capture.node.endPosition.row = nextHeaderStartRow - 1
			})
		} else {
			// Last header extends to the end of the file
			headerPair.forEach((capture) => {
				capture.node.endPosition.row = lines.length - 1
			})
		}
	}

	// Flatten the grouped captures back to a single array
	// Cast to QueryCapture[] since our MockCapture objects provide all the properties
	// that are actually used by the consuming code (node.startPosition, node.endPosition, node.text, node.parent, name)
	return headerCaptures.flat() as QueryCapture[]
}

/**
 * Format markdown captures into the same string format as parseFile
 * This is used for backward compatibility
 *
 * @param captures - The array of query captures
 * @param minSectionLines - Minimum number of lines for a section to be included
 * @returns A formatted string with headers and section line ranges
 */
export function formatMarkdownCaptures(captures: QueryCapture[], minSectionLines: number = 4): string | null {
	if (captures.length === 0) {
		return null
	}

	let formattedOutput = ""

	// Process only the definition captures (every other capture)
	for (let i = 1; i < captures.length; i += 2) {
		const capture = captures[i]
		const startLine = capture.node.startPosition.row
		const endLine = capture.node.endPosition.row

		// Only include sections that span at least minSectionLines lines
		const sectionLength = endLine - startLine + 1
		if (sectionLength >= minSectionLines) {
			// Extract header level from the name
			let headerLevel = 1

			// Check if the name contains a header level (e.g., 'definition.header.h2')
			const headerMatch = capture.name.match(/\.h(\d)$/)
			if (headerMatch && headerMatch[1]) {
				headerLevel = parseInt(headerMatch[1])
			}

			const headerPrefix = "#".repeat(headerLevel)

			// Format: startLine--endLine | # Header Text
			formattedOutput += `${startLine}--${endLine} | ${headerPrefix} ${capture.node.text}\n`
		}
	}

	return formattedOutput.length > 0 ? formattedOutput : null
}
