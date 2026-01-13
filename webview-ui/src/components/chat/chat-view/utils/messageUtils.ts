/**
 * Utility functions for message filtering, grouping, and manipulation
 */

import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { ClineMessage, ClineSayBrowserAction, ClineSayTool } from "@shared/ExtensionMessage"
import { FileIcon, FolderOpenDotIcon, FolderOpenIcon, SearchIcon, ShapesIcon, WrenchIcon } from "lucide-react"

/**
 * Low-stakes tool types that should be grouped together
 */
const LOW_STAKES_TOOLS = new Set([
	"readFile",
	"listFilesTopLevel",
	"listFilesRecursive",
	"listCodeDefinitionNames",
	"searchFiles",
])

/**
 * Check if a tool message is a low-stakes tool
 */
export function isLowStakesTool(message: ClineMessage): boolean {
	if (message.say !== "tool" && message.ask !== "tool") {
		return false
	}
	try {
		const tool = JSON.parse(message.text || "{}") as ClineSayTool
		return LOW_STAKES_TOOLS.has(tool.tool)
	} catch {
		return false
	}
}

/**
 * Check if a message group is a tool group (array with _isToolGroup marker)
 */
export function isToolGroup(item: ClineMessage | ClineMessage[]): item is ClineMessage[] & { _isToolGroup: true } {
	return Array.isArray(item) && (item as any)._isToolGroup === true
}

/**
 * Combine API requests and command sequences in messages
 */
export function processMessages(messages: ClineMessage[]): ClineMessage[] {
	return combineApiRequests(combineCommandSequences(messages))
}

/**
 * Filter messages that should be visible in the chat
 */
export function filterVisibleMessages(messages: ClineMessage[]): ClineMessage[] {
	return messages.filter((message) => {
		switch (message.ask) {
			case "completion_result":
				// don't show a chat row for a completion_result ask without text. This specific type of message only occurs if cline wants to execute a command as part of its completion result, in which case we interject the completion_result tool with the execute_command tool.
				if (message.text === "") {
					return false
				}
				break
			case "api_req_failed": // this message is used to update the latest api_req_started that the request failed
			case "resume_task":
			case "resume_completed_task":
				return false
		}
		switch (message.say) {
			case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
			case "api_req_retried": // this message is used to update the latest api_req_started that the request was retried
			case "deleted_api_reqs": // aggregated api_req metrics from deleted messages
			case "task_progress": // task progress messages are displayed in TaskHeader, not in main chat
				return false
			// NOTE: reasoning passes through to be included in tool groups
			case "api_req_started":
				// Keep api_req_started visible so the Brain "thinking" UI can remain above
				// subsequent tool/text output (especially for non-exploratory operations).
				break
			case "text":
				// Sometimes cline returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
				if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				break
			case "mcp_server_request_started":
				return false
		}
		return true
	})
}

/**
 * Check if a message is part of a browser session
 */
export function isBrowserSessionMessage(message: ClineMessage): boolean {
	if (message.type === "ask") {
		return ["browser_action_launch"].includes(message.ask!)
	}
	if (message.type === "say") {
		return [
			"browser_action_launch",
			"api_req_started",
			"text",
			"browser_action",
			"browser_action_result",
			"checkpoint_created",
			"reasoning",
			"error_retry",
		].includes(message.say!)
	}
	return false
}

/**
 * Group messages, combining browser session messages into arrays
 */
