import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	applyActiveRecoveryHold,
	canRestoreWorkspaceFromMessage,
	filterVisibleMessages,
	findActiveRecoveryDecoration,
	groupLowStakesTools,
	hideRowsAfterActiveRecovery,
	isErrorBlockMessage,
	isToolGroup,
	parseAutoRecoveryPayload,
} from "./messageUtils"

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
})

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
})

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
})

const createAutoRecoveryMessage = (ts: number, status: string, delaySeconds = 3): ClineMessage => ({
	type: "say",
	say: "auto_recovery",
	text: JSON.stringify({
		kind: "mistake",
		status,
		delaySeconds,
		retryAt: Date.now() + delaySeconds * 1000,
	}),
	ts,
})

const createErrorMessage = (ts: number, text = "Something failed"): ClineMessage => ({
	type: "say",
	say: "error",
	text,
	ts,
})

const createCompactionMessage = (ts: number, status: string, mode = "auto"): ClineMessage => ({
	type: "say",
	say: "compaction",
	text: JSON.stringify({ status, mode, tokensBefore: 190_000, tokensAfter: 40_000 }),
	ts,
})

const createApiReqStartedMessage = (ts: number, info: Record<string, unknown> = {}): ClineMessage => ({
	type: "say",
	say: "api_req_started",
	text: JSON.stringify(info),
	ts,
})

describe("parseAutoRecoveryPayload", () => {
	it("parses a valid payload", () => {
		const payload = parseAutoRecoveryPayload(createAutoRecoveryMessage(1, "countdown").text)
		expect(payload?.status).toBe("countdown")
		expect(payload?.kind).toBe("mistake")
		expect(payload?.delaySeconds).toBe(3)
	})

	it("returns undefined for missing or malformed text", () => {
		expect(parseAutoRecoveryPayload(undefined)).toBeUndefined()
		expect(parseAutoRecoveryPayload("not json")).toBeUndefined()
		expect(parseAutoRecoveryPayload('{"kind":"mistake"}')).toBeUndefined() // missing status
		expect(parseAutoRecoveryPayload('{"status":"nonsense"}')).toBeUndefined() // unknown status
	})
})

describe("isErrorBlockMessage", () => {
	it("matches say:error, ask:mistake_limit_reached, and failed api_req_started rows", () => {
		expect(isErrorBlockMessage(createErrorMessage(1))).toBe(true)
		expect(isErrorBlockMessage({ type: "ask", ask: "mistake_limit_reached", text: "", ts: 2 })).toBe(true)
		expect(isErrorBlockMessage(createApiReqStartedMessage(3, { cancelReason: "user_cancelled" }))).toBe(true)
		expect(isErrorBlockMessage(createApiReqStartedMessage(4, { streamingFailedMessage: "stream broke" }))).toBe(true)
	})

	it("does not match in-flight api_req_started or non-error rows", () => {
		expect(isErrorBlockMessage(createApiReqStartedMessage(1))).toBe(false)
		expect(isErrorBlockMessage(createTextMessage(2, "hello"))).toBe(false)
		expect(isErrorBlockMessage(createAutoRecoveryMessage(3, "countdown"))).toBe(false)
	})
})

