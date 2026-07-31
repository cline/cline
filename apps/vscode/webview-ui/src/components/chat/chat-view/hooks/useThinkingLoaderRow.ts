import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { useEffect, useMemo, useRef, useState } from "react"
import { isToolGroup } from "../utils/messageUtils"

/**
 * Grace period before showing the "Thinking..." loader row when its trigger is the tail
 * message finishing streaming (partial -> false). That signal is ambiguous: mid-turn it means
 * "waiting on the model's next content block / API request" (loader wanted), but at the end of
 * a turn it arrives via the fast partial-message stream moments before the `done` event flips
 * turnState out of "streaming" via a full state post. Showing instantly in that window makes
 * the loader flash in and out on every turn completion, so hold off briefly — a real wait
 * outlives the grace period, while the turn-end phase change cancels it.
 */
export const THINKING_LOADER_GRACE_MS = 500

export interface ThinkingLoaderInputs {
	turnState: TurnState | undefined
	/** Tail of the raw clineMessages array. */
	lastRawMessage: ClineMessage | undefined
	groupedMessages: (ClineMessage | ClineMessage[])[]
	/** Tail of groupedMessages. */
	lastVisibleRow: ClineMessage | ClineMessage[] | undefined
	/** Tail message of lastVisibleRow (last element when it is a group). */
	lastVisibleMessage: ClineMessage | undefined
	modifiedMessages: ClineMessage[]
	/**
	 * Optimistic override: a turn-starting response RPC (new task or a follow-up sent outside a
	 * streaming phase) was submitted before the backend published its next TurnState, so the
	 * replica's turnState is stale (idle/completed/awaiting_*). Shows the loader immediately —
	 * bypassing the phase gate and the turn-end completion_result guard, both of which describe
	 * the PREVIOUS turn at this moment — but never while a visible content row is actively
	 * streaming (no duplicate loaders if the marker briefly overlaps live output). The owner
	 * clears it once a fresher TurnState arrives.
	 */
	forceShow?: boolean
}

/**
 * Whether the agent is presumed to be working with nothing visibly streaming yet, i.e. the
 * "Thinking..." loader row should be requested. This is the sole early loading indicator -
 * RequestStartRow does NOT duplicate it.
 * Covers: pre-api_req_started (backend processing) AND post-api_req_started (waiting for model).
 * Hides once reasoning, tools, text, or any other content message appears.
 */
export function computeIsWaitingForResponse({
	turnState,
	lastRawMessage,
	groupedMessages,
	lastVisibleRow,
	lastVisibleMessage,
	modifiedMessages,
}: ThinkingLoaderInputs): boolean {
	const lastMsg = modifiedMessages[modifiedMessages.length - 1]

	// AUTHORITATIVE PATH: when the backend provides a TurnState, the agent is only "thinking"
	// while phase === "streaming". Any other phase (awaiting_approval/followup, completed,
	// error, resumable, idle) is never a thinking state — this is what makes the footer
	// immune to trailing bookkeeping messages and prevents the stuck-"Thinking" bug (RC1).
	// During streaming we still suppress the footer loader once a partial content row is
	// actually rendering, to avoid a duplicate spinner (handled by the legacy sub-logic
	// below, which only runs in the streaming case).
	if (turnState) {
		if (turnState.phase !== "streaming") {
			return false
		}
		// attempt_completion emits a final say("completion_result") a beat before the `done`
		// event flips the phase to "completed", and the turn-end inferred completion rows
		// (say completion_result / plan_completion_result) likewise land just before the phase
		// change. Treat them as non-waiting so the loader doesn't flash during that gap (same
		// anti-flicker guard as the legacy path below).
		if (
			lastRawMessage?.type === "say" &&
			(lastRawMessage.say === "completion_result" || lastRawMessage.say === "plan_completion_result")
		) {
			return false
		}
		// phase === streaming: show Thinking until a visible content row is streaming.
		if (groupedMessages.length === 0 || !lastVisibleMessage) {
			return true
		}
		if (lastVisibleRow && isToolGroup(lastVisibleRow)) {
			return true
		}
		return lastVisibleMessage.partial !== true
	}

	// LEGACY PATH (no TurnState — classic/older state): infer from the message tail.
	// Never show thinking while waiting on user input (any ask state).
	// This includes completion_result, tool approvals, followups, and resume asks.
	if (lastRawMessage?.type === "ask") {
		return false
	}
	// attempt_completion emits a final say("completion_result") before ask("completion_result").
	// Treat that final completion message as non-waiting to avoid a brief footer flicker.
	// The turn-end inferred completion rows (say completion_result / plan_completion_result)
	// are likewise terminal.
	if (
		lastRawMessage?.type === "say" &&
		(lastRawMessage.say === "completion_result" || lastRawMessage.say === "plan_completion_result")
	) {
		return false
	}
	if (lastRawMessage?.type === "say" && lastRawMessage.say === "api_req_started") {
		try {
			const info = JSON.parse(lastRawMessage.text || "{}")
			if (info.cancelReason === "user_cancelled") {
				return false
			}
		} catch {
			// ignore parse errors
		}
	}

	// Always show while task has started but no visible rows are rendered yet.
	if (groupedMessages.length === 0) {
		return true
	}

	// Defensive guard for transient states where a grouped row exists
	// but we still cannot resolve a concrete visible message.
	if (!lastVisibleMessage) {
		return true
	}

	// Always show when the last rendered row is a toolgroup.
	if (lastVisibleRow && isToolGroup(lastVisibleRow)) {
		return true
	}

	// User-requested behavior:
	// if the last visible row is not actively partial, always show Thinking in the footer.
	// (some rows like checkpoint_created don't set `partial`, and should be treated as non-partial)
	if (lastVisibleMessage.partial !== true) {
		return true
	}

	if (!lastMsg) {
		// No messages after the initial task message - new task just started
		return true
	}
	if (lastMsg.say === "user_feedback" || lastMsg.say === "user_feedback_diff") return true
	if (lastMsg.say === "api_req_started") {
		try {
			const info = JSON.parse(lastMsg.text || "{}")
			// Still in progress (no cost) and nothing has streamed after it yet
			return info.cost == null
		} catch {
			return true
		}
	}
	return false
}