export function groupMessages(visibleMessages: ClineMessage[]): (ClineMessage | ClineMessage[])[] {
	const result: (ClineMessage | ClineMessage[])[] = []
	let currentGroup: ClineMessage[] = []
	let isInBrowserSession = false

	const endBrowserSession = () => {
		if (currentGroup.length > 0) {
			result.push([...currentGroup])
			currentGroup = []
			isInBrowserSession = false
		}
	}

	visibleMessages.forEach((message) => {
		if (message.ask === "browser_action_launch" || message.say === "browser_action_launch") {
			// complete existing browser session if any
			endBrowserSession()
			// start new
			isInBrowserSession = true
			currentGroup.push(message)
		} else if (isInBrowserSession) {
			// end session if api_req_started is cancelled
			if (message.say === "api_req_started") {
				// get last api_req_started in currentGroup to check if it's cancelled
				const lastApiReqStarted = [...currentGroup].reverse().find((m) => m.say === "api_req_started")
				if (lastApiReqStarted?.text != null) {
					const info = JSON.parse(lastApiReqStarted.text)
					const isCancelled = info.cancelReason != null
					if (isCancelled) {
						endBrowserSession()
						result.push(message)
						return
					}
				}
			}

			if (isBrowserSessionMessage(message)) {
				currentGroup.push(message)

				// Check if this is a close action
				if (message.say === "browser_action") {
					const browserAction = JSON.parse(message.text || "{}") as ClineSayBrowserAction
					if (browserAction.action === "close") {
						endBrowserSession()
					}
				}
			} else {
				// complete existing browser session if any
				endBrowserSession()
				result.push(message)
			}
		} else {
			result.push(message)
		}
	})

	// Handle case where browser session is the last group
	if (currentGroup.length > 0) {
		result.push([...currentGroup])
	}

	return result
}

/**
 * Get the task message from the messages array
 */
export function getTaskMessage(messages: ClineMessage[]): ClineMessage | undefined {
	return messages.at(0)
}

/**
 * Check if we should show the scroll to bottom button
 */
export function shouldShowScrollButton(disableAutoScroll: boolean, isAtBottom: boolean): boolean {
	return disableAutoScroll && !isAtBottom
}

/**
 * Find reasoning content associated with an api_req_started message.
 * Also returns whether response content (non-reasoning) has started.
 */
export function findReasoningForApiReq(
	apiReqTs: number,
	allMessages: ClineMessage[],
): { reasoning: string | undefined; responseStarted: boolean } {
	const apiReqIndex = allMessages.findIndex((m) => m.ts === apiReqTs && m.say === "api_req_started")
	if (apiReqIndex === -1) {
		return { reasoning: undefined, responseStarted: false }
	}

	// Collect reasoning and check if response content has started
	const reasoningParts: string[] = []
	let responseStarted = false

	for (let i = apiReqIndex + 1; i < allMessages.length; i++) {
		const msg = allMessages[i]
		// Stop at next api_req_started
		if (msg.say === "api_req_started") {
			break
		}
		// Collect reasoning content
		if (msg.say === "reasoning" && msg.text) {
			reasoningParts.push(msg.text)
		}
		// Check if non-reasoning response content has started (text, tool calls, etc.)
		if (msg.say === "text" || msg.say === "tool" || msg.ask === "tool" || msg.ask === "command" || msg.say === "command") {
			responseStarted = true
		}
	}

	return {
		reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : undefined,
		responseStarted,
	}
}

/**
 * Find the API request info for a checkpoint message.
 * Looks backwards from the checkpoint to find the preceding api_req_started.
 * Returns cost and request content.
 */
export function findApiReqInfoForCheckpoint(
	checkpointTs: number,
	allMessages: ClineMessage[],
): { cost: number | undefined; request: string | undefined } {
	const checkpointIndex = allMessages.findIndex((m) => m.ts === checkpointTs && m.say === "checkpoint_created")
	if (checkpointIndex === -1) {
		return { cost: undefined, request: undefined }
	}

	// Look backwards for the most recent api_req_started
	for (let i = checkpointIndex - 1; i >= 0; i--) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				return {
					cost: info.cost,
					request: info.request,
				}
			} catch {
				return { cost: undefined, request: undefined }
			}
		}
	}
	return { cost: undefined, request: undefined }
}

/**
 * Check if a checkpoint at the given index would be displayed (not absorbed into a tool group).
 * A checkpoint is absorbed if it's PRECEDED by low-stakes tools (meaning we're in a tool group).
 * A checkpoint is displayed if it's preceded by non-tool content (meaning no active tool group).
 */