describe("findActiveRecoveryDecoration", () => {
	it("attaches the tail marker to the nearest preceding error block", () => {
		const messages = [
			createErrorMessage(1, "first error"),
			createTextMessage(2, "between"),
			createErrorMessage(3, "second error"),
			createAutoRecoveryMessage(4, "countdown"),
		]
		const decoration = findActiveRecoveryDecoration(messages)
		expect(decoration).toMatchObject({ markerTs: 4, targetTs: 3 })
		expect(decoration?.payload.status).toBe("countdown")
	})

	it("treats a retrying marker as active and a failed api_req_started as the target", () => {
		const messages = [
			createApiReqStartedMessage(1, { streamingFailedMessage: "stream broke" }),
			createAutoRecoveryMessage(2, "retrying"),
		]
		expect(findActiveRecoveryDecoration(messages)).toMatchObject({ markerTs: 2, targetTs: 1 })
	})

	it("returns undefined when the nearest marker is settled or has no preceding error block", () => {
		const settled = [createErrorMessage(1), createAutoRecoveryMessage(2, "settled"), createTextMessage(3, "later")]
		expect(findActiveRecoveryDecoration(settled)).toBeUndefined()

		const orphan = [createTextMessage(1, "no error"), createAutoRecoveryMessage(2, "countdown")]
		expect(findActiveRecoveryDecoration(orphan)).toBeUndefined()

		expect(findActiveRecoveryDecoration([createTextMessage(1, "nothing")])).toBeUndefined()
	})

	it("ignores earlier markers once the nearest one has settled", () => {
		const messages = [createErrorMessage(1), createAutoRecoveryMessage(2, "settled"), createTextMessage(3, "later turn")]
		expect(findActiveRecoveryDecoration(messages)).toBeUndefined()
	})

	it("never reaches past an earlier streak's marker: a live marker without its own error block decorates nothing", () => {
		// Streak 1 errored and settled; Cline moved on; streak 2's marker went
		// live before its own error row landed. The old behavior walked back to
		// error(1) — decorating ancient history and truncating the chat there.
		const messages = [
			createErrorMessage(1, "ancient error"),
			createAutoRecoveryMessage(2, "settled"),
			createTextMessage(3, "moved forward"),
			createTextMessage(4, "still forward"),
			createAutoRecoveryMessage(5, "countdown"),
		]
		expect(findActiveRecoveryDecoration(messages)).toBeUndefined()
	})

	it("decorates the current streak's own error block, not an older one", () => {
		const messages = [
			createErrorMessage(1, "ancient error"),
			createAutoRecoveryMessage(2, "settled"),
			createTextMessage(3, "moved forward"),
			createErrorMessage(4, "fresh error"),
			createAutoRecoveryMessage(5, "countdown"),
			createTextMessage(6, "held back"),
		]
		expect(findActiveRecoveryDecoration(messages)).toMatchObject({ markerTs: 5, targetTs: 4 })
	})

	it("treats a live-looking marker as stale unless a turn is actually in flight", () => {
		const messages = [createErrorMessage(1), createAutoRecoveryMessage(2, "countdown")]
		// Stopped / finished / waiting states: no action happening — plain glyph.
		expect(findActiveRecoveryDecoration(messages, "idle")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "resumable")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "error")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "completed")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "awaiting_followup")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "awaiting_approval")).toBeUndefined()
		// Countdown or in-flight retry: the ring/spinner is genuine.
		expect(findActiveRecoveryDecoration(messages, "retrying")).toMatchObject({ markerTs: 2, targetTs: 1 })
		expect(findActiveRecoveryDecoration(messages, "streaming")).toMatchObject({ markerTs: 2, targetTs: 1 })
		// Legacy caller (no phase): marker rules, as before.
		expect(findActiveRecoveryDecoration(messages)).toMatchObject({ markerTs: 2, targetTs: 1 })
	})

	it("self-heals a stranded countdown whose fire time is long past", () => {
		const staleMarker: ClineMessage = {
			type: "say",
			say: "auto_recovery",
			text: JSON.stringify({ kind: "api", status: "countdown", delaySeconds: 3, retryAt: Date.now() - 10 * 60_000 }),
			ts: 2,
		}
		const messages = [createErrorMessage(1), staleMarker, createTextMessage(3, "held rows must release")]
		// No phase (marker rules) and live phases alike: a countdown this old
		// can only be stranded — treat it as settled so no rows stay hidden
		// and the footer cannot hang on Cancel-only.
		expect(findActiveRecoveryDecoration(messages)).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "streaming")).toBeUndefined()
		expect(findActiveRecoveryDecoration(messages, "retrying")).toBeUndefined()
	})

	it("keeps decorating a countdown whose fire time just passed", () => {
		const justPast: ClineMessage = {
			type: "say",
			say: "auto_recovery",
			text: JSON.stringify({ kind: "api", status: "countdown", delaySeconds: 3, retryAt: Date.now() - 30_000 }),
			ts: 2,
		}
		const messages = [createErrorMessage(1), justPast]
		// Within the grace window the timer may simply not have fired yet.
		expect(findActiveRecoveryDecoration(messages)).toMatchObject({ markerTs: 2, targetTs: 1 })
		expect(findActiveRecoveryDecoration(messages, "retrying")).toMatchObject({ markerTs: 2, targetTs: 1 })
	})

	it("does not time-gate a retrying marker (the attempt is in flight)", () => {
		const retrying: ClineMessage = {
			type: "say",
			say: "auto_recovery",
			text: JSON.stringify({ kind: "api", status: "retrying", delaySeconds: 3, retryAt: Date.now() - 10 * 60_000 }),
			ts: 2,
		}
		const messages = [createErrorMessage(1), retrying]
		expect(findActiveRecoveryDecoration(messages, "streaming")).toMatchObject({ markerTs: 2, targetTs: 1 })
		expect(findActiveRecoveryDecoration(messages)).toMatchObject({ markerTs: 2, targetTs: 1 })
	})
})

describe("hideRowsAfterActiveRecovery", () => {
	it("truncates after the decorated error block", () => {
		const messages = [
			createTextMessage(1, "before"),
			createErrorMessage(2),
			createAutoRecoveryMessage(3, "countdown"), // marker itself is filtered elsewhere
			createReasoningMessage(4, "held back"),
			createTextMessage(5, "held back too"),
		]
		expect(hideRowsAfterActiveRecovery(messages, 2)).toEqual([messages[0], messages[1]])
	})

	it("keeps everything when the target is absent from the list", () => {
		const messages = [createTextMessage(1, "a"), createTextMessage(2, "b")]
		expect(hideRowsAfterActiveRecovery(messages, 99)).toEqual(messages)
	})
})

