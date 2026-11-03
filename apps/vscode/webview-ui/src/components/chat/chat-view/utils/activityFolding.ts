/**
 * Folding of agent activities in the chat window.
 *
 * The chat used to be dominated by agent bookkeeping: reads, searches, command executions,
 * diffs and thinking blocks, each rendered as a full-height block. This module turns every run
 * of consecutive activity rows into a single foldable "activity group" so that the actual
 * conversation (user prompts + assistant answers) stays scannable.
 *
 * A group shows only what is happening right now: every row that is still streaming renders, and
 * each of them folds away the moment it completes, so the fold never grows into a wall of finished
 * bookkeeping. Its header carries the running total of everything the group has done. Users can
 * always override a fold by clicking its header; the override is remembered per group (keyed by
 * {@link getActivityGroupKey}).
 *
 * The grouping runs *after* `groupLowStakesTools`, so an activity group may contain nested
 * groups (tool groups). Everything that consumes the rendered list must therefore use the
 * flatten helpers below instead of assuming a flat `ClineMessage[]`.
 */

import type { ClineAsk, ClineMessage, ClineSay, ClineSayTool, TurnPhase } from "@shared/ExtensionMessage"
import { isToolGroup } from "./messageUtils"

/** One entry of the rendered chat list: a single row, a nested group, or an activity fold. */
export type ChatListItem = ClineMessage | ChatListItem[]

/** A run of consecutive activity rows, collapsed into a single foldable entry. */
export type ActivityGroup = ChatListItem[] & { _isActivityGroup?: true }

/**
 * `say` types that are agent bookkeeping rather than conversation. Anything not listed here
 * (assistant `text`, `task`, `user_feedback`, errors, completion results, ...) stays visible.
 */
const ACTIVITY_SAYS = new Set<ClineSay>([
	"api_req_started",
	"reasoning",
	"tool",
	"command",
	"command_output",
	"browser_action",
	"browser_action_result",
	"use_mcp_server",
	"mcp_server_response",
	"mcp_notification",
	"load_mcp_documentation",
	"subagent",
	"use_subagents",
	"hook_status",
	"hook_output_stream",
	"conditional_rules_applied",
	"compaction",
	"cloud_provisioning",
	"shell_integration_warning",
	"shell_integration_warning_with_suggestion",
	"command_permission_denied",
])

/** `ask` types the agent emits while working. Approval prompts live in here on purpose. */
const ACTIVITY_ASKS = new Set<ClineAsk>([
	"tool",
	"command",
	"command_output",
	"use_mcp_server",
	"use_subagents",
	"browser_action_launch",
	"summarize_task",
	"condense",
])

/**
 * An `api_req_started` row that carries a cancel/streaming-failure notice renders as a real
 * error banner. Those must never be hidden inside a fold.
 */
function isCancellationNotice(message: ClineMessage): boolean {
	if (message.say !== "api_req_started" || !message.text) {
		return false
	}
	try {
		const info = JSON.parse(message.text) as { cancelReason?: string; streamingFailedMessage?: string }
		return info.cancelReason != null || info.streamingFailedMessage != null
	} catch {
		return false
	}
}

/**
 * A *completed* `api_req_started` row (it carries its `cost`) is pure usage bookkeeping:
 * `RequestStartRow` derives `apiReqState === "final"`, which switches off the activity,
 * streaming-thinking and error branches, so the row renders an empty `<div>`.
 *
 * Folding such a row must not create a group on its own: a fold is a visible summary line, and
 * that would materialise a row where upstream shows nothing — most visibly right below the green
 * completion box, which made the final answer stop reading as the end of the turn.
 */
export function isSilentActivityMessage(message: ClineMessage): boolean {
	if (message.say !== "api_req_started" || !message.text || isCancellationNotice(message)) {
		return false
	}
	try {
		const info = JSON.parse(message.text) as { cost?: number }
		return info.cost != null
	} catch {
		return false
	}
}

/** Whether a single chat row is agent activity that may be folded away. */
export function isAgentActivityMessage(message: ClineMessage): boolean {
	if (message.type === "say") {
		if (!message.say || !ACTIVITY_SAYS.has(message.say)) {
			return false
		}
		return !isCancellationNotice(message)
	}
	if (message.type === "ask") {
		return message.ask != null && ACTIVITY_ASKS.has(message.ask)
	}
	return false
}

/**
 * Whether an item of the rendered list is foldable. Nested tool groups count as activity (they
 * are nothing but tool rows); browser session groups stay visible as they own their own UI.
 */
export function isAgentActivityItem(item: ChatListItem): boolean {
	if (Array.isArray(item)) {
		return isToolGroup(item as ClineMessage[])
	}
	return isAgentActivityMessage(item)
}

