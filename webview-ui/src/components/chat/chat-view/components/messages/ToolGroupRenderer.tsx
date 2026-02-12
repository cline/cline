import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useCallback, useMemo, useState } from "react"
import { TypewriterText } from "@/components/chat/TypewriterText"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
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
}

const EXPANDABLE_TOOLS = new Set(["listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames", "searchFiles"])

// Helper to format activity text for active items (from RequestStartRow logic)
const getActivityText = (tool: ClineSayTool): string | null => {
	const cleanedPath = cleanPathPrefix(tool.path || "")
	const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
		const cleanedPath = cleanPathPrefix(path)
		const terms = regex
			.split("|")
			.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
			.filter(Boolean)
			.join(" | ")
		return filePattern && filePattern !== "*"
			? `"${terms}" in ${cleanedPath}/ (${filePattern})`
			: `"${terms}" in ${cleanedPath}/`
	}

	switch (tool.tool) {
		case "readFile":
			return tool.path ? `Reading ${cleanedPath}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `Exploring ${cleanedPath}/...` : null
		case "searchFiles":
			return tool.regex && tool.path ? `Searching ${formatSearchRegex(tool.regex, tool.path, tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `Analyzing ${cleanedPath}/...` : null
		default:
			return null
	}
}

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
		if (msg.say === "tool" || msg.ask !== "tool") {
			continue
		}
		if (isLowStakesTool(msg)) {
			activities.push(msg)
		}
	}

	return activities
}

/**
 * Renders a collapsible group of low-stakes tool calls.
 * Shows both completed tools AND currently active tools in a unified list (only for last group).
 */
