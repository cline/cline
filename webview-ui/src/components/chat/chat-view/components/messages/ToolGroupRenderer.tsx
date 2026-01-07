import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useCallback, useMemo, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import { getIconByToolName, getToolsNotInCurrentActivities, isLowStakesTool } from "../../utils/messageUtils"

interface ToolGroupRendererProps {
	messages: ClineMessage[]
	allMessages: ClineMessage[]
}

interface ToolWithReasoning {
	tool: ClineMessage
	parsedTool: ClineSayTool
	reasoning?: string
}

const EXPANDABLE_TOOLS = new Set(["listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames", "searchFiles"])

/**
 * Renders a collapsible group of low-stakes tool calls.
 * Only shows tools that are NOT in the "current activities" range (PAST tools only).
 */
export const ToolGroupRenderer = memo(({ messages, allMessages }: ToolGroupRendererProps) => {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})

	// Filter out tools in the "current activities" range (being shown in loading state)
	const filteredMessages = useMemo(() => getToolsNotInCurrentActivities(messages, allMessages), [messages, allMessages])

	// Build tool items with associated reasoning (reasoning that comes BEFORE a tool)
	const toolsWithReasoning = useMemo(() => buildToolsWithReasoning(filteredMessages), [filteredMessages])

	const summary = getToolGroupSummary(filteredMessages)

	const handleOpenFile = useCallback((filePath: string) => {
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: filePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [])

	const handleItemToggle = useCallback((ts: number) => {
		setExpandedItems((prev) => ({ ...prev, [ts]: !prev[ts] }))
	}, [])

	// Don't render if no PAST tools to show
	if (toolsWithReasoning.length === 0) {
		return null
	}

	return (
		<div className={cn("px-4 py-2 text-description")}>
			{/* Header */}
			<div className="text-[13px] opacity-90 mb-1">{summary}:</div>

			{/* Content - files/folders with reasoning in tooltip */}
			<div className="min-w-0">
				{toolsWithReasoning.map(({ tool, parsedTool, reasoning }) => {
					const info = getToolDisplayInfo(parsedTool)
					if (!info) {
						return null
					}

					const isExpandable = EXPANDABLE_TOOLS.has(parsedTool.tool)
					const isItemExpanded = expandedItems[tool.ts] ?? false
					const content = parsedTool.content || null
					const hasReasoning = !!reasoning?.length

					return (
						<div className="min-w-0" key={tool.ts}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className="flex items-center gap-1.5 cursor-pointer text-[13px] text-description py-0.5 hover:text-link min-w-0 max-w-full px-0"
										onClick={() => (isExpandable ? handleItemToggle(tool.ts) : handleOpenFile(info.path))}
										size="icon"
										variant="text">
										<info.icon className="opacity-70 shrink-0 size-[13px]" />
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
								</TooltipTrigger>
								{hasReasoning && <TooltipContent side="bottom">{reasoning}</TooltipContent>}
							</Tooltip>
							{/* Expanded content for folders/search/definitions - raw text */}
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
 * Build tool items with associated reasoning (reasoning that comes BEFORE a tool).
 * Only processes low-stakes tools, accumulating reasoning messages along the way.
 */
function buildToolsWithReasoning(messages: ClineMessage[]): ToolWithReasoning[] {
	const result: ToolWithReasoning[] = []
	const reasoningBuffer: string[] = []

	for (const msg of messages) {
		if (msg.say === "reasoning" && msg.text) {
			reasoningBuffer.push(msg.text)
		} else if (isLowStakesTool(msg)) {
			const parsedTool = parseToolSafe(msg.text)
			result.push({
				tool: msg,
				parsedTool,
				reasoning: reasoningBuffer.length > 0 ? reasoningBuffer.join("\n\n") : undefined,
			})
			reasoningBuffer.length = 0
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