function isDisplayedCheckpoint(checkpointIndex: number, allMessages: ClineMessage[]): boolean {
	// Look BACKWARDS to see if we're in a tool group
	// A checkpoint is absorbed if the previous meaningful content was a low-stakes tool
	for (let i = checkpointIndex - 1; i >= 0; i--) {
		const msg = allMessages[i]

		// Skip api_req messages - they don't affect tool group status
		if (msg.say === "api_req_started" || msg.say === "api_req_finished") {
			continue
		}

		// Skip reasoning messages
		if (msg.say === "reasoning") {
			continue
		}

		// Skip other checkpoints - they don't end tool groups
		if (msg.say === "checkpoint_created") {
			continue
		}

		// If preceded by a low-stakes tool, this checkpoint is in the tool group (absorbed)
		if (msg.say === "tool" || msg.ask === "tool") {
			try {
				const tool = JSON.parse(msg.text || "{}") as ClineSayTool
				if (LOW_STAKES_TOOLS.has(tool.tool)) {
					return false // absorbed into tool group
				}
			} catch {
				// Can't parse, treat as displayed
			}
		}

		// Any other content before this checkpoint ends the tool group, so this is displayed
		return true
	}

	// Start of messages - checkpoint is displayed (no preceding tool group)
	return true
}

/**
 * Find the total cost for the segment starting at a checkpoint.
 * Looks FORWARD from the checkpoint to the next DISPLAYED checkpoint (skipping absorbed ones).
 * Sums all api_req_started costs in between.
 * Returns undefined if the segment is incomplete (no next displayed checkpoint yet).
 */
export function findNextSegmentCost(checkpointTs: number, allMessages: ClineMessage[]): number | undefined {
	const checkpointIndex = allMessages.findIndex((m) => m.ts === checkpointTs && m.say === "checkpoint_created")
	if (checkpointIndex === -1) {
		return undefined
	}
	// Find the next DISPLAYED checkpoint (skip absorbed ones)
	let nextDisplayedCheckpointIndex = -1
	for (let i = checkpointIndex + 1; i < allMessages.length; i++) {
		if (allMessages[i].say === "checkpoint_created") {
			if (isDisplayedCheckpoint(i, allMessages)) {
				nextDisplayedCheckpointIndex = i
				break
			}
			// Otherwise continue looking for next displayed checkpoint
		}
	}

	// If no next displayed checkpoint, sum to end of messages (in-progress segment)
	const endIndex = nextDisplayedCheckpointIndex === -1 ? allMessages.length : nextDisplayedCheckpointIndex

	// Sum all api_req_started costs between this checkpoint and the end
	let totalCost = 0
	for (let i = checkpointIndex + 1; i < endIndex; i++) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				if (typeof info.cost === "number") {
					totalCost += info.cost
				}
			} catch {
				// ignore parse errors
			}
		}
	}

	return totalCost > 0 ? totalCost : undefined
}

/**
 * Check if a text message's associated API request is still in progress.
 * Returns true if there's no cost yet on the parent api_req_started.
 */
export function isTextMessagePendingToolCall(textTs: number, allMessages: ClineMessage[]): boolean {
	// Find the api_req_started that precedes this text message
	const textIndex = allMessages.findIndex((m) => m.ts === textTs)
	if (textIndex === -1) {
		return false
	}

	// Look backwards for the most recent api_req_started
	for (let i = textIndex - 1; i >= 0; i--) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				// If no cost, the request is still in progress
				return info.cost == null
			} catch {
				return false
			}
		}
	}
	return false
}

/**
 * Check if a tool group should be hidden because its tools are currently being
 * displayed in the loading state animation.
 *
 * Returns true ONLY when:
 * 1. The MOST RECENT api_req_started overall has no cost (loading state is active)
 * 2. This tool group falls in the "current activities" range (between the previous
 *    completed api_req and the current one)
 *
 * This mirrors the ChatRow currentActivities logic - we only hide tools that are
 * actively being shown in the loading state, not older tool groups.
 */