/** Marker check for the arrays produced by {@link groupAgentActivities}. */
export function isActivityGroup(item: ChatListItem): item is ActivityGroup {
	return Array.isArray(item) && (item as ActivityGroup)._isActivityGroup === true
}

/**
 * Collapse every run of consecutive activity rows into a single group. Rows that are part of the
 * conversation (assistant text, user messages, errors, completion results) act as boundaries.
 *
 * @param items output of `groupLowStakesTools(groupMessages(visibleMessages))`
 * @param options.enabled escape hatch that returns the input untouched (folding switched off)
 */
export function groupAgentActivities(
	items: (ClineMessage | ClineMessage[])[],
	{ enabled = true }: { enabled?: boolean } = {},
): (ClineMessage | ClineMessage[])[] {
	if (!enabled) {
		return items
	}

	const result: ChatListItem[] = []
	let pending: ChatListItem[] = []

	const commit = () => {
		if (pending.length === 0) {
			return
		}
		// Never emit a fold whose rows all render nothing — the fold line itself would be the
		// only visible content. Keep those rows unfolded, exactly like upstream renders them.
		const silentOnly = pending.every((item) => !Array.isArray(item) && isSilentActivityMessage(item))
		if (silentOnly) {
			result.push(...pending)
		} else {
			const group = pending as ActivityGroup
			group._isActivityGroup = true
			result.push(group)
		}
		pending = []
	}

	for (const item of items) {
		if (isAgentActivityItem(item)) {
			pending.push(item)
			continue
		}
		commit()
		result.push(item)
	}
	commit()

	return result as (ClineMessage | ClineMessage[])[]
}

/** Flatten a (possibly nested) group back into its chat rows, in render order. */
export function flattenActivityGroup(items: ChatListItem[]): ClineMessage[] {
	const messages: ClineMessage[] = []
	for (const item of items) {
		if (Array.isArray(item)) {
			messages.push(...flattenActivityGroup(item as ChatListItem[]))
			continue
		}
		if (item) {
			messages.push(item)
		}
	}
	return messages
}

/** First row of a list item, flattening nested groups. */
export function getGroupHeadMessage(item: ChatListItem): ClineMessage | undefined {
	if (!Array.isArray(item)) {
		return item
	}
	for (const nested of item as ChatListItem[]) {
		const message = getGroupHeadMessage(nested)
		if (message) {
			return message
		}
	}
	return undefined
}

/** Last row of a list item, flattening nested groups. */
export function getGroupTailMessage(item: ChatListItem): ClineMessage | undefined {
	if (!Array.isArray(item)) {
		return item
	}
	for (let i = item.length - 1; i >= 0; i--) {
		const message = getGroupTailMessage(item[i] as ChatListItem)
		if (message) {
			return message
		}
	}
	return undefined
}

/**
 * Stable key for a fold's expansion override. Derived from the group's first row but negated so
 * it can never collide with a real message timestamp in the shared `expandedRows` map.
 */
export function getActivityGroupKey(group: ChatListItem[]): number {
	const headTs = getGroupHeadMessage(group)?.ts
	return headTs == null ? 0 : -(headTs + 1)
}

/** True while any row of the group is still streaming in. */
export function hasStreamingActivity(group: ChatListItem[]): boolean {
	return flattenActivityGroup(group).some((message) => message.partial === true)
}

/** Whether one child of a fold — a row or a nested tool group — is still in flight. */
function isStreamingItem(item: ChatListItem): boolean {
	return Array.isArray(item) ? hasStreamingActivity(item as ChatListItem[]) : item.partial === true
}

/**
 * The children a fold shows on its own: the ones still running.
 *
 * A command, a read, a diff or a thinking block is interesting while it happens and bookkeeping
 * afterwards. Folding each row individually the moment its `partial` flag clears is what keeps a
 * long turn at one summary line plus the action in flight, instead of an ever-growing open list.
 * Nested tool groups stay whole while any of their rows streams: splitting them would separate a
 * tool call from the result it belongs to.
 *
 * @param options.keepTail while the agent is blocked on an approval, keep the last row even though
 *   it is not streaming — a pending approval prompt is finished as content and still the one thing
 *   the user has to see, and hiding its buttons would deadlock the turn.
 */
export function liveActivityChildren(group: ChatListItem[], { keepTail = false }: { keepTail?: boolean } = {}): ChatListItem[] {
	const running = group.filter(isStreamingItem)
	if (running.length === 0 && keepTail && group.length > 0) {
		return [group[group.length - 1]]
	}
	return running
}

/** Identity of a rendered list item: the timestamp of its first row. */
export function activityItemKey(item: ChatListItem): number | undefined {
	return getGroupHeadMessage(item)?.ts
}

