import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	computeIsWaitingForResponse,
	THINKING_LOADER_GRACE_MS,
	type ThinkingLoaderInputs,
	useThinkingLoaderRow,
} from "./useThinkingLoaderRow"

function say(ts: number, sayType: ClineMessage["say"], partial?: boolean, text = ""): ClineMessage {
	return { ts, type: "say", say: sayType, text, partial }
}

function streaming(seq = 1): TurnState {
	return { phase: "streaming", seq }
}

function inputsFor(messages: ClineMessage[], turnState: TurnState | undefined): ThinkingLoaderInputs {
	return {
		turnState,
		lastRawMessage: messages.at(-1),
		groupedMessages: messages,
		lastVisibleRow: messages.at(-1),
		lastVisibleMessage: messages.at(-1),
		modifiedMessages: messages,
	}
}

describe("computeIsWaitingForResponse (turnState path)", () => {
	it("waits while streaming with no visible rows yet", () => {
		expect(computeIsWaitingForResponse(inputsFor([], streaming()))).toBe(true)
	})

	it("does not wait while a content row is actively streaming", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", true)], streaming()))).toBe(false)
	})

	it("waits when the last visible row is no longer partial while streaming", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], streaming()))).toBe(true)
	})

	it("never waits outside the streaming phase", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], { phase: "awaiting_followup", seq: 2 }))).toBe(
			false,
		)
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], { phase: "completed", seq: 2 }))).toBe(false)
	})

	it("does not wait on a final completion_result even while phase is still streaming", () => {
		// attempt_completion's say("completion_result") lands before the done event flips the
		// phase to "completed"; the loader must not flash during that gap.
		expect(computeIsWaitingForResponse(inputsFor([say(1, "completion_result", false)], streaming()))).toBe(false)
	})
})

describe("computeIsWaitingForResponse (legacy path)", () => {
	it("does not wait when the last raw message is an ask", () => {
		const ask: ClineMessage = { ts: 1, type: "ask", ask: "followup", text: "?", partial: false }
		expect(computeIsWaitingForResponse(inputsFor([ask], undefined))).toBe(false)
	})

	it("does not wait on a final completion_result", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "completion_result", false)], undefined))).toBe(false)
	})

	it("waits when the last visible row is not actively partial", () => {
		expect(computeIsWaitingForResponse(inputsFor([say(1, "text", false)], undefined))).toBe(true)
	})
})

describe("useThinkingLoaderRow anti-flash debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function renderLoader(initial: ThinkingLoaderInputs) {
		return renderHook((inputs: ThinkingLoaderInputs) => useThinkingLoaderRow(inputs), { initialProps: initial })
	}

	it("does not flash when the turn completes right after the tail message finalizes", () => {
		// Streaming text row: loader hidden.
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", true)], streaming()))
		expect(result.current).toBe(false)

		// Tail finalizes (partial -> false) while turnState still says "streaming":
		// the loader must NOT appear immediately.
		rerender(inputsFor([say(1, "text", false)], streaming()))
		expect(result.current).toBe(false)

		// The done event flips the phase before the grace period elapses: no flash.
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS - 100)
		})
		rerender(inputsFor([say(1, "text", false)], { phase: "awaiting_followup", seq: 2 }))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(false)
	})

	it("shows the loader after the grace period when the wait is real (mid-turn)", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", true)], streaming()))
		expect(result.current).toBe(false)

		rerender(inputsFor([say(1, "text", false)], streaming()))
		expect(result.current).toBe(false)

		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(true)
	})

	it("shows the loader immediately at turn start (no finalizing tail involved)", () => {
		const userMessage = say(1, "user_feedback", false, "do the thing")
		const { result, rerender } = renderLoader(inputsFor([userMessage], { phase: "awaiting_followup", seq: 1 }))
		expect(result.current).toBe(false)

		rerender(inputsFor([userMessage], streaming(2)))
		expect(result.current).toBe(true)
	})

	it("hides the loader as soon as new content starts streaming during the wait", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "text", false)], streaming()))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(true)

		rerender(inputsFor([say(1, "text", false), say(2, "reasoning", true, "hmm")], streaming()))
		expect(result.current).toBe(false)
	})

	it("does not flash on attempt_completion turns even without the debounce timing", () => {
		const { result, rerender } = renderLoader(inputsFor([say(1, "completion_result", true)], streaming()))
		expect(result.current).toBe(false)

		rerender(inputsFor([say(1, "completion_result", false)], streaming()))
		act(() => {
			vi.advanceTimersByTime(THINKING_LOADER_GRACE_MS)
		})
		expect(result.current).toBe(false)
	})
})

describe("useThinkingLoaderRow optimisticTurnStart (turn just started from this webview)", () => {
	function renderLoader(initial: ThinkingLoaderInputs) {
		return renderHook((inputs: ThinkingLoaderInputs) => useThinkingLoaderRow(inputs), { initialProps: initial })
	}

	it("shows immediately for a new task while the replica's turnState is still a stale idle", () => {
		// Right after a new-task submit the replica still holds the pre-task "idle" TurnState;
		// without the marker the authoritative gate would hide the loader until the streaming
		// TurnState round-trips through a full state post.
		const { result } = renderLoader({ ...inputsFor([], { phase: "idle", seq: 1 }), optimisticTurnStart: true })
		expect(result.current).toBe(true)
	})

	it("does not show for a stale idle turnState without the marker", () => {
		const { result } = renderLoader(inputsFor([], { phase: "idle", seq: 1 }))
		expect(result.current).toBe(false)
	})

	it("shows immediately for a follow-up while the replica's turnState is still the completed phase", () => {
		// Follow-up after a completed turn: the tail is the previous turn's completion_result and
		// the phase is still "completed" until the streaming TurnState posts. Both would normally
		// suppress the loader; the optimistic marker bypasses them at turn START.
		const conversation = [say(1, "completion_result", false, "done")]
		const { result } = renderLoader({
			...inputsFor(conversation, { phase: "completed", seq: 5 }),
			optimisticTurnStart: true,
		})
		expect(result.current).toBe(true)
	})

	it("never shows while a visible content row is actively streaming, even with the marker", () => {
		const conversation = [say(1, "text", true, "already streaming")]
		const { result } = renderLoader({
			...inputsFor(conversation, { phase: "completed", seq: 5 }),
			optimisticTurnStart: true,
		})
		expect(result.current).toBe(false)
	})

	it("stays visible across the handoff to the authoritative streaming phase", () => {
		const task = say(1, "task", false, "do the thing")
		const withTask = (inputs: ThinkingLoaderInputs): ThinkingLoaderInputs => ({
			...inputs,
			lastRawMessage: task,
			groupedMessages: [],
			lastVisibleRow: undefined,
			lastVisibleMessage: undefined,
			modifiedMessages: [],
		})

		const { result, rerender } = renderLoader({
			...withTask(inputsFor([], { phase: "idle", seq: 1 })),
			optimisticTurnStart: true,
		})
		expect(result.current).toBe(true)

		// The streaming TurnState arrives and ChatView drops the marker in the same pass:
		// the loader must remain visible with no gap (now via the authoritative path).
		rerender({ ...withTask(inputsFor([], streaming(2))), optimisticTurnStart: false })
		expect(result.current).toBe(true)
	})
})
