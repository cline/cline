/**
 * File mention menu component for CLI
 * Displays a list of matching files when user types @
 */

import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { type FileSearchResult, getRipgrepInstallInstructions } from "../utils/file-search"
import { getVisibleWindow } from "../utils/slash-commands"

interface FileMentionMenuProps {
	results: FileSearchResult[]
	selectedIndex: number
	isLoading: boolean
	query: string
	showRipgrepWarning?: boolean
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

export const FileMentionMenu: React.FC<FileMentionMenuProps> = ({
	results,
	selectedIndex,
	isLoading,
	query,
	showRipgrepWarning,
}) => {
	const ripgrepWarning = showRipgrepWarning && (
		<Box marginTop={1}>
			<Text color="yellow">ripgrep not found - file search will be slower. </Text>
			<Text color="gray">Install: {getRipgrepInstallInstructions()}</Text>
		</Box>
	)

	if (isLoading) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">Searching files...</Text>
				{ripgrepWarning}
			</Box>
		)
	}

	if (results.length === 0) {
		return (
			<Box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
				<Text color="gray">{query ? `No files matching "${query}"` : "Type to search files..."}</Text>
				{ripgrepWarning}
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
			{ripgrepWarning}
		</Box>
	)
}
