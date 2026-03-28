/**
 * DiffView component for displaying file diffs in Ink
 * Shows unified diff output with:
 * - Line numbers in a gutter
 * - Colored additions (green) and deletions (red)
 * - Context lines (unchanged) in dim
 * - Proper diff algorithm using Myers diff
 * - Collapsed context (hides long runs of unchanged lines)
 */

import { Box, Text } from "ink"
import React, { useMemo } from "react"
import { type ComputedDiff, computeDiff, type DiffBlock, type DiffLine, getGutterWidth } from "../utils/DiffComputer"

interface DiffViewProps {
	/** Diff content (SEARCH/REPLACE format, ApplyPatch format, or raw content for new files) */
	content?: string
	/** File path (used for potential syntax highlighting in the future) */
	filePath?: string
	/** Number of context lines to show before/after changes (default: 3) */
	contextLines?: number
}

// Diff colors - muted backgrounds with readable foreground text
const DIFF_COLORS = {
	addBg: "rgb(35, 61, 41)", // dark muted green
	addFg: "rgb(156, 204, 122)", // light green text
	removeBg: "rgb(62, 36, 36)", // dark muted red
	removeFg: "rgb(224, 139, 139)", // light red/pink text
	gutterFg: "gray", // line number color
} as const

// Default number of context lines to show
const DEFAULT_CONTEXT_LINES = 3

/**
 * Render a single diff line with gutter and colored content
 */
const DiffLineRow: React.FC<{
	line: DiffLine
	gutterWidth: number
}> = ({ line, gutterWidth }) => {
	if (line.type === "separator") {
		return <Text> </Text>
	}

	// Determine which line number to show
	// For additions: show new line number
	// For deletions: show old line number
	// For context: show new line number (both are available)
	const lineNum = line.type === "add" ? line.newLineNumber : line.type === "remove" ? line.oldLineNumber : line.newLineNumber

	const lineNumStr = lineNum !== undefined ? lineNum.toString().padStart(gutterWidth, " ") : " ".repeat(gutterWidth)

	const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "

	switch (line.type) {
		case "add":
			return (
				<Box flexDirection="row">
					<Box backgroundColor={DIFF_COLORS.addBg} flexShrink={0}>
						<Text color={DIFF_COLORS.gutterFg}>{lineNumStr} </Text>
					</Box>
					<Box backgroundColor={DIFF_COLORS.addBg} flexGrow={1}>
						<Text color={DIFF_COLORS.addFg}>
							{prefix}
							{line.content}
						</Text>
					</Box>
				</Box>
			)
		case "remove":
			return (
				<Box flexDirection="row">
					<Box backgroundColor={DIFF_COLORS.removeBg} flexShrink={0}>
						<Text color={DIFF_COLORS.gutterFg}>{lineNumStr} </Text>
					</Box>
					<Box backgroundColor={DIFF_COLORS.removeBg} flexGrow={1}>
						<Text color={DIFF_COLORS.removeFg}>
							{prefix}
							{line.content}
						</Text>
					</Box>
				</Box>
			)
		case "context":
			return (
				<Box flexDirection="row">
					<Box flexShrink={0}>
						<Text color={DIFF_COLORS.gutterFg}>{lineNumStr} </Text>
					</Box>
					<Box flexGrow={1}>
						<Text dimColor>
							{prefix}
							{line.content}
						</Text>
					</Box>
				</Box>
			)
		default:
			return null
	}
}

/**
 * Render a separator between diff blocks
 */
const BlockSeparator: React.FC = () => (
	<Box marginY={0}>
		<Text color="gray">{"─".repeat(40)}</Text>
	</Box>
)

/**
 * Render an ellipsis row for collapsed context lines
 */