/**
 * Which children a fold renders, given what it decided to show and what is already on screen.
 *
 * `shownKeys` carries the rows the reader was looking at on the previous commit. While the fold's
 * summary line is inside the viewport they are kept: collapsing an action the reader can still see
 * would delete the content under their eyes and drag the summary line back into the middle of the
 * chat. Once that line has scrolled away, the fold is tidying up something nobody is looking at,
 * and only what is running stays.
 */
export function selectActivityChildren(
	group: ChatListItem[],
	{
		mode,
		keepTail = false,
		headerInView = false,
		shownKeys = new Set<number>(),
	}: {
		mode: ActivityGroupMode
		keepTail?: boolean
		headerInView?: boolean
		shownKeys?: Set<number>
	},
): ChatListItem[] {
	if (mode === "all") {
		return group
	}
	if (mode !== "live") {
		return []
	}
	const keys = new Set(
		liveActivityChildren(group, { keepTail })
			.map(activityItemKey)
			.filter((ts): ts is number => ts !== undefined),
	)
	if (headerInView) {
		for (const ts of shownKeys) {
			keys.add(ts)
		}
	}
	return group.filter((item) => {
		const ts = activityItemKey(item)
		return ts !== undefined && keys.has(ts)
	})
}

/** How much of a fold is visible: everything, only what is running, or nothing. */
export type ActivityGroupMode = "all" | "live" | "none"

/**
 * Decide what a fold shows.
 *
 * 1. an explicit user override always wins (`true` = everything, `false` = nothing),
 * 2. otherwise a group with a row in flight shows exactly that row — finished actions fold away,
 * 3. the tail group does the same while the agent is mid-turn or blocked on an approval,
 * 4. with nothing running and the turn over, the fold is the summary line alone.
 */
export function resolveActivityGroupMode({
	override,
	isLastGroup,
	hasStreamingMessage,
	turnPhase,
}: {
	override?: boolean
	isLastGroup: boolean
	hasStreamingMessage: boolean
	turnPhase?: TurnPhase
}): ActivityGroupMode {
	if (override !== undefined) {
		return override ? "all" : "none"
	}
	if (hasStreamingMessage) {
		return "live"
	}
	if (isLastGroup && isTurnWorking(turnPhase)) {
		return "live"
	}
	return "none"
}

/** Whether a fold renders any of its rows at all — the state the scroll anchoring reacts to. */
export function resolveActivityGroupExpansion(args: {
	override?: boolean
	isLastGroup: boolean
	hasStreamingMessage: boolean
	turnPhase?: TurnPhase
}): boolean {
	return resolveActivityGroupMode(args) !== "none"
}

/**
 * The agent is mid-turn for as long as the backend reports a streaming phase, or is blocked on a
 * tool/command approval. Both are "still working" states for the tail fold.
 */
export function isTurnWorking(turnPhase?: TurnPhase): boolean {
	return turnPhase === "streaming" || turnPhase === "awaiting_approval"
}

export interface ActivityGroupStats {
	/** Activity rows that are actual work (tools/commands), i.e. excluding thinking rows. */
	actions: number
	commands: number
	editedFiles: number
	readFiles: number
	searches: number
	thoughts: number
	durationMs: number
}

const EDIT_TOOLS = new Set(["editedExistingFile", "newFileCreated", "fileDeleted"])
const READ_TOOLS = new Set(["readFile"])
const SEARCH_TOOLS = new Set(["searchFiles", "listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames"])

function parseToolName(message: ClineMessage): string | undefined {
	try {
		return (JSON.parse(message.text || "{}") as ClineSayTool).tool
	} catch {
		return undefined
	}
}

/** Count what a fold contains so its collapsed header can summarise the work. */
export function getActivityGroupStats(group: ChatListItem[]): ActivityGroupStats {
	const messages = flattenActivityGroup(group)
	const editedPaths = new Set<string>()
	const readPaths = new Set<string>()
	const stats: ActivityGroupStats = {
		actions: 0,
		commands: 0,
		editedFiles: 0,
		readFiles: 0,
		searches: 0,
		thoughts: 0,
		durationMs: 0,
	}

	for (const message of messages) {
		const kind = message.say ?? message.ask
		if (kind === "reasoning") {
			stats.thoughts++
			continue
		}
		if (kind === "command" || kind === "command_output") {
			stats.commands++
			stats.actions++
			continue
		}
		if (kind !== "tool") {
			continue
		}
		stats.actions++
		const tool = parseToolName(message)
		if (!tool) {
			continue
		}
		if (EDIT_TOOLS.has(tool)) {
			editedPaths.add(message.text ?? tool)
		} else if (READ_TOOLS.has(tool)) {
			readPaths.add(message.text ?? tool)
		} else if (SEARCH_TOOLS.has(tool)) {
			stats.searches++
		}
	}

	stats.editedFiles = editedPaths.size
	stats.readFiles = readPaths.size

	const firstTs = messages.at(0)?.ts
	const lastTs = messages.at(-1)?.ts
	if (firstTs != null && lastTs != null && lastTs > firstTs) {
		stats.durationMs = lastTs - firstTs
	}

	return stats
}

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
	`${count} ${count === 1 ? singular : plural}`

