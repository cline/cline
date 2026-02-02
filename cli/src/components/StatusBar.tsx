/**
 * Status bar component
 * Shows git branch, model, context window usage, token count, and cost
 */

import { execSync } from "child_process"
import { Box, Text } from "ink"
import React, { useEffect, useState } from "react"

interface StatusBarProps {
	modelId: string
	tokensIn?: number
	tokensOut?: number
	totalCost?: number
	contextWindowSize?: number
	cwd?: string
}

/**
 * Get current git branch name
 */
function getGitBranch(cwd?: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: cwd || process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim()
		return branch
	} catch {
		return null
	}
}

/**
 * Get directory basename
 */
function getDirName(cwd?: string): string {
	const path = cwd || process.cwd()
	return path.split("/").pop() || path
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
	return num.toLocaleString()
}

/**
 * Create a progress bar for context window usage
 */
function createContextBar(used: number, total: number, width: number = 8): string {
	const ratio = Math.min(used / total, 1)
	const filled = Math.round(ratio * width)
	const empty = width - filled
	return "█".repeat(filled) + "░".repeat(empty)
}

export const StatusBar: React.FC<StatusBarProps> = ({
	modelId,
	tokensIn = 0,
	tokensOut = 0,
	totalCost = 0,
	contextWindowSize = 200000, // Default Claude context window
	cwd,
}) => {
	const [branch, setBranch] = useState<string | null>(null)
	const dirName = getDirName(cwd)

	useEffect(() => {
		setBranch(getGitBranch(cwd))
	}, [cwd])

	const totalTokens = tokensIn + tokensOut
	const contextBar = createContextBar(totalTokens, contextWindowSize)

	// Format model ID for display (shorten if needed)
	const displayModel = modelId.length > 20 ? modelId.substring(0, 17) + "..." : modelId

	return (
		<Box flexDirection="column">
			<Box gap={1}>
				{/* Directory and branch */}
				<Text color="gray">
					{dirName}
					{branch && (
						<Text color="gray">
							{" "}
							(<Text color="cyan">{branch}</Text>)
						</Text>
					)}
				</Text>
				<Text color="gray">|</Text>

				{/* Model and context bar */}
				<Text color="white">{displayModel}</Text>
				<Text color="blue">{contextBar}</Text>
				<Text color="gray">({formatNumber(totalTokens)})</Text>
				<Text color="gray">|</Text>

				{/* Cost */}
				<Text color="green">${totalCost.toFixed(4)}</Text>
			</Box>
		</Box>
	)
}
