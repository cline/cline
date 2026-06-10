import type { ClineMessage } from "@shared/ExtensionMessage"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { isToolGroup } from "../utils/messageUtils"

/**
 * Sentinel ts for the synthetic "Thinking..." placeholder row appended to the rendered list
 * while waiting for the model. It is not a real message and must be ignored when deriving
 * scroll triggers from the tail of the list.
 */
export const THINKING_PLACEHOLDER_TS = Number.MIN_SAFE_INTEGER

export function isThinkingPlaceholderRow(messageOrGroup: ClineMessage | ClineMessage[]): boolean {
	return !Array.isArray(messageOrGroup) && messageOrGroup.ts === THINKING_PLACEHOLDER_TS
}

/**
 * Computes the list of rows the chat actually renders: the grouped messages plus, when waiting
 * on the model, a synthetic "Thinking..." placeholder row at the end.
 *
 * This lives at the ChatView level (not inside MessagesArea) so the scroll behavior hook sees
 * the same list Virtuoso renders. The placeholder can appear from a turnState change alone
 * (e.g. plan -> act auto-continue) with no message-list change, and auto scroll must still
 * react to it.
 */
export function useDisplayedGroupedMessages(
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
): (ClineMessage | ClineMessage[])[] {
	const { clineMessages, turnState } = useExtensionState()
	const lastRawMessage = useMemo(() => clineMessages.at(-1), [clineMessages])

	const lastVisibleRow = useMemo(() => groupedMessages.at(-1), [groupedMessages])
	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) {
			return undefined
		}
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	// Show "Thinking..." until real content starts streaming.
	// This is the sole early loading indicator - RequestStartRow does NOT duplicate it.
	// Covers: pre-api_req_started (backend processing) AND post-api_req_started (waiting for model).
	// Hides once reasoning, tools, text, or any other content message appears.
	const isWaitingForResponse = useMemo(() => {
		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		// AUTHORITATIVE PATH: when the backend provides a TurnState, the agent is only "thinking"
		// while phase === "streaming". Any other phase (awaiting_approval/followup, completed,
		// error, resumable, idle) is never a thinking state, which is what makes the footer
		// immune to trailing bookkeeping messages and prevents the stuck-"Thinking" bug (RC1).
		// During streaming we still suppress the footer loader once a partial content row is
		// actually rendering, to avoid a duplicate spinner (handled by the legacy sub-logic
		// below, which only runs in the streaming case).
		if (turnState) {
			if (turnState.phase !== "streaming") {
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

		// LEGACY PATH (no TurnState, classic/older state): infer from the message tail.
		// Never show thinking while waiting on user input (any ask state).
		// This includes completion_result, tool approvals, followups, and resume asks.
		if (lastRawMessage?.type === "ask") {
			return false
		}
		// attempt_completion emits a final say("completion_result") before ask("completion_result").
		// Treat that final completion message as non-waiting to avoid a brief footer flicker.
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "completion_result") {
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
	}, [turnState, lastRawMessage, groupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	// Keep loader in the message flow (not footer). During handoff from waiting -> reasoning stream,
	// keep the loader mounted until a real reasoning row is visible.
	const showThinkingLoaderRow = useMemo(() => {
		const handoffToReasoningPending =
			lastRawMessage?.type === "say" &&
			lastRawMessage.say === "reasoning" &&
			lastRawMessage.partial === true &&
			lastVisibleMessage?.say !== "reasoning"

		// Mirror the old footer behavior exactly: show whenever waiting logic says so.
		// Plus a brief handoff guard while grouped rows catch up to raw reasoning stream.
		return isWaitingForResponse || handoffToReasoningPending
	}, [isWaitingForResponse, lastRawMessage, lastVisibleMessage?.say])

	return useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		if (!showThinkingLoaderRow) {
			return groupedMessages
		}
		const waitingRow: ClineMessage = {
			ts: THINKING_PLACEHOLDER_TS,
			type: "say",
			say: "reasoning",
			partial: true,
			text: "",
		}
		return [...groupedMessages, waitingRow]
	}, [groupedMessages, showThinkingLoaderRow])
}
