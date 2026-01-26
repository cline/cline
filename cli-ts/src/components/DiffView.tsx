/**
 * DiffView component for displaying file diffs in Ink
 * Shows unified diff output with colored lines for additions/deletions
 * Supports SEARCH/REPLACE format and ApplyPatch format
 */

import { Box, Text } from "ink"
import React from "react"

interface DiffViewProps {
	/** Diff content (SEARCH/REPLACE format, ApplyPatch format, or raw content for new files) */
	content?: string
}

interface DiffLine {
	type: "add" | "remove" | "context" | "separator"
	content: string
}

interface ParsedPatch {
	additions: number
	deletions: number
	lines: DiffLine[]
}

// Constants for format markers
const MARKERS = {
	SEARCH_BLOCK: "------- SEARCH",
	SEARCH_SEPARATOR: "=======",
	REPLACE_BLOCK: "+++++++ REPLACE",
	NEW_BEGIN: "*** Begin Patch",
	NEW_END: "*** End Patch",
} as const

/**
 * Parse SEARCH/REPLACE format into diff lines
 * Format: ------- SEARCH\n...\n=======\n...\n+++++++ REPLACE
 */
function parseSearchReplaceFormat(content: string): ParsedPatch {
	const result: ParsedPatch = { additions: 0, deletions: 0, lines: [] }

	// Find all SEARCH blocks
	const searchRegex = /-{7,} SEARCH/g
	const searchPositions: number[] = []
	let match: RegExpExecArray | null
	while ((match = searchRegex.exec(content)) !== null) {
		searchPositions.push(match.index)
	}

	for (let i = 0; i < searchPositions.length; i++) {
		// Add separator between blocks
		if (i > 0) {
			result.lines.push({ type: "separator", content: "" })
		}

		const start = searchPositions[i]
		const end = i < searchPositions.length - 1 ? searchPositions[i + 1] : content.length
		const blockContent = content.substring(start, end)

		// Extract content after SEARCH marker
		const afterSearch = blockContent.substring(MARKERS.SEARCH_BLOCK.length).replace(/^\r?\n/, "")
		const separatorIndex = afterSearch.indexOf(MARKERS.SEARCH_SEPARATOR)

		if (separatorIndex === -1) {
			// Still streaming - only SEARCH block available
			const searchContent = afterSearch.trimEnd()
			for (const line of searchContent.split("\n")) {
				result.lines.push({ type: "remove", content: line })
				result.deletions++
			}
		} else {
			// Extract SEARCH block (deletions)
			const searchContent = afterSearch.substring(0, separatorIndex).replace(/\r?\n$/, "")
			for (const line of searchContent.split("\n")) {
				result.lines.push({ type: "remove", content: line })
				result.deletions++
			}

			// Extract REPLACE block (additions)
			const afterSeparator = afterSearch.substring(separatorIndex + MARKERS.SEARCH_SEPARATOR.length).replace(/^\r?\n/, "")
			const replaceEndIndex = afterSeparator.indexOf(MARKERS.REPLACE_BLOCK)
			const replaceContent =
				replaceEndIndex !== -1
					? afterSeparator.substring(0, replaceEndIndex).replace(/\r?\n$/, "")
					: afterSeparator.trimEnd()

			for (const line of replaceContent.split("\n")) {
				result.lines.push({ type: "add", content: line })
				result.additions++
			}
		}
	}

	return result
}

/**
 * Parse ApplyPatch format into diff lines
 * Format: *** Begin Patch\n*** Update File: path\n+line\n-line\n*** End Patch
 */
function parseApplyPatchFormat(content: string): ParsedPatch {
	const result: ParsedPatch = { additions: 0, deletions: 0, lines: [] }

	const beginIndex = content.indexOf(MARKERS.NEW_BEGIN)
	if (beginIndex === -1) return result

	const endIndex = content.indexOf(MARKERS.NEW_END)
	const contentStart = beginIndex + MARKERS.NEW_BEGIN.length
	const contentEnd = endIndex !== -1 ? endIndex : content.length
	const patchContent = content.substring(contentStart, contentEnd).trim()

	for (const line of patchContent.split("\n")) {
		// Skip file header lines
		if (line.match(/^\*\*\* (Add|Update|Delete) File:/)) continue
		if (line.trim() === "@@") continue

		if (line.startsWith("+")) {
			const hasSpace = line.startsWith("+ ")
			result.lines.push({ type: "add", content: hasSpace ? line.slice(2) : line.slice(1) })
			result.additions++
		} else if (line.startsWith("-")) {
			const hasSpace = line.startsWith("- ")
			result.lines.push({ type: "remove", content: hasSpace ? line.slice(2) : line.slice(1) })
			result.deletions++
		} else if (line.trim()) {
			// Context line
			result.lines.push({ type: "context", content: line })
		}
	}

	return result
}

/**
 * Parse tool content into diff lines
 * Detects format and delegates to appropriate parser
 */
function parseToolContent(content: string): ParsedPatch {
	// Try SEARCH/REPLACE format first
	if (content.includes(MARKERS.SEARCH_BLOCK)) {
		return parseSearchReplaceFormat(content)
	}

	// Try ApplyPatch format
	if (content.includes(MARKERS.NEW_BEGIN)) {
		return parseApplyPatchFormat(content)
	}

	// Fallback: treat as new file (all additions)
	const lines = content.split("\n")
	return {
		additions: lines.length,
		deletions: 0,
		lines: lines.map((line) => ({ type: "add", content: line })),
	}
}

// Dim diff colors similar to IDE diff views
const DIFF_COLORS = {
	addBg: "rgb(35, 61, 41)", // dark muted green
	addFg: "rgb(156, 204, 122)", // light green text
	removeBg: "rgb(62, 36, 36)", // dark muted red
	removeFg: "rgb(224, 139, 139)", // light red/pink text
} as const

/**
 * Render a diff line with full-width background color highlighting
 * Uses Box with backgroundColor to handle wrapping properly
 */
const DiffLineRow: React.FC<{ line: DiffLine }> = ({ line }) => {
	if (line.type === "separator") {
		return <Text> </Text>
	}

	const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "
	const content = prefix + line.content

	switch (line.type) {
		case "add":
			return (
				<Box backgroundColor={DIFF_COLORS.addBg} width="100%">
					<Text color={DIFF_COLORS.addFg}>{content}</Text>
				</Box>
			)
		case "remove":
			return (
				<Box backgroundColor={DIFF_COLORS.removeBg} width="100%">
					<Text color={DIFF_COLORS.removeFg}>{content}</Text>
				</Box>
			)
		case "context":
			return <Text dimColor>{content}</Text>
		default:
			return null
	}
}

/**
 * DiffView component that renders file edits as a diff
 * Supports SEARCH/REPLACE format and ApplyPatch format
 */
export const DiffView: React.FC<DiffViewProps> = ({ content }) => {
	if (!content) {
		return null
	}

	const parsed = parseToolContent(content)

	return (
		<Box flexDirection="column" width="100%">
			{parsed.lines.map((line, idx) => (
				<DiffLineRow key={idx} line={line} />
			))}
		</Box>
	)
}