export function isToolGroupInFlight(toolGroupMessages: ClineMessage[], allMessages: ClineMessage[]): boolean {
	if (toolGroupMessages.length === 0) {
		return false
	}
	// Step 1: Find the MOST RECENT api_req_started overall (search backwards)
	let mostRecentApiReq: ClineMessage | null = null
	let mostRecentApiReqIndex = -1
	for (let i = allMessages.length - 1; i >= 0; i--) {
		if (allMessages[i].say === "api_req_started") {
			mostRecentApiReq = allMessages[i]
			mostRecentApiReqIndex = i
			break
		}
	}

	if (!mostRecentApiReq?.text) {
		return false
	}
	// Step 2: Check if it's in "pre" state (no cost = loading state active)
	try {
		const info = JSON.parse(mostRecentApiReq.text)
		if (info.cost != null) {
			// Loading state is NOT active - show all tool groups in ToolGroupRenderer
			return false
		}
	} catch {
		return false
	}

	// Step 3: Loading state IS active. Find the previous COMPLETED api_req.
	let prevCompletedApiReqIndex = -1
	for (let i = mostRecentApiReqIndex - 1; i >= 0; i--) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const prevInfo = JSON.parse(msg.text)
				if (prevInfo.cost != null) {
					prevCompletedApiReqIndex = i
					break
				}
			} catch {
				/* continue searching */
			}
		}
	}

	// If no previous completed api_req, there's no "current activities" range.
	// ChatRow's currentActivities returns empty in this case, so don't hide the tool group.
	if (prevCompletedApiReqIndex === -1) {
		return false
	}

	// Step 4: Check if any tool in this group falls in the "current activities" range
	const lastTool = [...toolGroupMessages].reverse().find((m) => isLowStakesTool(m))
	if (!lastTool) {
		return false
	}

	const toolIndex = allMessages.findIndex((m) => m.ts === lastTool.ts)
	if (toolIndex === -1) {
		return false
	}

	// Tool is in the "current activities" range if it's AFTER prevCompleted and BEFORE current
	const isInCurrentActivitiesRange = toolIndex > prevCompletedApiReqIndex && toolIndex < mostRecentApiReqIndex

	return isInCurrentActivitiesRange
}

/**
 * Filter a tool group to exclude tools that are in the "current activities" range.
 * Returns the filtered array of messages (may be empty).
 *
 * This is used so ToolGroupRenderer shows PAST tools (what's already in context),
 * while the loading state shows ACTIVE tools (what's being "read" now).
 */
export function getToolsNotInCurrentActivities(toolGroupMessages: ClineMessage[], allMessages: ClineMessage[]): ClineMessage[] {
	// Step 1: Find the MOST RECENT api_req_started overall (search backwards)
	let mostRecentApiReqIndex = -1
	for (let i = allMessages.length - 1; i >= 0; i--) {
		if (allMessages[i].say === "api_req_started") {
			mostRecentApiReqIndex = i
			break
		}
	}

	if (mostRecentApiReqIndex === -1) {
		return toolGroupMessages
	}

	// Step 2: Check if it's in "pre" state (no cost = loading state active)
	const mostRecentApiReq = allMessages[mostRecentApiReqIndex]
	if (!mostRecentApiReq?.text) {
		return toolGroupMessages
	}

	let isLoadingStateActive = false
	try {
		const info = JSON.parse(mostRecentApiReq.text)
		isLoadingStateActive = info.cost == null
	} catch {
		return toolGroupMessages
	}

	if (!isLoadingStateActive) {
		// Loading state is NOT active - show all tools
		return toolGroupMessages
	}

	// Step 3: Loading state IS active. Find the previous COMPLETED api_req.
	let prevCompletedApiReqIndex = -1
	for (let i = mostRecentApiReqIndex - 1; i >= 0; i--) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const prevInfo = JSON.parse(msg.text)
				if (prevInfo.cost != null) {
					prevCompletedApiReqIndex = i
					break
				}
			} catch {
				/* continue searching */
			}
		}
	}

	// If no previous completed api_req, there's no "current activities" range
	if (prevCompletedApiReqIndex === -1) {
		return toolGroupMessages
	}

	// Step 4: Filter out tools that are in the "current activities" range
	return toolGroupMessages.filter((msg) => {
		// Only filter tool messages
		if (!isLowStakesTool(msg)) {
			return true
		}

		const toolIndex = allMessages.findIndex((m) => m.ts === msg.ts)
		if (toolIndex === -1) {
			return true
		}

		// Tool is in "current activities" range if AFTER prevCompleted AND BEFORE current
		const isInCurrentActivitiesRange = toolIndex > prevCompletedApiReqIndex && toolIndex < mostRecentApiReqIndex

		// Keep only if NOT in current activities range
		return !isInCurrentActivitiesRange
	})
}