/**
 * Debounced visibility for the in-list "Thinking..." loader row.
 *
 * Shows immediately for unambiguous triggers (turn start, new message appended, tool group
 * tail). When the trigger is the current tail message transitioning partial -> non-partial,
 * showing is delayed by THINKING_LOADER_GRACE_MS: at turn end that transition happens just
 * before the phase flips out of "streaming", and an instant loader would flash in and out.
 *
 * The grace only ever delays a hidden -> visible transition; it is skipped when:
 * - the loader is already visible (e.g. below a streaming tool group, where the tail
 *   finalizing used to blink the visible loader off and back on), or
 * - `tailCannotEndTurn` is set: the finalized tail is a message kind that never coincides
 *   with turn end (reasoning — the model always emits content after thinking), so the
 *   turn-end ambiguity the grace protects against does not apply. Without this, a mid-turn
 *   reasoning -> tool-call handoff flickered: the reasoning shimmer collapsed, the loader
 *   stayed hidden for the grace period, popped in, then hid again when the tool row landed.
 */
export function useDebouncedLoaderVisibility(
	shouldShow: boolean,
	tailTs: number | undefined,
	tailIsPartial: boolean,
	tailCannotEndTurn = false,
): boolean {
	const [debouncedTailTs, setDebouncedTailTs] = useState<number>()
	const prevTailRef = useRef<{ ts: number | undefined; partial: boolean }>({ ts: undefined, partial: false })
	const wasVisibleRef = useRef(false)
	const prevTail = prevTailRef.current
	const tailJustFinishedStreaming = tailTs !== undefined && prevTail.ts === tailTs && prevTail.partial && !tailIsPartial
	const graceApplies = !tailCannotEndTurn && !wasVisibleRef.current
	const waitingForDebounce = graceApplies && (tailJustFinishedStreaming || (tailTs !== undefined && debouncedTailTs === tailTs))

	useEffect(() => {
		prevTailRef.current = { ts: tailTs, partial: tailIsPartial }

		if (!shouldShow) {
			setDebouncedTailTs(undefined)
			return
		}

		if (!tailJustFinishedStreaming || !graceApplies) {
			setDebouncedTailTs(undefined)
			return
		}

		setDebouncedTailTs(tailTs)
		const timer = setTimeout(() => setDebouncedTailTs(undefined), THINKING_LOADER_GRACE_MS)
		return () => clearTimeout(timer)
	}, [shouldShow, tailTs, tailIsPartial])

	// Effects run after the browser can paint. Derive ordinary show/hide states directly so an
	// unambiguous turn start is present in the first render and streaming content removes a stale
	// loader in that same render. State is only needed to latch the ambiguous partial -> final
	// transition until its grace timer expires.
	const visible = shouldShow && !waitingForDebounce

	// Track the previous render's visibility so the grace never hides an already-visible loader.
	useEffect(() => {
		wasVisibleRef.current = visible
	})

	return visible
}

/**
 * Whether the in-list "Thinking..." loader row should currently be rendered.
 * Combines the waiting heuristic, the waiting -> reasoning handoff guard, and the
 * anti-flash debounce for tail-finalization triggers.
 */
export function useThinkingLoaderRow(inputs: ThinkingLoaderInputs): boolean {
	const { turnState, lastRawMessage, groupedMessages, lastVisibleRow, lastVisibleMessage, modifiedMessages, forceShow } = inputs

	const isWaitingForResponse = useMemo(
		() =>
			computeIsWaitingForResponse({
				turnState,
				lastRawMessage,
				groupedMessages,
				lastVisibleRow,
				lastVisibleMessage,
				modifiedMessages,
			}),
		[turnState, lastRawMessage, groupedMessages, lastVisibleRow, lastVisibleMessage, modifiedMessages],
	)

	// During handoff from waiting -> reasoning stream, keep the loader mounted until a real
	// reasoning row is visible in the grouped list.
	const handoffToReasoningPending =
		lastRawMessage?.type === "say" &&
		lastRawMessage.say === "reasoning" &&
		lastRawMessage.partial === true &&
		lastVisibleMessage?.say !== "reasoning"

	// See ThinkingLoaderInputs.forceShow: show right away for a turn this webview just
	// started, unless a visible content row is already streaming.
	const optimisticShow = forceShow === true && lastVisibleMessage?.partial !== true

	return useDebouncedLoaderVisibility(
		optimisticShow || isWaitingForResponse || handoffToReasoningPending,
		lastVisibleMessage?.ts,
		lastVisibleMessage?.partial === true,
		// A reasoning tail finishing never ends the turn (the model always emits content after
		// thinking), so skip the anti-flash grace and hand the shimmer straight to the loader.
		lastVisibleMessage?.say === "reasoning",
	)
}
