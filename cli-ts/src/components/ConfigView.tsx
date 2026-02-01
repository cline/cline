/**
 * Config view component
 * Displays current configuration
 */

import { Box, Text } from "ink"
import React, { useMemo } from "react"

interface ConfigEntry {
	key: string
	value: any
}

interface ConfigViewProps {
	dataDir: string
	globalState: Record<string, any>
	workspaceState: Record<string, any>
}

/**
 * Format separator
 */
function formatSeparator(char: string = "─", width: number = 80): string {
	return char.repeat(Math.max(width, 10))
}

/**
 * Check if entry should be excluded from display
 */
function shouldExcludeEntry(key: string, value: any): boolean {
	const EXCLUDED_KEYS = ["taskHistory"]

	if (EXCLUDED_KEYS.includes(key)) return true
	if (key.endsWith("Toggles")) return true
	if (key.startsWith("apiConfig_")) return true
	if (!value) return true
	if (typeof value === "object" && Object.keys(value).length === 0) return true
	if (Array.isArray(value) && value.length === 0) return true
	if (typeof value === "string" && value.trim() === "") return true
	return false
}

export const ConfigView: React.FC<ConfigViewProps> = ({ dataDir, globalState, workspaceState }) => {
	const globalEntries = useMemo(
		() =>
			Object.entries(globalState)
				.filter(([key, value]) => !shouldExcludeEntry(key, value))
				.map(([key, value]) => ({
					key,
					value: typeof value === "object" ? JSON.stringify(value, null, 2) : String(value),
				})),
		[globalState],
	)

	const workspaceEntries = useMemo(
		() =>
			Object.entries(workspaceState)
				.filter(([key, value]) => !shouldExcludeEntry(key, value))
				.map(([key, value]) => ({
					key,
					value: typeof value === "object" ? JSON.stringify(value, null, 2) : String(value),
				})),
		[workspaceState],
	)

	return (
		<Box flexDirection="column">
			<Text bold color="white">
				⚙️ Cline Configuration
			</Text>
			<Text>{formatSeparator()}</Text>

			{/* Data directory */}
			<Box>
				<Text>Data directory: </Text>
				<Text color="blue" underline>
					{dataDir}
				</Text>
			</Box>

			<Text>{formatSeparator()}</Text>

			{/* Global state */}
			{globalEntries.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold>Global State:</Text>
					{globalEntries.map((entry) => (
						<Box flexDirection="column" key={entry.key} marginLeft={2}>
							<Text>
								<Text color="cyan">{entry.key}</Text>: {entry.value}
							</Text>
						</Box>
					))}
				</Box>
			)}

			{/* Workspace state */}
			{workspaceEntries.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold>Workspace State:</Text>
					{workspaceEntries.map((entry) => (
						<Box flexDirection="column" key={entry.key} marginLeft={2}>
							<Text>
								<Text color="cyan">{entry.key}</Text>: {entry.value}
							</Text>
						</Box>
					))}
				</Box>
			)}

			<Text>{formatSeparator()}</Text>
		</Box>
	)
}
