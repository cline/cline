/**
 * DiffView component for displaying file diffs in Ink
 * Shows unified diff output with colored lines for additions/deletions
 */

import { Box, Text } from "ink"
import React from "react"

interface DiffViewProps {
	/** File path being displayed */
	path: string
	/** For newFileCreated: the full content of the new file */
	content?: string
	/** For editedExistingFile: the unified diff string */
	diff?: string
	/** Maximum lines to display before truncating */
	maxLines?: number
}

interface DiffLine {
	type: "add" | "remove" | "context" | "header"
	lineNumber?: number
	content: string
}

/**
 * Parse a unified diff string into structured lines
 */
function parseDiff(diff: string): DiffLine[] {
	const lines = diff.split("\n")
	const result: DiffLine[] = []
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		if (line.startsWith("@@")) {
			// Parse hunk header like @@ -1,5 +1,7 @@
			const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
			if (match) {
				oldLine = parseInt(match[1], 10)
				newLine = parseInt(match[2], 10)
			}
			result.push({ type: "header", content: line })
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			result.push({ type: "add", lineNumber: newLine, content: line.slice(1) })
			newLine++
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			result.push({ type: "remove", lineNumber: oldLine, content: line.slice(1) })
			oldLine++
		} else if (line.startsWith(" ")) {
			result.push({ type: "context", lineNumber: newLine, content: line.slice(1) })
			oldLine++
			newLine++
		} else if (line.startsWith("---") || line.startsWith("+++")) {
			// File headers - skip or show as header
			result.push({ type: "header", content: line })
		}
	}

	return result
}

/**
 * Format line number with padding
 */
function formatLineNumber(num: number | undefined, width: number): string {
	if (num === undefined) {
		return " ".repeat(width)
	}
	return String(num).padStart(width, " ")
}

/**
 * Renders a new file with all lines shown as additions
 */
const NewFileView: React.FC<{ path: string; content: string; maxLines: number }> = ({ path, content, maxLines }) => {
	const lines = content.split("\n")
	const displayLines = lines.slice(0, maxLines)
	const lineNumWidth = String(lines.length).length

	return (
		<Box flexDirection="column">
			<Text bold color="green">
				+ {path} (new file)
			</Text>
			{displayLines.map((line, idx) => (
				<Box key={idx}>
					<Text dimColor>{formatLineNumber(idx + 1, lineNumWidth)} </Text>
					<Text backgroundColor="greenBright" color="black">
						+{line}
					</Text>
				</Box>
			))}
			{lines.length > maxLines && <Text dimColor>... and {lines.length - maxLines} more lines</Text>}
		</Box>
	)
}

/**
 * Renders a unified diff with colored additions and deletions
 */
const UnifiedDiffView: React.FC<{ path: string; diff: string; maxLines: number }> = ({ path, diff, maxLines }) => {
	const diffLines = parseDiff(diff)
	const displayLines = diffLines.slice(0, maxLines)
	const maxLineNum = Math.max(...diffLines.filter((l) => l.lineNumber !== undefined).map((l) => l.lineNumber!), 0)
	const lineNumWidth = String(maxLineNum).length || 3

	return (
		<Box flexDirection="column">
			<Text bold color="blue">
				~ {path} (modified)
			</Text>
			{displayLines.map((line, idx) => {
				switch (line.type) {
					case "header":
						return (
							<Text color="cyan" key={idx}>
								{line.content}
							</Text>
						)
					case "add":
						return (
							<Box key={idx}>
								<Text dimColor>{formatLineNumber(line.lineNumber, lineNumWidth)} </Text>
								<Text backgroundColor="green" color="black">
									+{line.content}
								</Text>
							</Box>
						)
					case "remove":
						return (
							<Box key={idx}>
								<Text dimColor>{formatLineNumber(line.lineNumber, lineNumWidth)} </Text>
								<Text backgroundColor="red" color="white">
									-{line.content}
								</Text>
							</Box>
						)
					case "context":
						return (
							<Box key={idx}>
								<Text dimColor>{formatLineNumber(line.lineNumber, lineNumWidth)} </Text>
								<Text> {line.content}</Text>
							</Box>
						)
					default:
						return null
				}
			})}
			{diffLines.length > maxLines && <Text dimColor>... and {diffLines.length - maxLines} more lines</Text>}
		</Box>
	)
}

/**
 * DiffView component that renders either a new file or a unified diff
 */
export const DiffView: React.FC<DiffViewProps> = ({ path, content, diff, maxLines = 20 }) => {
	// For new files, show all content as additions
	if (content && !diff) {
		return <NewFileView content={content} maxLines={maxLines} path={path} />
	}

	// For edited files, show the unified diff
	if (diff) {
		return <UnifiedDiffView diff={diff} maxLines={maxLines} path={path} />
	}

	// Fallback if neither content nor diff is provided
	return <Text color="blue">{path} (no diff available)</Text>
}
