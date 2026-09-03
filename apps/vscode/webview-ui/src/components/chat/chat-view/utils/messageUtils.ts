/**
 * Utility functions for message filtering, grouping, and manipulation
 */

import type {
	ClineAskQuestion,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSayAutoRecovery,
	ClineSayBrowserAction,
	ClineSayTool,
	TurnPhase,
} from "@shared/ExtensionMessage"
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
	return Array.isArray(item) && (item as ClineMessage[] & { _isToolGroup?: boolean })._isToolGroup === true
}

function isDuplicateAskOptionEcho(message: ClineMessage, previousMessage: ClineMessage | undefined): boolean {
	if (
		message.type !== "say" ||
		message.say !== "user_feedback" ||
		(message.images?.length ?? 0) > 0 ||
		(message.files?.length ?? 0) > 0 ||
		previousMessage?.type !== "ask" ||
		(previousMessage.ask !== "followup" && previousMessage.ask !== "plan_mode_respond")
	) {
		return false
	}

	const responseText = message.text ?? ""
	if (!responseText) {
		return false
	}

	try {
		const parsed = JSON.parse(previousMessage.text || "{}") as ClineAskQuestion | ClinePlanModeResponse
		if (!parsed.options?.includes(responseText)) {
			return false
		}

		return parsed.selected === undefined || parsed.selected === responseText
	} catch {
		return false
	}
}

function isVisibleCheckpointUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

function isCheckpointAnswerMessage(messages: ClineMessage[], index: number): boolean {
	const message = messages[index]
	if (message?.type !== "say" || message.say !== "user_feedback") {
		return false
	}

	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const previous = messages[cursor]
		if (previous.say === "checkpoint_created") {
			continue
		}
		if (previous.type === "ask") {
			return previous.ask === "followup" || previous.ask === "mistake_limit_reached"
		}
		if (isVisibleCheckpointUserMessage(previous)) {
			return false
		}
	}

	return false
}

export function canRestoreWorkspaceFromMessage(messages: ClineMessage[], messageTs: number | undefined): boolean {
	if (messageTs === undefined) {
		return false
	}
	const index = messages.findIndex((message) => message.ts === messageTs)
	if (index === -1) {
		return false
	}
	return isVisibleCheckpointUserMessage(messages[index]) && !isCheckpointAnswerMessage(messages, index)
}

/**
 * Parse the JSON payload of a say:"auto_recovery" marker message; undefined
 * when the text is missing, malformed, or carries an unknown status.
 */
const AUTO_RECOVERY_STATUSES = new Set(["countdown", "retrying", "settled"])

export function parseAutoRecoveryPayload(text: string | undefined): ClineSayAutoRecovery | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text) as ClineSayAutoRecovery
		return parsed && typeof parsed.status === "string" && AUTO_RECOVERY_STATUSES.has(parsed.status) ? parsed : undefined
	} catch {
		return undefined
	}
}

/**
 * Messages that render as an error block in the chat and can carry the
 * auto-recovery glyph in place of the default dark-gray exclamation mark.
 */
export function isErrorBlockMessage(message: ClineMessage): boolean {
	if (message.type === "say" && message.say === "error") {
		return true
	}
	if (message.type === "ask" && message.ask === "mistake_limit_reached") {
		return true
	}
	if (message.type === "say" && message.say === "api_req_started") {
		try {
			const info = JSON.parse(message.text || "{}") as { cancelReason?: string; streamingFailedMessage?: string }
			return Boolean(info.cancelReason || info.streamingFailedMessage)
		} catch {
			return false
		}
	}
	return false
}

/**
 * Where an active auto-recovery marker surfaces: the nearest error block AT OR
 * BEFORE the marker gets its exclamation glyph swapped for the live countdown
 * ring (status "countdown") / spinner (status "retrying"). One block, one glyph
 * swap — the error text stays frozen for the whole streak.
 */
export interface ActiveRecoveryDecoration {
	/** ts of the say:"auto_recovery" marker (the marker itself never renders). */
	markerTs: number
	/** ts of the error block whose glyph slot shows the ring/spinner. */
	targetTs: number
	payload: ClineSayAutoRecovery
}

/**
 * Phases in which a live-looking recovery marker genuinely drives the UI: the
 * countdown is running ("retrying") or the retried attempt is in flight
 * ("streaming"). Every other phase means no recovery action is happening — a
 * marker still saying "countdown"/"retrying" is stale (task cancelled or
 * cleared, session switched, turn settled permanently) and must render as the
 * plain exclamation glyph, never as a timer/spinner.
 */