describe("filterVisibleMessages auto_recovery", () => {
	it("never renders the marker as its own row", () => {
		const messages = [createErrorMessage(1), createAutoRecoveryMessage(2, "countdown"), createTextMessage(3, "after")]
		expect(filterVisibleMessages(messages)).toEqual([messages[0], messages[2]])
	})
})

describe("applyActiveRecoveryHold", () => {
	it("holds every row after the error block while the streak counts down, keeping pre-error rows", () => {
		const messages = [
			createTextMessage(1, "pre-action stays rendered"),
			createErrorMessage(2),
			createAutoRecoveryMessage(3, "countdown"),
			createReasoningMessage(4, "leaked iteration"),
			createTextMessage(5, "held back too"),
		]
		const activeRecovery = findActiveRecoveryDecoration(messages)
		expect(activeRecovery).toMatchObject({ markerTs: 3, targetTs: 2 })
		expect(applyActiveRecoveryHold(messages, activeRecovery)).toEqual([messages[0], messages[1]])
	})

	it("keeps holding through the in-flight retry: compaction, tool, text, and api rows stay hidden", () => {
		// Regression: the say:"compaction" divider ("Auto compacting context") used
		// to render below the error block once the retry's phase flipped back to
		// "streaming". The hold is phase-independent by design — the marker status
		// "retrying" spans the whole in-flight attempt, and the hold rides with it.
		const messages = [
			createApiReqStartedMessage(1, { streamingFailedMessage: "ECONNRESET" }),
			createAutoRecoveryMessage(2, "retrying"),
			createCompactionMessage(3, "started"),
			createToolMessage(4, "edited_file"),
			createTextMessage(5, "partial retry output"),
			createApiReqStartedMessage(6),
		]
		const activeRecovery = findActiveRecoveryDecoration(messages)
		expect(activeRecovery).toMatchObject({ markerTs: 2, targetTs: 1 })
		expect(applyActiveRecoveryHold(messages, activeRecovery)).toEqual([messages[0]])
	})

	it("releases the hold when the streak settles", () => {
		const messages = [
			createErrorMessage(1),
			createAutoRecoveryMessage(2, "settled"),
			createCompactionMessage(3, "completed"),
			createTextMessage(4, "successful retry output"),
		]
		expect(findActiveRecoveryDecoration(messages)).toBeUndefined()
		expect(applyActiveRecoveryHold(messages, undefined)).toEqual(messages)
	})

	it("passes the list through untouched when no marker is active", () => {
		const messages = [createTextMessage(1, "a"), createErrorMessage(2), createTextMessage(3, "b")]
		expect(applyActiveRecoveryHold(messages, undefined)).toEqual(messages)
	})
})

const createUserFeedbackMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "user_feedback",
	text,
	ts,
})

const createTaskMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "task",
	text,
	ts,
})

const createAskMessage = (
	ts: number,
	ask: "followup" | "plan_mode_respond",
	options: string[],
	selected?: string,
): ClineMessage => ({
	type: "ask",
	ask,
	text: JSON.stringify(
		ask === "followup" ? { question: "Pick one", options, selected } : { response: "Pick one", options, selected },
	),
	ts,
})

describe("filterVisibleMessages", () => {
	it("hides exact user feedback echoes for selected follow-up options", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact option echoes when selected has not been persisted on the ask row yet", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"])
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact user feedback echoes for plan-mode response options", () => {
		const askMessage = createAskMessage(1, "plan_mode_respond", ["Plan it", "Do it"], "Plan it")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Plan it")])

		expect(visible).toEqual([askMessage])
	})

	it("keeps custom user feedback that extends a selected option", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage = createUserFeedbackMessage(2, "Use this: include tests")
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})

	it("keeps exact option feedback when it includes attachments", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage: ClineMessage = {
			...createUserFeedbackMessage(2, "Use this"),
			images: ["data:image/png;base64,abc"],
		}
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})
})

describe("canRestoreWorkspaceFromMessage", () => {
	it("allows restore for user messages that start runs, but not ask answers", () => {
		const messages = [
			createTaskMessage(1, "start"),
			createAskMessage(2, "followup", ["src/index.ts"]),
			createTextMessage(3, "Which file should I inspect?"),
			createUserFeedbackMessage(4, "src/index.ts"),
			createUserFeedbackMessage(5, "next task"),
		]

		expect(canRestoreWorkspaceFromMessage(messages, 1)).toBe(true)
		expect(canRestoreWorkspaceFromMessage(messages, 4)).toBe(false)
		expect(canRestoreWorkspaceFromMessage(messages, 5)).toBe(true)
		expect(canRestoreWorkspaceFromMessage(messages, 999)).toBe(false)
	})
})

describe("groupLowStakesTools", () => {
	it("keeps text that arrives after a low-stakes tool group by finalizing the group first", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Post-tool summary text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Post-tool summary text" })
	})

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Follow-up text" })
	})

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "text", text: "Answer text" })
	})

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
	})

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([createReasoningMessage(1, "Planning next read"), createToolMessage(2, "readFile")])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Planning next read" })
		expect(isToolGroup(grouped[1])).toBe(true)
	})
})
