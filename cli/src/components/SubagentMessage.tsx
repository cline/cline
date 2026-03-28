import type { ClineAskUseSubagents, ClineMessage, ClineSaySubagentStatus } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"
import { COLORS } from "../constants/colors"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { jsonParseSafe } from "../utils/parser"

interface SubagentMessageProps {
	message: ClineMessage
	isStreaming?: boolean
	mode?: "act" | "plan"
}

const TREE_PREFIX_WIDTH = 5
const MIN_PROMPT_WIDTH = 20

const DotRow: React.FC<{ children: React.ReactNode; color?: string; flashing?: boolean }> = ({
	children,
	color,
	flashing = false,
}) => (
	<Box flexDirection="row">
		<Box width={2}>
			{flashing ? (
				<Text color={color}>
					<Spinner type="toggle8" />
				</Text>
			) : (
				<Text color={color}>⏺</Text>
			)}
		</Box>
		<Box flexGrow={1}>{children}</Box>
	</Box>
)

function formatCompactTokens(tokens: number | undefined): string {
	const value = Number.isFinite(tokens) ? Math.max(0, tokens || 0) : 0
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: 1,
	})
		.format(value)
		.toLowerCase()
}

function formatCompactCost(cost: number | undefined): string {
	const value = Number.isFinite(cost) ? Math.max(0, cost || 0) : 0
	const maximumFractionDigits = value >= 0.01 ? 2 : 4
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(value)
}

function formatSubagentStatsValues(
	toolCalls: number | undefined,
	contextTokens: number | undefined,
	totalCost: number | undefined,
	latestToolCall?: string,
) {
	const safeToolCalls = Number.isFinite(toolCalls) ? Math.max(0, toolCalls || 0) : 0
	const toolUses = safeToolCalls === 1 ? "tool use" : "tool uses"
	const tokensUsed = formatCompactTokens(contextTokens || 0)
	const formattedCost = formatCompactCost(totalCost || 0)
	const stats = `${safeToolCalls} ${toolUses} · ${tokensUsed} tokens · ${formattedCost}`
	const latestTool = latestToolCall?.trim()
	return latestTool ? `${latestTool} · ${stats}` : stats
}

function wrapPrompt(text: string, width: number): string[] {
	if (!text) {
		return [""]
	}

	const normalizedWidth = Math.max(1, width)
	const wrappedLines: string[] = []
	const paragraphs = text.split("\n")

	for (const paragraph of paragraphs) {
		const words = paragraph.trim().split(/\s+/).filter(Boolean)
		if (words.length === 0) {
			wrappedLines.push("")
			continue
		}

		let line = ""
		for (const word of words) {
			if (!line) {
				if (word.length <= normalizedWidth) {
					line = word
					continue
				}

				let remaining = word
				while (remaining.length > normalizedWidth) {
					wrappedLines.push(remaining.slice(0, normalizedWidth))
					remaining = remaining.slice(normalizedWidth)
				}
				line = remaining
				continue
			}

			if (line.length + 1 + word.length <= normalizedWidth) {
				line = `${line} ${word}`
				continue
			}

			wrappedLines.push(line)

			if (word.length <= normalizedWidth) {
				line = word
				continue
			}

			let remaining = word
			while (remaining.length > normalizedWidth) {
				wrappedLines.push(remaining.slice(0, normalizedWidth))
				remaining = remaining.slice(normalizedWidth)
			}
			line = remaining
		}

		if (line) {
			wrappedLines.push(line)
		}
	}

	return wrappedLines.length > 0 ? wrappedLines : [text]
}

const TreePromptRow: React.FC<{
	prefix: React.ReactNode
	continuationPrefix: string
	prompt: string
	promptWidth: number
	color?: string
}> = ({ prefix, continuationPrefix, prompt, promptWidth, color }) => {
	const lines = wrapPrompt(prompt, promptWidth)

	return (
		<Box flexDirection="column" width="100%">
			{lines.map((line, index) => (
				<Box flexDirection="row" key={`${line}-${index}`} width="100%">
					<Box flexShrink={0} width={TREE_PREFIX_WIDTH}>
						{index === 0 ? prefix : <Text color="gray">{continuationPrefix}</Text>}
					</Box>
					<Box flexGrow={1}>
						<Text color={color}>{line}</Text>
					</Box>
				</Box>
			))}
		</Box>
	)
}

const TreeStatsRow: React.FC<{ prefix: string; stats: string }> = ({ prefix, stats }) => (
	<Box flexDirection="row" width="100%">
		<Box flexShrink={0} width={TREE_PREFIX_WIDTH}>
			<Text color="gray">{prefix}</Text>
		</Box>
		<Box flexGrow={1}>
			<Text color="gray">⎿ {stats}</Text>
		</Box>
	</Box>
)

