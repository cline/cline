/**
 * File mention menu component for CLI
 * Displays a list of matching files when user types @
 */

import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import type { FileSearchResult } from "../utils/file-search"
import { getVisibleWindow } from "../utils/slash-commands"

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
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">Searching files...</Text>
			</Box>
		)
	}

	if (results.length === 0) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">{query ? `No files matching "${query}"` : "Type to search files..."}</Text>
			</Box>
		)
	}

	const { items: visibleResults, startIndex } = getVisibleWindow(results, selectedIndex)
	const hasMoreBelow = startIndex + visibleResults.length < results.length

	return (
		<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
			{visibleResults.map((result, idx) => {
				const isSelected = startIndex + idx === selectedIndex
				const displayPath = truncatePath(result.path)

				return (
					<Box key={result.path}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined}>
							{isSelected ? "❯" : " "} {displayPath}
						</Text>
					</Box>
				)
			})}
			{hasMoreBelow && <Text color="gray">{"  "}▼</Text>}
		</Box>
	)
}
