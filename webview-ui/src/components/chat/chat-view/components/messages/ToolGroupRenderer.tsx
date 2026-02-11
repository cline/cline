import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { memo, useCallback, useMemo, useState } from "react"
import { FileToolRow, getActivityText, getToolDisplayInfo } from "@/components/chat/FileToolRow"
import { cn } from "@/lib/utils"
import { getIconByToolName, getToolsNotInCurrentActivities, isLowStakesTool } from "../../utils/messageUtils"

interface ToolGroupRendererProps {
	messages: ClineMessage[]
	allMessages: ClineMessage[]
	isLastGroup: boolean
}

interface ToolWithReasoning {
	tool: ClineMessage
	parsedTool: ClineSayTool
	reasoning?: string
	isActive?: boolean
	activityText?: string
	isPendingApproval?: boolean
}

const EXPANDABLE_TOOLS = new Set(["listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames", "searchFiles"])

// Calculate current activities (from RequestStartRow logic)
const getCurrentActivities = (allMessages: ClineMessage[]): ClineMessage[] => {
	// Find current api_req
	let currentApiReqIndex = -1
	for (let i = allMessages.length - 1; i >= 0; i--) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				const hasCost = info.cost != null
				if (!hasCost) {
					currentApiReqIndex = i
					break
				}
			} catch {
				// ignore
			}
		}
	}

	if (currentApiReqIndex === -1) {
		return []
	}

	// Collect tools AFTER the current api_req_started
	const activities: ClineMessage[] = []
	for (let i = currentApiReqIndex + 1; i < allMessages.length; i++) {
		const msg = allMessages[i]
		// Only collect tools that are currently executing (ask === "tool")
		// Skip completed tools (say === "tool") - they should be in the completed list
		// Also skip pending approval tools that are not partial (they show in pending section)
		if (msg.say === "tool" || msg.ask !== "tool") {
			continue
		}
		// Only show as "active" activity if still streaming (partial)
		if (isLowStakesTool(msg) && msg.partial) {
			activities.push(msg)
		}
	}

	return activities
}

/**
 * Renders a collapsible group of low-stakes tool calls.
 * Shows completed tools, active tools, AND pending approval tools in a unified accumulative list.
 */