/**
 * Returns true if this api_req_started should be fully absorbed into a low-stakes tool group.
 *
 * This scans FORWARD from the api_req_started until the next api_req_started and checks:
 * - at least one low-stakes tool exists
 * - no high-stakes tool/command exists
 *
 * Note: this operates on a flat `ClineMessage[]` (e.g. `modifiedMessages`) rather than
 * grouped messages. It is used at render time to avoid transient UI frames where
 * `api_req_started` briefly appears before grouping absorbs it.
 */
export function isApiReqAbsorbable(apiReqTs: number, allMessages: ClineMessage[]): boolean {
	const apiReqIndex = allMessages.findIndex((m) => m.ts === apiReqTs && m.say === "api_req_started")
	if (apiReqIndex === -1) {
		return false
	}

	let hasLowStakesTool = false
	for (let i = apiReqIndex + 1; i < allMessages.length; i++) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started") {
			break
		}

		// Reasoning and checkpoints do not affect absorbability
		if (msg.say === "reasoning" || msg.say === "checkpoint_created") {
			continue
		}

		// Text is allowed (we still want to absorb api_req into the tool group)
		if (msg.say === "text") {
			continue
		}

		// Low-stakes tools mark absorbability
		if (isLowStakesTool(msg)) {
			hasLowStakesTool = true
			continue
		}

		// Any other tool/command is considered high-stakes; do not absorb
		if (msg.say === "tool" || msg.ask === "tool" || msg.say === "command" || msg.ask === "command") {
			return false
		}
	}

	return hasLowStakesTool
}

/**
 * Check if an api_req_started at a given index produces low-stakes tools
 * (regardless of whether it also produces text).
 * If so, it should be absorbed into the tool group rather than rendered separately.
 * The key is: no HIGH-stakes tools (write, edit, command, etc.)
 */
function isApiReqFollowedOnlyByLowStakesTools(index: number, messages: (ClineMessage | ClineMessage[])[]): boolean {
	let hasLowStakesTool = false
	for (let i = index + 1; i < messages.length; i++) {
		const item = messages[i]
		if (Array.isArray(item)) {
			// Browser session - this ends the low-stakes run
			break
		}
		const msg = item
		// Another api_req_started - stop checking
		if (msg.say === "api_req_started") {
			break
		}
		// Reasoning is allowed
		if (msg.say === "reasoning") {
			continue
		}
		// Low-stakes tool - mark it
		if (isLowStakesTool(msg)) {
			hasLowStakesTool = true
			continue
		}
		// Checkpoint is OK
		if (msg.say === "checkpoint_created") {
			continue
		}
		// Text is OK - it will render separately, but we still absorb api_req
		if (msg.say === "text") {
			continue
		}
		// High-stakes tool (write, edit, command, etc.) - don't absorb
		if (msg.say === "tool" || msg.ask === "tool" || msg.ask === "command" || msg.say === "command") {
			return false
		}
	}
	return hasLowStakesTool
}