const CollapsedRow: React.FC<{ count: number; gutterWidth: number }> = ({ count, gutterWidth }) => (
	<Box flexDirection="row">
		<Box flexShrink={0}>
			<Text color="gray">{" ".repeat(gutterWidth)} </Text>
		</Box>
		<Box flexGrow={1}>
			<Text color="gray" dimColor>
				{"  "}... {count} unchanged line{count === 1 ? "" : "s"} ...
			</Text>
		</Box>
	</Box>
)

/**
 * Represents either a diff line or a collapsed section marker
 */
type DisplayLine =
	| { type: "line"; line: DiffLine }
	| { type: "collapsed"; count: number; startLineNumber: number; endLineNumber: number }

/**
 * Collapse long runs of context lines, keeping only contextLines before/after changes
 */
function collapseContext(block: DiffBlock, contextLines: number): DisplayLine[] {
	const lines = block.lines
	const result: DisplayLine[] = []

	// Find indices of all change lines (add/remove)
	const changeIndices: number[] = []
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].type === "add" || lines[i].type === "remove") {
			changeIndices.push(i)
		}
	}

	// If no changes, show all (shouldn't happen but handle it)
	if (changeIndices.length === 0) {
		return lines.map((line) => ({ type: "line", line }))
	}

	// Build a set of indices to keep (within contextLines of any change)
	const keepIndices = new Set<number>()
	for (const changeIdx of changeIndices) {
		for (let i = Math.max(0, changeIdx - contextLines); i <= Math.min(lines.length - 1, changeIdx + contextLines); i++) {
			keepIndices.add(i)
		}
	}

	// Process lines, grouping consecutive hidden context lines
	let hiddenStart: number | null = null
	let hiddenCount = 0
	let hiddenStartLineNum = 0
	let hiddenEndLineNum = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		if (keepIndices.has(i)) {
			// Emit any pending collapsed section
			if (hiddenCount > 0) {
				result.push({
					type: "collapsed",
					count: hiddenCount,
					startLineNumber: hiddenStartLineNum,
					endLineNumber: hiddenEndLineNum,
				})
				hiddenCount = 0
				hiddenStart = null
			}
			result.push({ type: "line", line })
		} else {
			// Context line that should be hidden
			if (hiddenStart === null) {
				hiddenStart = i
				hiddenStartLineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
			}
			hiddenEndLineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
			hiddenCount++
		}
	}

	// Emit any remaining collapsed section
	if (hiddenCount > 0) {
		result.push({
			type: "collapsed",
			count: hiddenCount,
			startLineNumber: hiddenStartLineNum,
			endLineNumber: hiddenEndLineNum,
		})
	}

	return result
}

/**
 * DiffView component that renders file edits as a proper diff
 * Supports SEARCH/REPLACE format and ApplyPatch format
 */
export const DiffView: React.FC<DiffViewProps> = ({ content, contextLines = DEFAULT_CONTEXT_LINES }) => {
	const diff = useMemo((): ComputedDiff | null => {
		if (!content) return null
		return computeDiff(content)
	}, [content])

	const gutterWidth = useMemo(() => {
		if (!diff) return 1
		return getGutterWidth(diff)
	}, [diff])

	// Collapse context lines for each block
	const collapsedBlocks = useMemo(() => {
		if (!diff) return []
		return diff.blocks.map((block) => collapseContext(block, contextLines))
	}, [diff, contextLines])

	if (!diff || diff.blocks.length === 0) {
		return null
	}

	return (
		<Box flexDirection="column" width="100%">
			{collapsedBlocks.map((displayLines, blockIdx) => (
				<React.Fragment key={blockIdx}>
					{blockIdx > 0 && <BlockSeparator />}
					{displayLines.map((item, lineIdx) =>
						item.type === "collapsed" ? (
							<CollapsedRow count={item.count} gutterWidth={gutterWidth} key={`${blockIdx}-${lineIdx}`} />
						) : (
							<DiffLineRow gutterWidth={gutterWidth} key={`${blockIdx}-${lineIdx}`} line={item.line} />
						),
					)}
				</React.Fragment>
			))}
		</Box>
	)
}