export const SubagentMessage: React.FC<SubagentMessageProps> = ({ message, mode, isStreaming }) => {
	const { type, ask, say, text, partial } = message
	const toolColor = mode === "plan" ? "yellow" : COLORS.primaryBlue
	const { columns } = useTerminalSize()
	const promptWidth = Math.max(MIN_PROMPT_WIDTH, columns - 2 - TREE_PREFIX_WIDTH)

	if ((type === "ask" && ask === "use_subagents") || say === "use_subagents") {
		const parsed = text
			? jsonParseSafe<ClineAskUseSubagents>(text, {
					prompts: [],
				})
			: { prompts: [] }

		const prompts = (parsed.prompts || []).map((prompt) => prompt?.trim()).filter(Boolean)
		if (prompts.length === 0) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color={toolColor}>
						<Text color={toolColor}>Cline wants to run subagents:</Text>
					</DotRow>
				</Box>
			)
		}

		const singular = prompts.length === 1
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor} flashing={partial === true && isStreaming}>
					<Text color={toolColor}>{singular ? "Cline wants to run a subagent:" : "Cline wants to run subagents:"}</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					{prompts.map((prompt, index) => {
						const isLastPrompt = index === prompts.length - 1
						const branch = isLastPrompt ? "└─" : "├─"
						const continuationPrefix = isLastPrompt ? "     " : "│    "
						const shouldShowPromptStats = partial !== true || !isLastPrompt
						return (
							<Box flexDirection="column" key={`${prompt}-${index}`}>
								<TreePromptRow
									color={toolColor}
									continuationPrefix={continuationPrefix}
									prefix={<Text color={toolColor}>{`${branch} `}</Text>}
									prompt={prompt}
									promptWidth={promptWidth}
								/>
								{shouldShowPromptStats && (
									<TreeStatsRow
										prefix={continuationPrefix}
										stats={formatSubagentStatsValues(undefined, undefined, undefined)}
									/>
								)}
							</Box>
						)
					})}
				</Box>
			</Box>
		)
	}

	if (say === "subagent" && text) {
		const parsed = jsonParseSafe<ClineSaySubagentStatus>(text, {
			status: "running",
			total: 0,
			completed: 0,
			successes: 0,
			failures: 0,
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			contextWindow: 0,
			maxContextTokens: 0,
			maxContextUsagePercentage: 0,
			items: [],
		})

		const items = parsed.items || []
		if (items.length === 0) {
			return null
		}

		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor} flashing={partial === true && isStreaming}>
					<Text color={toolColor}>
						{items.length === 1 ? "Cline is running a subagent:" : "Cline is running subagents:"}
					</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					{items.map((entry, index) => {
						const isLastEntry = index === items.length - 1
						const branch = isLastEntry ? "└─" : "├─"
						const continuationPrefix = isLastEntry ? "     " : "│    "
						const key = `${entry.index}-${index}`
						const shouldShowStats = true

						if (entry.status === "completed") {
							return (
								<Box flexDirection="column" key={key}>
									<TreePromptRow
										color="green"
										continuationPrefix={continuationPrefix}
										prefix={
											<Box flexDirection="row">
												<Text color="gray">{`${branch} `}</Text>
												<Text color="green">✓</Text>
											</Box>
										}
										prompt={entry.prompt}
										promptWidth={promptWidth}
									/>
									<TreeStatsRow
										prefix={continuationPrefix}
										stats={formatSubagentStatsValues(
											entry.toolCalls,
											entry.contextTokens,
											entry.totalCost,
											entry.latestToolCall,
										)}
									/>
								</Box>
							)
						}

						if (entry.status === "failed") {
							return (
								<Box flexDirection="column" key={key}>
									<TreePromptRow
										color="red"
										continuationPrefix={continuationPrefix}
										prefix={
											<Box flexDirection="row">
												<Text color="gray">{`${branch} `}</Text>
												<Text color="red">✗</Text>
											</Box>
										}
										prompt={entry.prompt}
										promptWidth={promptWidth}
									/>
									<TreeStatsRow
										prefix={continuationPrefix}
										stats={formatSubagentStatsValues(
											entry.toolCalls,
											entry.contextTokens,
											entry.totalCost,
											entry.latestToolCall,
										)}
									/>
								</Box>
							)
						}

						return (
							<Box flexDirection="column" key={key}>
								<TreePromptRow
									color={toolColor}
									continuationPrefix={continuationPrefix}
									prefix={
										<Box flexDirection="row">
											<Text color="gray">{branch} </Text>
											{entry.status === "running" ? (
												<Text color={toolColor}>
													<Spinner type="dots" />
												</Text>
											) : (
												<Text color={toolColor}>•</Text>
											)}
										</Box>
									}
									prompt={entry.prompt}
									promptWidth={promptWidth}
								/>
								{shouldShowStats && (
									<TreeStatsRow
										prefix={continuationPrefix}
										stats={formatSubagentStatsValues(
											entry.toolCalls,
											entry.contextTokens,
											entry.totalCost,
											entry.latestToolCall,
										)}
									/>
								)}
							</Box>
						)
					})}
				</Box>
			</Box>
		)
	}

	return null
}