const RECOVERY_LIVE_PHASES = new Set<TurnPhase>(["streaming", "retrying"])

/**
 * A "countdown" marker whose scheduled fire time is this far in the past is
 * stale: the retry timer flips the marker to "retrying" at (or within
 * milliseconds of) retryAt, so a countdown still sitting in the message list
 * long after its fire time can only be stranded — a backend path that
 * cancelled the streak without settling the marker. The grace window is
 * generous on purpose (a sleeping machine wakes with the timer callback still
 * pending, and the ring legitimately displays up to the fire time), so this
 * only trips when no legitimate countdown can still be running. "retrying"
 * markers carry no reliable timestamp (retryAt is cleared) and are not
 * time-gated; the backend settles those on every terminal path.
 */
const STALE_COUNTDOWN_GRACE_MS = 120_000

function isStaleCountdownMarker(payload: ClineSayAutoRecovery | undefined): boolean {
	return (
		payload?.status === "countdown" &&
		payload.retryAt !== undefined &&
		Date.now() - payload.retryAt > STALE_COUNTDOWN_GRACE_MS
	)
}

export function findActiveRecoveryDecoration(messages: ClineMessage[], phase?: TurnPhase): ActiveRecoveryDecoration | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.type !== "say" || message.say !== "auto_recovery") {
			continue
		}
		const payload = parseAutoRecoveryPayload(message.text)
		if (isStaleCountdownMarker(payload)) {
			// Self-heal: render as settled — plain glyph, no hold, no
			// Cancel-only footer — instead of trusting a stranded marker and
			// hiding rows below the frozen error block forever.
			return undefined
		}
		if (!payload || (payload.status !== "countdown" && payload.status !== "retrying")) {
			// The nearest marker from the tail is settled — nothing to decorate.
			return undefined
		}
		if (phase !== undefined && !RECOVERY_LIVE_PHASES.has(phase)) {
			// Live-looking marker, but no recovery action is in flight. Treat it
			// as stale: the error block keeps its plain exclamation glyph and no
			// rows are held back. (No phase passed — legacy caller: the marker
			// rules the display, as before.)
			return undefined
		}
		for (let j = i - 1; j >= 0; j--) {
			const candidate = messages[j]
			if (candidate.type === "say" && candidate.say === "auto_recovery") {
				// A previous streak's marker bounds the search: this streak's
				// error block must sit after it. Reaching past it would decorate
				// — and hold the chat at — an error block from older history;
				// this streak's own error row is missing, so decorate nothing.
				break
			}
			if (isErrorBlockMessage(candidate)) {
				return { markerTs: message.ts, targetTs: candidate.ts, payload }
			}
		}
		// Active marker with no error block of its own to decorate.
		return undefined
	}
	return undefined
}

/**
 * Truncate the visible list right after the error block that carries the live
 * recovery glyph (see findActiveRecoveryDecoration). Rows after it belong to
 * the attempt being retried — streaming text, tool rows, the say:"compaction"
 * divider, bookkeeping — and NONE of them may render below the frozen error
 * block while the streak's outcome is unknown. The caller (see
 * applyActiveRecoveryHold) gates this on the marker's liveness alone: the hold
 * spans the countdown AND the in-flight retry, releasing only when the marker
 * settles (an attempt finally succeeded). Rows after a settled marker (or with
 * no marker at all) are historical and stay.
 */
export function hideRowsAfterActiveRecovery(messages: ClineMessage[], targetTs: number): ClineMessage[] {
	const targetIndex = messages.findIndex((message) => message.ts === targetTs)
	if (targetIndex === -1) {
		return messages
	}
	return messages.slice(0, targetIndex + 1)
}

/**
 * Policy layer for hideRowsAfterActiveRecovery: while an auto-recovery streak
 * is live (marker status "countdown" or "retrying"), the decorated error block
 * is the bottom of the rendered conversation — EVERY row after it is held
 * back, no matter the type, until the streak settles on a successful attempt.
 * Deliberately phase-independent: the backend's TurnState phase flaps between
 * "retrying" and "streaming" (and transiently "error") across a streak, so a
 * phase-gated hold would blink open exactly while the retried attempt streams
 * — leaking rows like the "Auto compacting context" divider below the frozen
 * error. Same philosophy as the Cancel-only footer config: gate on the marker,
 * never on the phase.
 */
