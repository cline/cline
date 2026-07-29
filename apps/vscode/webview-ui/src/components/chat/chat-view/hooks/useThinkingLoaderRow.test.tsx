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