export const ToolGroupRenderer = memo(({ messages, allMessages, isLastGroup }: ToolGroupRendererProps) => {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})

	// Filter out tools in the "current activities" range (being shown in loading state)
	const filteredMessages = useMemo(() => getToolsNotInCurrentActivities(messages, allMessages), [messages, allMessages])

	// Get current activities (active reading/exploring) - only for last group
	const currentActivities = useMemo(() => {
		if (!isLastGroup) {
			return []
		}
		return getCurrentActivities(allMessages)
	}, [allMessages, isLastGroup])

	// Build completed tool items
	const completedTools = useMemo(() => buildToolsWithReasoning(filteredMessages), [filteredMessages])

	// Build active tool items
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

	// Merge: completed items first, then active items (active only added to last group)
	// Deduplicate - exclude completed items that match active items by path
	const allTools = useMemo(() => {
		// Get paths of active items
		const activePaths = new Set(activeTools.map((item) => item.parsedTool.path).filter(Boolean))

		// Filter out completed items that are also being actively read
		const dedupedCompleted = completedTools.filter((item) => !activePaths.has(item.parsedTool.path))

		return [...dedupedCompleted, ...activeTools]
	}, [completedTools, activeTools])

	const summary = getToolGroupSummary(filteredMessages)

	const handleOpenFile = useCallback((filePath: string) => {
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: filePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [])

	const handleItemToggle = useCallback((ts: number) => {
		setExpandedItems((prev) => ({ ...prev, [ts]: !prev[ts] }))
	}, [])

	// Don't render if no tools to show
	if (allTools.length === 0) {
		return null
	}

	return (
		<div className={cn("px-4 py-2 ml-1 text-description")}>
			{/* Header */}
			<div className="text-[13px] text-description font-semibold mb-1">{summary}:</div>

			{/* Content - unified list of completed + active tools */}
			<div className="min-w-0">
				{allTools.map(({ tool, parsedTool, isActive, activityText }) => {
					const info = getToolDisplayInfo(parsedTool)
					if (!info) {
						return null
					}

					const isExpandable = EXPANDABLE_TOOLS.has(parsedTool.tool)
					const isItemExpanded = expandedItems[tool.ts] ?? false
					const content = parsedTool.content || null

					// Active items render with "Reading..." TypewriterText (match completed item structure exactly)
					if (isActive && activityText) {
						return (
							<div className="min-w-0" key={tool.ts}>
								{/* ACTIVE "READING..." ITEM STYLING - Modify vertical spacing here via py-0 and -my-0.5 */}
								<Button
									className="flex items-center gap-[3px] text-[13px] text-description py-[1px] min-w-0 max-w-full px-0 leading-tight -my-0.5"
									disabled
									size="icon"
									variant="text">
									<info.icon className="opacity-70 shrink-0 size-[12px]" />
									<span className="flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-left text-[13px]">
										<TypewriterText speed={15} text={activityText} />
									</span>{" "}
								</Button>
							</div>
						)
					}

					// Completed items render normally (clickable)
					return (
						<div className="min-w-0" key={tool.ts}>
							<Button
								className="flex items-center gap-[3px] cursor-pointer text-[13px] text-description py-[1px] hover:text-link min-w-0 max-w-full px-0 leading-tight -my-0.5"
								onClick={() => (isExpandable ? handleItemToggle(tool.ts) : handleOpenFile(info.path))}
								size="icon"
								variant="text">
								<info.icon className="opacity-70 shrink-0 size-[12px]" />
								<span
									className={cn(
										"flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-left [direction:rtl] text-[13px]",
										{
											"[direction:ltr]": !!info.displayText,
										},
									)}>
									{(info.displayText || cleanPathPrefix(info.path)) + "\u200E"}
								</span>
							</Button>
							{/* Expanded content for folders/search/definitions - file lists only */}
							{isExpandable && isItemExpanded && content && (
								<pre className="m-1 ml-4 text-xs opacity-80 whitespace-pre-wrap break-words p-2 max-h-40 overflow-auto rounded-xs">
									{content}
								</pre>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
})

/**
 * Build tool items WITHOUT reasoning.
 * Reasoning should not be displayed in file lists - only file/folder content.
 */
function buildToolsWithReasoning(messages: ClineMessage[]): ToolWithReasoning[] {
	const result: ToolWithReasoning[] = []

	for (const msg of messages) {
		// Skip reasoning messages - they should not be in file lists
		if (msg.say === "reasoning") {
			continue
		}

		if (isLowStakesTool(msg)) {
			const parsedTool = parseToolSafe(msg.text)
			result.push({
				tool: msg,
				parsedTool,
				reasoning: undefined, // Never show reasoning in file lists
			})
		}
	}

	return result
}

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
 * Get display info for a tool.
 */
function getToolDisplayInfo(tool: ClineSayTool) {
	const icon = getIconByToolName(tool.tool)
	const filePath = tool.path || ""
	const folderPath = filePath + "/"

	switch (tool.tool) {
		case "readFile":
			return { icon, path: filePath, label: "read" }
		case "listFilesTopLevel":
			return { icon, path: folderPath, label: "listed" }
		case "listFilesRecursive":
			return { icon, path: folderPath, label: "listed recursively" }
		case "listCodeDefinitionNames":
			return { icon, path: folderPath, label: "definitions" }
		case "searchFiles":
			return {
				icon,
				path: folderPath,
				label: `search: ${tool.regex}`,
				displayText: formatSearchDisplay(tool.regex || "", filePath, tool.filePattern),
			}
		default:
			return null
	}
}

/**
 * Format search regex for display - simplify complex patterns
 */
function formatSearchDisplay(regex: string, path: string, filePattern?: string): string {
	// Split by | and clean up regex syntax
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)

	const termDisplay = terms.length > 3 ? `${terms.length} patterns` : `"${terms.join(" | ")}"`
	let result = `${termDisplay} in ${cleanPathPrefix(path)}/`

	if (filePattern && filePattern !== "*") {
		result += ` (${filePattern})`
	}

	return result
}

/**
 * Get summary label for a tool group - shows what's been added to context.
 */
function getToolGroupSummary(messages: ClineMessage[]): string {
	const counts = { read: 0, list: 0, search: 0, def: 0 }

	for (const msg of messages) {
		if (!isLowStakesTool(msg)) {
			continue
		}

		const tool = parseToolSafe(msg.text)
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