export function applyActiveRecoveryHold(
	filtered: ClineMessage[],
	activeRecovery: ActiveRecoveryDecoration | undefined,
): ClineMessage[] {
	return activeRecovery ? hideRowsAfterActiveRecovery(filtered, activeRecovery.targetTs) : filtered
}

export function filterVisibleMessages(messages: ClineMessage[]): ClineMessage[] {
	return messages.filter((message, index, arr) => {
		if (isDuplicateAskOptionEcho(message, arr[index - 1])) {
			return false
		}

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
			case "use_subagents":
				if (arr.slice(index + 1).some((candidate) => candidate.type === "say" && candidate.say === "subagent")) {
					return false
				}
				break
		}
		switch (message.say) {
			case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
			case "deleted_api_reqs": // aggregated api_req metrics from deleted messages
			case "subagent_usage": // aggregated subagent usage metrics for task-level accounting
			case "task_progress": // task progress messages are displayed in TaskHeader, not in main chat
			case "checkpoint_created": // checkpoint restore is exposed from user-message edit controls
			case "auto_recovery": // invisible marker: decorates the error block's glyph instead of rendering a row
				return false
			// NOTE: reasoning passes through to be included in tool groups
			case "api_req_started": {
				// api_req_started rows only render visible content for errors/cancels.
				// Reasoning has its own standalone ChatRows. Everything else renders
				// as invisible padding. Filter out unless there's an error.
				try {
					const info = JSON.parse(message.text || "{}")
					if (info.cancelReason || info.streamingFailedMessage) {
						break // keep - has error content
					}
				} catch {
					break // keep on parse error to be safe
				}
				return false
			}
			case "text":
				// Sometimes cline returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
				if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				break
			case "mcp_server_request_started":
				return false
			case "use_subagents":
				if (arr.slice(index + 1).some((candidate) => candidate.type === "say" && candidate.say === "subagent")) {
					return false
				}
				break
		}
		return true
	})
}

/**
 * Check if a message is part of a browser session
 */
