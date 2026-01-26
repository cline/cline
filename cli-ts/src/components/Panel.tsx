/**
 * Reusable bottom panel component
 * Used for displaying contextual UI below the chat input (settings, etc.)
 */

import { Box, Text } from "ink"
import React, { ReactNode } from "react"

export interface PanelTab {
	key: string
	label: string
}

interface PanelProps {
	/** Label for the panel (e.g., "Settings") */
	label: string
	/** Optional tabs configuration */
	tabs?: PanelTab[]
	/** Current tab key - required when tabs are provided */
	currentTab?: string
	/** Panel content */
	children: ReactNode
}

export const Panel: React.FC<PanelProps> = ({ label, tabs, currentTab, children }) => {
	const currentTabIndex = currentTab && tabs ? tabs.findIndex((t) => t.key === currentTab) : 0

	return (
		<Box borderColor="blueBright" borderStyle="round" flexDirection="column" width="100%">
			{/* Header */}
			<Box paddingLeft={1} paddingRight={1}>
				<Text bold color="blueBright">
					{label}
				</Text>
				<Text color="gray" dimColor>
					{" "}
					(Esc to close)
				</Text>
			</Box>

			{/* Tab bar if tabs are provided */}
			{tabs && tabs.length > 0 && (
				<Box paddingLeft={1} paddingRight={1}>
					{tabs.map((tab, idx) => {
						const isActive = idx === currentTabIndex
						return (
							<Text bold={isActive} color={isActive ? "blueBright" : "gray"} inverse={isActive} key={tab.key}>
								{` ${tab.label} `}
							</Text>
						)
					})}
					<Text color="gray" dimColor>
						{" "}
						(←/→)
					</Text>
				</Box>
			)}

			{/* Separator line */}
			<Box>
				<Text bold color="blueBright">
					{"─".repeat(process.stdout.columns - 2)}
				</Text>
			</Box>

			{/* Content */}
			<Box flexDirection="column" paddingLeft={1} paddingRight={1}>
				{children}
			</Box>
		</Box>
	)
}
