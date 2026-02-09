import type { ClineAskUseSubagents, ClineMessage, ClineSaySubagentStatus, SubagentStatusItem } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"
import { COLORS } from "../constants/colors"
import { jsonParseSafe } from "../utils/parser"

interface SubagentMessageProps {
	message: ClineMessage
	isStreaming?: boolean
	mode?: "act" | "plan"
}

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

function formatSubagentStats(entry: SubagentStatusItem): string {
	const toolUses = entry.toolCalls === 1 ? "tool use" : "tool uses"
	const tokensUsed = formatCompactTokens(entry.contextTokens)
	const totalCost = formatCompactCost(entry.totalCost)
	return `${entry.toolCalls} ${toolUses} · ${tokensUsed} tokens · ${totalCost}`
}

export const SubagentMessage: React.FC<SubagentMessageProps> = ({ message, mode, isStreaming }) => {
	const { type, ask, say, text, partial } = message
	const toolColor = mode === "plan" ? "yellow" : COLORS.primaryBlue

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
						<Text color={toolColor}>Cline wants to run subagents</Text>
					</DotRow>
				</Box>
			)
		}

		const singular = prompts.length === 1
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor} flashing={partial === true && isStreaming}>
					<Text color={toolColor}>{singular ? "Cline wants to run a subagent" : "Cline wants to run subagents"}</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					{prompts.map((prompt, index) => {
						const isLastPrompt = index === prompts.length - 1
						const branch = isLastPrompt ? "└─" : "├─"
						return (
							<Text color={toolColor} key={`${prompt}-${index}`}>
								{branch} {prompt}
							</Text>
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
						{items.length === 1 ? "Cline is running a subagent" : "Cline is running subagents"}
					</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					{items.map((entry, index) => {
						const isLastEntry = index === items.length - 1
						const branch = isLastEntry ? "└─ " : "├─ "
						const connector = isLastEntry ? "   " : "│  "
						const key = `${entry.index}-${index}`

						if (entry.status === "completed") {
							return (
								<Box flexDirection="column" key={key}>
									<Text color="green">
										{branch}✓ {entry.prompt}
									</Text>
									<Text color="gray">
										{connector}⎿ {formatSubagentStats(entry)}
									</Text>
								</Box>
							)
						}

						if (entry.status === "failed") {
							return (
								<Box flexDirection="column" key={key}>
									<Text color="red">
										{branch}✗ {entry.prompt}
									</Text>
									<Text color="gray">
										{connector}⎿ {formatSubagentStats(entry)}
									</Text>
								</Box>
							)
						}

						return (
							<Box flexDirection="column" key={key}>
								<Box flexDirection="row">
									<Text color="gray">{branch}</Text>
									{entry.status === "running" ? (
										<Text color={toolColor}>
											<Spinner type="dots" />
										</Text>
									) : (
										<Text color={toolColor}>•</Text>
									)}
									<Text color={toolColor}> {entry.prompt}</Text>
								</Box>
								<Text color="gray">
									{connector}⎿ {formatSubagentStats(entry)}
								</Text>
							</Box>
						)
					})}
				</Box>
			</Box>
		)
	}

	return null
}