function isBrowserSessionMessage(message: ClineMessage): boolean {
	if (message.type === "ask") {
		return message.ask === "browser_action_launch"
	}
	if (message.type === "say") {
		return [
			"browser_action_launch",
			"api_req_started",
			"text",
			"browser_action",
			"browser_action_result",
			"reasoning",
		].includes(message.say ?? "")
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

	for (const message of visibleMessages) {
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
						continue
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
	}

	// Handle case where browser session is the last group
	if (currentGroup.length > 0) {
		result.push([...currentGroup])
	}

	return result
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
 * Filter a tool group to exclude tools that are in the "current activities" range.
 * Returns the filtered array of messages (may be empty).
 *
 * This is used so ToolGroupRenderer shows PAST tools (what's already in context),
 * while the loading state shows ACTIVE tools (what's being "read" now).
 *
 * "Current activities" includes:
 * - (Case A) Tools between a previous completed api_req and the current incomplete api_req
 * - (Case B) Tools after the most recent api_req overall (either because it's complete, or no loading state is active yet)
 */
export function getToolsNotInCurrentActivities(toolGroupMessages: ClineMessage[], allMessages: ClineMessage[]): ClineMessage[] {
	// Build a Map of timestamp -> index for O(1) lookups instead of O(n) findIndex calls
	const tsToIndex = new Map<number, number>()
	for (let i = 0; i < allMessages.length; i++) {
		tsToIndex.set(allMessages[i].ts, i)
	}

	// Step 1: Find the MOST RECENT api_req_started overall (search backwards)
	let mostRecentApiReqIndex = -1
	let mostRecentApiReq: ClineMessage | null = null
	for (let i = allMessages.length - 1; i >= 0; i--) {
		if (allMessages[i].say === "api_req_started") {
			mostRecentApiReqIndex = i
			mostRecentApiReq = allMessages[i]
			break
		}
	}

	if (mostRecentApiReqIndex === -1) {
		// No api_req at all - show all tools
		return toolGroupMessages
	}

	if (!mostRecentApiReq?.text) {
		return toolGroupMessages
	}

	// Step 2: Determine if most recent api_req is complete (has cost) or incomplete (no cost)
	let mostRecentHasCost = false
	try {
		const info = JSON.parse(mostRecentApiReq.text)
		mostRecentHasCost = info.cost != null
	} catch {
		return toolGroupMessages
	}

	// Step 3: Determine which tools are "in current activities"
	if (!mostRecentHasCost) {
		// CASE A: Most recent api_req is INCOMPLETE (loading state active)
		// Tools are in-flight if they're between prev completed api_req and current incomplete one

		// Find the previous COMPLETED api_req
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

		if (prevCompletedApiReqIndex === -1) {
			// No previous completed api_req, so no tools are in the "current activities" range
			return toolGroupMessages
		}

		// Filter out tools in the range (prevCompleted, current)
		return toolGroupMessages.filter((msg) => {
			// Keep non-low-stakes tools
			if (!isLowStakesTool(msg)) {
				return true
			}

			// Filter out only tools awaiting approval (ask === 'tool')
			// Completed tools (say === 'tool') should still be shown
			if (msg.ask === "tool") {
				const toolIndex = tsToIndex.get(msg.ts)
				if (toolIndex === undefined) {
					return true
				}
				// Tool is in "current activities" range if AFTER prevCompleted AND BEFORE current
				const isInCurrentActivitiesRange = toolIndex > prevCompletedApiReqIndex && toolIndex < mostRecentApiReqIndex
				// Filter out if in current activities range
				return !isInCurrentActivitiesRange
			}

			// Keep completed tools (say === 'tool')
			return true
		})
	}
	// CASE B: Most recent api_req is COMPLETE (has cost)
	// Tools that appear AFTER this completed api_req are "in flight" (just arrived)
	// Filter them out so they appear in currentActivities instead

	return toolGroupMessages.filter((msg) => {
		// Keep non-low-stakes tools
		if (!isLowStakesTool(msg)) {
			return true
		}

		// Filter out only tools awaiting approval (ask === 'tool')
		// Completed tools (say === 'tool') should still be shown
		if (msg.ask === "tool") {
			const toolIndex = tsToIndex.get(msg.ts)
			if (toolIndex === undefined) {
				return true
			}
			// Tool is in "current activities" if it appears AFTER the most recent api_req
			const isInCurrentActivitiesRange = toolIndex > mostRecentApiReqIndex
			// Filter out if in current activities range
			return !isInCurrentActivitiesRange
		}

		// Keep completed tools (say === 'tool')
		return true
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
	let hasReasoning = false
	for (let i = apiReqIndex + 1; i < allMessages.length; i++) {
		const msg = allMessages[i]
		if (msg.say === "api_req_started") {
			break
		}

		// Reasoning - mark it but don't absorb if present
		if (msg.say === "reasoning") {
			hasReasoning = true
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

	// Don't absorb if there's reasoning - we want to show "Thoughts >"
	return hasLowStakesTool && !hasReasoning
}

/**
 * Check if an api_req_started at a given index produces low-stakes tools
 * (regardless of whether it also produces text).
 * If so, it should be absorbed into the tool group rather than rendered separately.
 * The key is: no HIGH-stakes tools (write, edit, command, etc.) AND no reasoning
 */
function isApiReqFollowedOnlyByLowStakesTools(index: number, messages: (ClineMessage | ClineMessage[])[]): boolean {
	let hasLowStakesTool = false
	let hasReasoning = false
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
		// Reasoning - mark it but don't absorb if present
		if (msg.say === "reasoning") {
			hasReasoning = true
			continue
		}
		// Low-stakes tool - mark it
		if (isLowStakesTool(msg)) {
			hasLowStakesTool = true
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
	// Don't absorb if there's reasoning - we want to show "Thoughts >"
	return hasLowStakesTool && !hasReasoning
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
		pendingApiReq.forEach((m) => {
			result.push(m)
		})
		pendingReasoning.forEach((m) => {
			result.push(m)
		})
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
			// Keep reasoning visible as its own row when it happens before a tool group.
			// If we absorb it into the group, ToolGroupRenderer hides it entirely.
			if (!hasTools && pendingReasoning.length > 0) {
				flushPending()
			}
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

		// Text - if a low-stakes tool group is active, finalize it first,
		// then render the text as a normal chat row. This ensures post-tool
		// summaries (common in SDK/native-tool-call flows) are visible.
		if (messageType === "text") {
			if (hasTools) {
				commitToolGroup()
			}
			flushPending()
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