export const ToolGroupRenderer = memo(({ messages, allMessages, isLastGroup }: ToolGroupRendererProps) => {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})

	// Filter out tools in the "current activities" range (being shown in loading state)
	// This only filters ask tools that are still streaming - pending approval tools are kept
	const filteredMessages = useMemo(() => getToolsNotInCurrentActivities(messages, allMessages), [messages, allMessages])

	// Get current activities (active reading/exploring) - only for last group
	const currentActivities = useMemo(() => {
		if (!isLastGroup) {
			return []
		}
		return getCurrentActivities(allMessages)
	}, [allMessages, isLastGroup])

	// Split messages into completed tools and pending approval tools
	// Use raw `messages` (not filtered) to find pending approval tools,
	// since getToolsNotInCurrentActivities filters out ask tools
	const { completedTools, pendingApprovalTools } = useMemo(() => {
		const completed: ToolWithReasoning[] = []
		const pending: ToolWithReasoning[] = []

		// First collect all completed (say) tool paths so we can exclude approved asks
		const completedPaths = new Set<string>()
		for (const msg of messages) {
			if (isLowStakesTool(msg) && msg.type === "say") {
				const parsed = parseToolSafe(msg.text)
				if (parsed.path) completedPaths.add(parsed.path)
			}
		}

		// Find completed tools from filtered messages
		for (const msg of filteredMessages) {
			if (msg.say === "reasoning") continue
			if (isLowStakesTool(msg) && msg.type === "say") {
				completed.push({
					tool: msg,
					parsedTool: parseToolSafe(msg.text),
				})
			}
		}

		// Collect ALL ask tools (approved or not) - they always stay in the list.
		// The blue highlight is handled at render time (only the current pending ask is blue).
		for (const msg of messages) {
			if (msg.say === "reasoning") continue
			if (isLowStakesTool(msg) && msg.type === "ask" && !msg.partial) {
				const parsed = parseToolSafe(msg.text)
				if (!completedPaths.has(parsed.path || "")) {
					pending.push({
						tool: msg,
						parsedTool: parsed,
						isPendingApproval: true,
					})
				}
			}
		}

		return { completedTools: completed, pendingApprovalTools: pending }
	}, [messages, filteredMessages])

	// Build active tool items (still streaming)
	const activeTools = useMemo(() => {
		return currentActivities
			.map((msg) => {
				const parsedTool = parseToolSafe(msg.text)
				return {
					tool: msg,
					parsedTool,
					reasoning: undefined,
					isActive: true,
					activityText: getActivityText(parsedTool),
				}
			})
			.filter((item) => item.activityText)
	}, [currentActivities])

	// Deduplicate - exclude completed items that match active or pending items by path
	const dedupedCompleted = useMemo(() => {
		const activePaths = new Set(activeTools.map((item) => item.parsedTool.path).filter(Boolean))
		const pendingPaths = new Set(pendingApprovalTools.map((item) => item.parsedTool.path).filter(Boolean))
		return completedTools.filter((item) => !activePaths.has(item.parsedTool.path) && !pendingPaths.has(item.parsedTool.path))
	}, [completedTools, activeTools, pendingApprovalTools])

	const completedCount = dedupedCompleted.length
	const hasPendingApproval = pendingApprovalTools.length > 0
	const hasCompleted = completedCount > 0
	const hasActive = activeTools.length > 0

	const summary = getToolGroupSummary(dedupedCompleted)

	const handleItemToggle = useCallback((ts: number) => {
		setExpandedItems((prev) => ({ ...prev, [ts]: !prev[ts] }))
	}, [])

	// Don't render if no tools to show at all
	if (!hasCompleted && !hasPendingApproval && !hasActive) {
		return null
	}

	// Determine which pending tool is the current ask (blue highlighted)
	// Only the last ask tool in the group AND only if it's still the last message
	// in the conversation (nothing has happened after it — truly awaiting approval)
	const currentPendingTs = useMemo(() => {
		if (!isLastGroup || !hasPendingApproval || allMessages.length === 0) return null
		// Find the last ask tool in the group
		let lastAskTs: number | null = null
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (isLowStakesTool(msg) && msg.type === "ask" && !msg.partial) {
				lastAskTs = msg.ts
				break
			}
		}
		if (lastAskTs === null) return null
		// Verify this ask is still the last message in the conversation
		// If the conversation has moved on (new messages after it), it's been answered
		const lastConversationTs = allMessages[allMessages.length - 1].ts
		if (lastConversationTs !== lastAskTs) return null
		return lastAskTs
	}, [isLastGroup, hasPendingApproval, messages, allMessages])

	// Count non-blue pending tools as "optimistically read" — they were already approved
	// but manual approval doesn't create say messages, so we count them here
	const optimisticReadCount = useMemo(() => {
		if (!hasPendingApproval) return 0
		return pendingApprovalTools.filter(({ tool }) => tool.ts !== currentPendingTs).length
	}, [pendingApprovalTools, currentPendingTs, hasPendingApproval])

	const totalReadCount = completedCount + optimisticReadCount
	const hasAnyRead = totalReadCount > 0
	const hasCurrentPending = currentPendingTs !== null && pendingApprovalTools.some(({ tool }) => tool.ts === currentPendingTs)

	// Build combined header
	const combinedHeader = useMemo(() => {
		if (hasAnyRead && hasCurrentPending) {
			return `Cline read ${totalReadCount} file${totalReadCount > 1 ? "s" : ""} and wants to read:`
		}
		if (hasAnyRead) {
			// All files done — use totalReadCount which includes optimistic reads from ask tools
			return `Cline read ${totalReadCount} file${totalReadCount > 1 ? "s" : ""}:`
		}
		if (hasPendingApproval) {
			return "Cline wants to read:"
		}
		return null
	}, [hasAnyRead, hasCurrentPending, totalReadCount, hasPendingApproval])

	return (
		<div className={cn("px-4 py-2 ml-1 text-description")}>
			{/* Combined header */}
			{combinedHeader && <div className="text-[13px] text-foreground mb-1">{combinedHeader}</div>}

			{/* Completed tools */}
			{hasCompleted && (
				<div className="min-w-0">
					{dedupedCompleted.map(({ tool, parsedTool }) => {
						const info = getToolDisplayInfo(parsedTool, getIconByToolName)
						if (!info) return null
						const isExpandable = EXPANDABLE_TOOLS.has(parsedTool.tool)
						const isItemExpanded = expandedItems[tool.ts] ?? false
						return (
							<FileToolRow
								displayText={info.displayText}
								expandedContent={parsedTool.content || null}
								filePath={info.path}
								icon={info.icon}
								isExpandable={isExpandable}
								isExpanded={isItemExpanded}
								key={tool.ts}
								onToggle={() => handleItemToggle(tool.ts)}
							/>
						)
					})}
				</div>
			)}

			{/* Active tools (still streaming - typewriter animation) */}
			{hasActive && (
				<div className="min-w-0">
					{activeTools.map(({ tool, parsedTool, activityText }) => {
						const info = getToolDisplayInfo(parsedTool, getIconByToolName)
						if (!info) return null
						return (
							<FileToolRow
								activityText={activityText ?? undefined}
								filePath={info.path}
								icon={info.icon}
								isActive={true}
								key={tool.ts}
							/>
						)
					})}
				</div>
			)}

			{/* Pending approval files - only highlight the one currently awaiting approval */}
			{hasPendingApproval && (
				<div className="min-w-0">
					{pendingApprovalTools.map(({ tool, parsedTool }) => {
						const info = getToolDisplayInfo(parsedTool, getIconByToolName)
						if (!info) return null
						const isExpandable = EXPANDABLE_TOOLS.has(parsedTool.tool)
						const isItemExpanded = expandedItems[tool.ts] ?? false
						// Only highlight blue if this is the current pending ask
						// (the last ask tool in this group — the one currently awaiting approval)
						const isCurrentPendingAsk = tool.ts === currentPendingTs
						return (
							<FileToolRow
								displayText={info.displayText}
								expandedContent={parsedTool.content || null}
								filePath={info.path}
								icon={info.icon}
								isExpandable={isExpandable}
								isExpanded={isItemExpanded}
								isHighlighted={isCurrentPendingAsk}
								key={tool.ts}
								onToggle={() => handleItemToggle(tool.ts)}
								outsideWorkspace={parsedTool.operationIsLocatedInWorkspace === false}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
})

/**
 * Safely parse tool JSON, returning empty tool on failure.
 */
function parseToolSafe(text: string | undefined): ClineSayTool {
	try {
		return JSON.parse(text || "{}") as ClineSayTool
	} catch {
		return {} as ClineSayTool
	}
}

/**
 * Get summary label for completed tools - shows what's been added to context.
 */
function getToolGroupSummary(completedTools: ToolWithReasoning[]): string {
	const counts = { read: 0, list: 0, search: 0, def: 0 }

	for (const { parsedTool: tool } of completedTools) {
		switch (tool.tool) {
			case "readFile":
				counts.read++
				break
			case "listFilesTopLevel":
			case "listFilesRecursive":
				counts.list++
				break
			case "searchFiles":
				counts.search++
				break
			case "listCodeDefinitionNames":
				counts.def++
				break
		}
	}

	const parts: string[] = []
	const action = counts.read > 0 || counts.list > 0 ? " read " : " "

	if (counts.read > 0) {
		parts.push(`${counts.read} file${counts.read > 1 ? "s" : ""}`)
	}
	if (counts.list > 0) {
		parts.push(`${counts.list} folder${counts.list > 1 ? "s" : ""}`)
	}
	if (counts.def > 0) {
		parts.push(`${counts.def} definition${counts.def > 1 ? "s" : ""}`)
	}
	if (counts.search > 0) {
		parts.push(`performed ${counts.search} search${counts.search > 1 ? "es" : ""}`)
	}

	return parts.length === 0 ? "Context" : "Cline" + action + parts.join(", ")
}
