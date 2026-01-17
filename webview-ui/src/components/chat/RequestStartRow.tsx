import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { Mode } from "@shared/storage/types"
import { LucideIcon } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { cleanPathPrefix } from "../common/CodeAccordian"
import { getIconByToolName } from "./chat-view"
import ErrorRow from "./ErrorRow"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"

interface RequestStartRowProps {
	message: ClineMessage
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	reasoningContent?: string
	responseStarted?: boolean
	clineMessages: ClineMessage[]
	mode?: Mode
	classNames?: string
	isExpanded: boolean
	handleToggle: () => void
}

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

// Helper to format search regex for display - show all terms separated by |
const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
	const cleanedPath = cleanPathPrefix(path)
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${cleanedPath}/ (${filePattern})` : `"${terms}" in ${cleanedPath}/`
}
// Format activity text based on tool type
const getActivityText = (tool: ClineSayTool): string | null => {
	const cleanedPath = cleanPathPrefix(tool.path || "")
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

// Collect tools in a given range, with optional stop condition
const collectToolsInRange = (
	messages: ClineMessage[],
	startIdx: number,
	endIdx: number,
	stopCondition?: (msg: ClineMessage) => boolean,
): { icon: LucideIcon; text: string }[] => {
	const activities: { icon: LucideIcon; text: string }[] = []
	for (let i = startIdx; i < endIdx; i++) {
		const msg = messages[i]
		if (stopCondition?.(msg)) {
			break
		}
		if (msg.say !== "tool" && msg.ask !== "tool") {
			continue
		}

		try {
			const tool = JSON.parse(msg.text || "{}") as ClineSayTool
			const activityText = getActivityText(tool)
			if (activityText) {
				const toolIcon = getIconByToolName(tool.tool)
				activities.push({ icon: toolIcon, text: activityText })
			}
		} catch {
			// ignore parse errors
		}
	}
	return activities
}

// Find current api_req and determine if it has cost
const findCurrentApiReq = (messages: ClineMessage[]): { index: number; hasCost: boolean } | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				return { index: i, hasCost: info.cost != null }
			} catch {
				return null
			}
		}
	}
	return null
}

// Find the most recent completed api_req before the given index
const findPrevCompletedApiReq = (messages: ClineMessage[], beforeIdx: number): number => {
	for (let i = beforeIdx - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				if (info.cost != null) {
					return i
				}
			} catch {
				// ignore parse errors
			}
		}
	}
	return -1
}

/**
 * Displays the current state of an active tool operation,
 */
export const RequestStartRow: React.FC<RequestStartRowProps> = ({
	apiRequestFailedMessage,
	apiReqStreamingFailedMessage,
	cost,
	reasoningContent,
	responseStarted,
	clineMessages,
	mode,
	handleToggle,
	isExpanded,
	message,
}) => {
	// Derive explicit state
	const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
	const hasCost = cost != null
	const hasReasoning = !!reasoningContent
	const hasResponseStarted = !!responseStarted

	const apiReqState: ApiReqState = hasError ? "error" : hasCost ? "final" : hasReasoning ? "thinking" : "pre"

	// While reasoning is streaming, keep the Brain ThinkingBlock exactly as-is.
	// Once response content starts (any text/tool/command), collapse into a compact
	// "🧠 Thinking" row that can be expanded to show the reasoning only.
	const showStreamingThinking = hasReasoning && !hasResponseStarted && !hasError && !hasCost
	const showCollapsedThinking = hasReasoning && !showStreamingThinking

	// Find all exploratory tool activities that are currently in flight.
	// Only show tools between the previous completed API request and the current incomplete one.
	// Once an API request completes (has cost), tool messages that follow belong to the next cycle.
	const currentActivities = useMemo(() => {
		const currentApiReq = findCurrentApiReq(clineMessages)
		if (!currentApiReq) {
			return []
		}

		if (!currentApiReq.hasCost) {
			// CASE A: Current api_req is INCOMPLETE
			const prevIdx = findPrevCompletedApiReq(clineMessages, currentApiReq.index)
			if (prevIdx === -1) {
				return []
			}
			return collectToolsInRange(clineMessages, prevIdx + 1, currentApiReq.index)
		}
		// CASE B: Current api_req is COMPLETE - no activities to show
		return []
	}, [clineMessages])

	return (
		<div>
			{apiReqState === "pre" && (
				<div className="flex items-center text-description w-full text-sm">
					<div className="ml-1 flex-1 w-full h-full">
						{currentActivities.length > 0 ? (
							<div className="flex flex-col gap-0.5 w-full min-h-1">
								{currentActivities.map((activity, _) => (
									<div className="flex items-center gap-2 h-auto w-full overflow-hidden" key={activity.text}>
										<activity.icon className="size-2 text-foreground shrink-0" />
										<TypewriterText speed={15} text={activity.text} />
									</div>
								))}
							</div>
						) : (
							<TypewriterText
								text={message.partial !== false ? (mode === "plan" ? "Planning..." : "Thinking...") : ""}
							/>
						)}
					</div>
				</div>
			)}
			{reasoningContent && (
				<ThinkingRow
					isExpanded={isExpanded || showStreamingThinking || showCollapsedThinking}
					isVisible={true}
					onToggle={handleToggle}
					reasoningContent={reasoningContent}
					showTitle={false}
				/>
			)}

			{apiReqState === "error" && (
				<ErrorRow
					apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
					apiRequestFailedMessage={apiRequestFailedMessage}
					errorType="error"
					message={message}
				/>
			)}
		</div>
	)
}