/** Human duration for the fold header; nothing for sub-second activity. */
export function formatActivityDuration(durationMs: number): string | undefined {
	if (!durationMs || durationMs < 1_000) {
		return undefined
	}
	const seconds = Math.round(durationMs / 1_000)
	if (seconds < 60) {
		return `${seconds}s`
	}
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

/**
 * One-line summary of a fold, e.g. `2 commands · 3 files edited · 5 files read · 1m 12s`.
 * Ordered by how much screen space the activity takes, so the truncated tail is the least
 * interesting part in the narrow sidebar.
 */
export function formatActivityGroupStats(stats: ActivityGroupStats): string {
	const parts: string[] = []
	if (stats.commands > 0) {
		parts.push(pluralize(stats.commands, "command"))
	}
	if (stats.editedFiles > 0) {
		parts.push(`${pluralize(stats.editedFiles, "file")} edited`)
	}
	if (stats.readFiles > 0) {
		parts.push(`${pluralize(stats.readFiles, "file")} read`)
	}
	if (stats.searches > 0) {
		parts.push(`${pluralize(stats.searches, "search", "searches")}`)
	}
	if (stats.thoughts > 0) {
		parts.push(`${stats.thoughts}× thinking`)
	}
	if (parts.length === 0) {
		parts.push(pluralize(stats.actions || 1, "action"))
	}
	const duration = formatActivityDuration(stats.durationMs)
	if (duration) {
		parts.push(duration)
	}
	return parts.join(" · ")
}

/** Convenience: full collapsed-header label of a group. */
export function getActivityGroupLabel(group: ChatListItem[]): string {
	return formatActivityGroupStats(getActivityGroupStats(group))
}

/** Rows that open a new agent turn: the initial prompt and every follow-up from the user. */
export function isTurnBoundaryMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

/** A row that already marks a turn as finished, tagged by the live path. */
function isCompletionRow(message: ClineMessage): boolean {
	return message.say === "completion_result" || message.say === "plan_completion_result"
}

/**
 * Retag the terminal answer of *every* turn as a completion result, not just the transcript's last one.
 *
 * Cline derives the green "done" box from a live `done` event and never persists it: rehydrating a
 * session replays `endFinalTurn()` exactly once (`message-translator.ts:2613`), gated on the session
 * record being `completed` (`sdk-task-history.ts:528`). Every earlier turn therefore comes back as a
 * plain text row, which flattens the history the fold was introduced to structure.
 *
 * Within a turn the terminal answer is unambiguous — it is simply the last non-empty `text` row
 * before the next prompt — so the fork restores that hierarchy for history as well. Turns the live
 * path already tagged are skipped (keeps this idempotent), and turns containing an error row are
 * left alone so a failed run never renders as a deliberate completion.
 */
export function markTurnFinalAnswers(messages: ClineMessage[]): ClineMessage[] {
	const retagged = new Map<number, ClineMessage>()
	let segmentStart = 0

	const closeSegment = (end: number) => {
		if (end <= segmentStart) {
			return
		}
		const segment = messages.slice(segmentStart, end)
		// The live path already concluded this turn, so there is nothing to infer.
		if (segment.some(isCompletionRow)) {
			return
		}
		// Walk back over trailing usage bookkeeping: those rows render nothing, so an agent that
		// emitted one has not necessarily kept working.
		for (let i = segment.length - 1; i >= 0; i--) {
			const row = segment[i]
			if (isSilentActivityMessage(row)) {
				continue
			}
			// A blank text row renders nothing either, so it cannot make an earlier answer
			// non-final. A *streaming* row is different: it means the answer is still arriving.
			if (row.say === "text" && !row.partial && !row.text?.trim()) {
				continue
			}
			// The turn's last *substantive* row decides. A tool, command, thinking block or error
			// means the agent was still acting on its own, and any text before it was only a
			// status update — the very thing that must not be shown as a final answer.
			if (row.say === "text" && !row.partial && row.text?.trim()) {
				retagged.set(row.ts, { ...row, say: "completion_result", partial: false })
			}
			break
		}
	}

	for (let index = 0; index < messages.length; index++) {
		if (isTurnBoundaryMessage(messages[index])) {
			closeSegment(index)
			segmentStart = index + 1
		}
	}
	closeSegment(messages.length)

	if (retagged.size === 0) {
		return messages
	}
	return messages.map((message) => retagged.get(message.ts) ?? message)
}
