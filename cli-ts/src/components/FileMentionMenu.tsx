/**
 * File mention menu component for CLI
 * Displays a list of matching files when user types @
 */

import { Box, Text } from "ink"
import React from "react"
import type { FileSearchResult } from "../utils/file-search"

interface FileMentionMenuProps {
	results: FileSearchResult[]
	selectedIndex: number
	isLoading: boolean
	query: string
}

/**
 * Truncate path from the left if too long, keeping the filename visible
 */
function truncatePath(filePath: string, maxLength: number = 50): string {
	if (filePath.length <= maxLength) {
		return filePath
	}
	return "..." + filePath.slice(-(maxLength - 3))
}

export const FileMentionMenu: React.FC<FileMentionMenuProps> = ({ results, selectedIndex, isLoading, query }) => {
	if (isLoading) {
		return (
			<Box borderColor="gray" borderStyle="single" flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">Searching files...</Text>
			</Box>
		)
	}

	if (results.length === 0) {
		return (
			<Box borderColor="gray" borderStyle="single" flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">{query ? `No files matching "${query}"` : "Type to search files..."}</Text>
			</Box>
		)
	}

	// Show max 8 items, centered around selected item
	const maxVisible = 8
	let startIndex = 0
	let endIndex = results.length

	if (results.length > maxVisible) {
		// Center the selected item in the visible window
		const halfWindow = Math.floor(maxVisible / 2)
		startIndex = Math.max(0, selectedIndex - halfWindow)
		endIndex = Math.min(results.length, startIndex + maxVisible)

		// Adjust if we're near the end
		if (endIndex - startIndex < maxVisible) {
			startIndex = Math.max(0, endIndex - maxVisible)
		}
	}

	const visibleResults = results.slice(startIndex, endIndex)

	return (
		<Box borderColor="cyan" borderStyle="single" flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
			<Box marginBottom={1}>
				<Text color="cyan" dimColor>
					Files {query ? `matching "${query}"` : ""} (↑/↓ to select, Tab/Enter to insert)
				</Text>
			</Box>

			{startIndex > 0 && (
				<Text color="gray" dimColor>
					↑ {startIndex} more...
				</Text>
			)}

			{visibleResults.map((result, idx) => {
				const actualIndex = startIndex + idx
				const isSelected = actualIndex === selectedIndex
				const displayPath = truncatePath(result.path)

				return (
					<Box key={result.path}>
						<Text backgroundColor={isSelected ? "blue" : undefined} color={isSelected ? "white" : undefined}>
							{isSelected ? "❯ " : "  "}
							{displayPath}
						</Text>
					</Box>
				)
			})}

			{endIndex < results.length && (
				<Text color="gray" dimColor>
					↓ {results.length - endIndex} more...
				</Text>
			)}
		</Box>
	)
}
