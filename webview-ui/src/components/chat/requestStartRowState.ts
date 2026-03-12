import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import type { LucideIcon } from "lucide-react"

export type ApiReqState = "pre" | "thinking" | "error" | "final"

export type RequestStartRowActivity = {
	icon: LucideIcon
	text: string
}

type RequestStartRowStateArgs = {
	message: ClineMessage
	clineMessages: ClineMessage[]
	reasoningContent?: string
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	responseStarted?: boolean
	getIconByToolName: (toolName: string) => LucideIcon
}

// Helper to format search regex for display - show all terms separated by |
const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${path}/ (${filePattern})` : `"${terms}" in ${path}/`
}

const getActivityText = (tool: ClineSayTool): string | null => {
	switch (tool.tool) {
		case "readFile":
			return tool.path ? `Reading ${tool.path}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `Exploring ${tool.path}/...` : null
		case "searchFiles":
			return tool.regex && tool.path ? `Searching ${formatSearchRegex(tool.regex, tool.path, tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `Analyzing ${tool.path}/...` : null
		default:
			return null
	}
}

const isCompletedApiReqMessage = (message: ClineMessage): boolean => {
	if (message.say !== "api_req_started" || !message.text) {
		return false
	}

	try {
		const info = JSON.parse(message.text)
		return info.cost != null
	} catch {
		return false
	}
}

export function getRequestStartRowState(args: RequestStartRowStateArgs): {
	apiReqState: ApiReqState
	currentActivities: RequestStartRowActivity[]
	shouldShowActivities: boolean
	showStreamingThinking: boolean
} {
	const {
		message,
		clineMessages,
		reasoningContent,
		apiRequestFailedMessage,
		apiReqStreamingFailedMessage,
		cost,
		responseStarted,
		getIconByToolName,
	} = args

	const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
	const hasCost = cost != null
	const hasReasoning = !!reasoningContent
	const apiReqState: ApiReqState = hasError ? "error" : hasCost ? "final" : hasReasoning ? "thinking" : "pre"

	const showStreamingThinking = hasReasoning && !hasError && !hasCost && !responseStarted

	let currentApiReqIndex = -1
	let currentApiReqHasCost = false
	let hasCompletedTools = false

	for (let i = clineMessages.length - 1; i >= 0; i--) {
		const currentMessage = clineMessages[i]

		if (currentApiReqIndex === -1 && currentMessage.say === "api_req_started") {
			currentApiReqIndex = i
			currentApiReqHasCost = isCompletedApiReqMessage(currentMessage)
		}

		if (!hasCompletedTools && currentMessage.say === "tool" && currentMessage.ts !== message.ts) {
			for (let j = i - 1; j >= 0; j--) {
				if (isCompletedApiReqMessage(clineMessages[j])) {
					hasCompletedTools = true
					break
				}
			}
		}

		if (currentApiReqIndex !== -1 && hasCompletedTools) {
			break
		}
	}

	const currentActivities: RequestStartRowActivity[] = []
	if (currentApiReqIndex !== -1 && !currentApiReqHasCost) {
		for (let i = currentApiReqIndex + 1; i < clineMessages.length; i++) {
			const currentMessage = clineMessages[i]
			if (currentMessage.say === "tool" || currentMessage.ask !== "tool") {
				continue
			}

			try {
				const tool = JSON.parse(currentMessage.text || "{}") as ClineSayTool
				const activityText = getActivityText(tool)
				if (activityText) {
					currentActivities.push({
						icon: getIconByToolName(tool.tool),
						text: activityText,
					})
				}
			} catch {
				// ignore parse errors
			}
		}
	}

	return {
		apiReqState,
		currentActivities,
		shouldShowActivities: currentActivities.length > 0 && !hasCompletedTools,
		showStreamingThinking,
	}
}