/**
 * Group consecutive low-stakes tools (and their reasoning) into arrays.
 * Also filters out checkpoints that follow low-stakes tool groups.
 * Absorbs api_req_started messages that are followed only by low-stakes tools.
 * Only creates tool groups when there's at least one actual tool - reasoning-only groups are dropped.
 * Should be called after groupMessages.
 */
export function groupLowStakesTools(groupedMessages: (ClineMessage | ClineMessage[])[]): (ClineMessage | ClineMessage[])[] {
	const result: (ClineMessage | ClineMessage[])[] = []
	let toolGroup: ClineMessage[] = []
	let pendingReasoning: ClineMessage[] = []
	let pendingApiReq: ClineMessage[] = []
	let hasTools = false
	const pendingTools: ClineMessage[] = []

	const flushPending = () => {
		pendingApiReq.forEach((m) => result.push(m))
		pendingApiReq = []
		pendingReasoning = []
	}

	const commitToolGroup = () => {
		if (toolGroup.length > 0 && hasTools) {
			const group = toolGroup as ClineMessage[] & { _isToolGroup: boolean }
			group._isToolGroup = true
			result.push(group)
			pendingReasoning = []
			pendingApiReq = []
		}
		toolGroup = []
		hasTools = false
	}

	const absorbPending = () => {
		if (pendingApiReq.length > 0) {
			toolGroup.push(...pendingApiReq)
			pendingApiReq = []
		}
		if (pendingReasoning.length > 0) {
			toolGroup.push(...pendingReasoning)
			pendingReasoning = []
		}
	}

	for (let i = 0; i < groupedMessages.length; i++) {
		const item = groupedMessages[i]

		// Browser session group - commit current work and pass through
		if (Array.isArray(item)) {
			commitToolGroup()
			flushPending()
			result.push(item)
			continue
		}

		const message = item
		const messageType = message.say
		const isLast = i === groupedMessages.length - 1

		// Low-stakes tool - absorb pending and add to group
		if (isLowStakesTool(message)) {
			absorbPending()
			hasTools = true
			toolGroup.push(message)
			// If the streaming has stopped and the last message is still an ask,
			// this means the tool requires user approval - show the old tool block UI.
			if (message.type === "ask" && !message.partial && isLast) {
				pendingTools.push(message)
			}
			continue
		}

		// Reasoning - add to group if active, otherwise queue
		if (messageType === "reasoning") {
			if (hasTools) {
				toolGroup.push(message)
			} else {
				pendingReasoning.push(message)
			}
			continue
		}

		// API request - absorb if followed by low-stakes tools, otherwise render
		if (messageType === "api_req_started") {
			if (isApiReqFollowedOnlyByLowStakesTools(i, groupedMessages)) {
				absorbPending()
				pendingApiReq.push(message)
			} else {
				commitToolGroup()
				flushPending()
				result.push(message)
			}
			continue
		}

		// Checkpoint - absorb into active tool group
		if (messageType === "checkpoint_created" && hasTools) {
			toolGroup.push(message)
			continue
		}

		// Text - render separately, keep pending for potential future tools
		if (messageType === "text") {
			result.push(message)
			continue
		}

		// Everything else - commit group, flush pending, and render
		commitToolGroup()
		flushPending()
		result.push(message)
	}

	// Finalize any remaining work
	commitToolGroup()
	flushPending()

	if (pendingTools.length > 0) {
		result.push(...pendingTools)
	}

	return result
}

export function getIconByToolName(toolName: string) {
	switch (toolName) {
		case "readFile":
			return FileIcon
		case "listFilesTopLevel":
			return FolderOpenIcon
		case "listFilesRecursive":
			return FolderOpenDotIcon
		case "searchFiles":
			return SearchIcon
		case "listCodeDefinitionNames":
			return ShapesIcon
		default:
			return WrenchIcon
	}
}
