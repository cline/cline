import { describe, expect, it, vi } from "bun:test"
import {
	getFibonacciBackoffSeconds,
	MAX_RETRY_DELAY_SECONDS,
	SdkApiRetryCoordinator,
	type SdkApiRetryCoordinatorOptions,
} from "./sdk-api-retry-coordinator"

describe("getFibonacciBackoffSeconds", () => {
	it("produces the Fibonacci sequence 1,1,2,3,5,8,13…", () => {
		const expected = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
		expected.forEach((seconds, i) => {
			expect(getFibonacciBackoffSeconds(i + 1)).toBe(seconds)
		})
	})

	it("caps at MAX_RETRY_DELAY_SECONDS (300)", () => {
		// F(14) = 377 > 300, F(13) = 233 < 300
		expect(getFibonacciBackoffSeconds(13)).toBe(233)
		expect(getFibonacciBackoffSeconds(14)).toBe(MAX_RETRY_DELAY_SECONDS)
		expect(getFibonacciBackoffSeconds(100)).toBe(MAX_RETRY_DELAY_SECONDS)
	})

	it("returns 0 for non-positive / non-integer attempts", () => {
		expect(getFibonacciBackoffSeconds(0)).toBe(0)
		expect(getFibonacciBackoffSeconds(-1)).toBe(0)
		expect(getFibonacciBackoffSeconds(2.5)).toBe(0)
		expect(getFibonacciBackoffSeconds(Number.NaN)).toBe(0)
	})
})

interface FakeTimer {
	fn: () => void
	delayMs: number
	cancelled: boolean
}

function makeCoordinator(overrides: Partial<SdkApiRetryCoordinatorOptions> = {}) {
	const timers: FakeTimer[] = []
	const sendTurn = vi.fn()
	const emitRetryScheduled = vi.fn()
	const isSessionActive = vi.fn(() => true)
	const isAutoRetryEnabled = vi.fn(() => true)

	const coordinator = new SdkApiRetryCoordinator({
		isAutoRetryEnabled,
		isSessionActive,
		sendTurn,
		emitRetryScheduled,
		scheduleTimer: (fn, delayMs) => {
			const handle: FakeTimer = { fn, delayMs, cancelled: false }
			timers.push(handle)
			// Return the FakeTimer object itself as the opaque handle.
			return handle as unknown as ReturnType<typeof setTimeout>
		},
		cancelTimer: (handle) => {
			const fake = handle as unknown as FakeTimer
			fake.cancelled = true
		},
		...overrides,
	})

	// Fire the most-recently-scheduled, non-cancelled timer (mirrors a real
	// single-pending-timer setup).
	const fire = () => {
		const pending = [...timers].reverse().find((t) => !t.cancelled)
		pending?.fn()
	}

	return { coordinator, timers, sendTurn, emitRetryScheduled, isSessionActive, isAutoRetryEnabled, fire }
}

describe("SdkApiRetryCoordinator", () => {
	it("schedules a retry with the first Fibonacci delay and emits status", () => {
		const { coordinator, timers, emitRetryScheduled, sendTurn, fire } = makeCoordinator()

		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)

		expect(timers).toHaveLength(1)
		expect(timers[0].delayMs).toBe(1000) // F(1) = 1s
		expect(emitRetryScheduled).toHaveBeenCalledWith(
			expect.objectContaining({ attempt: 1, delaySeconds: 1, error: expect.any(Error) }),
		)
		expect(sendTurn).not.toHaveBeenCalled()

		fire()
		expect(sendTurn).toHaveBeenCalledWith("s1")
	})

	it("increments the Fibonacci backoff across consecutive failures", () => {
		const { coordinator, timers, emitRetryScheduled, fire } = makeCoordinator()

		for (let attempt = 1; attempt <= 6; attempt++) {
			coordinator.handleSendError(new Error("boom"), "s1")
			expect(timers.at(-1)?.delayMs).toBe(getFibonacciBackoffSeconds(attempt) * 1000)
			expect(emitRetryScheduled).toHaveBeenLastCalledWith(
				expect.objectContaining({ attempt, delaySeconds: getFibonacciBackoffSeconds(attempt) }),
			)
			fire() // the retry itself "fails" → next handleSendError
		}
	})

	it("does not schedule when auto-retry is disabled", () => {
		// Use vi.fn so we can assert the coordinator actually consulted it.
		const isAutoRetryEnabled = vi.fn(() => false)
		const { coordinator, timers } = makeCoordinator({ isAutoRetryEnabled })

		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(false)
		expect(timers).toHaveLength(0)
		expect(isAutoRetryEnabled).toHaveBeenCalled()
	})

	it("does not schedule when the session is no longer active", () => {
		const { coordinator, timers } = makeCoordinator({ isSessionActive: () => false })

		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(false)
		expect(timers).toHaveLength(0)
	})

	it("reset() clears the pending timer and restarts the counter after success", () => {
		const { coordinator, emitRetryScheduled, fire } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		fire()
		coordinator.reset()
		expect(coordinator.currentRetryCount).toBe(0)

		// next failure starts fresh at attempt 1
		coordinator.handleSendError(new Error("boom2"), "s1")
		expect(emitRetryScheduled).toHaveBeenLastCalledWith(expect.objectContaining({ attempt: 1 }))
	})

	it("cancel() stops a pending retry so it never fires", () => {
		const { coordinator, sendTurn, fire } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		expect(coordinator.hasPendingRetry).toBe(true)
		coordinator.cancel()
		expect(coordinator.hasPendingRetry).toBe(false)

		fire() // timer was cancelled; nothing should run
		expect(sendTurn).not.toHaveBeenCalled()
		expect(coordinator.currentRetryCount).toBe(0)
	})

	it("skips the send if the session became inactive between schedule and fire", () => {
		const { coordinator, sendTurn, isSessionActive, fire } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		isSessionActive.mockReturnValue(false) // session replaced/cleared while waiting
		fire()

		expect(sendTurn).not.toHaveBeenCalled()
	})

	it("a new failure supersedes a prior pending retry without double-firing", () => {
		const { coordinator, timers, sendTurn, fire } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		expect(timers[0].cancelled).toBe(false)

		// second failure arrives before the first fired
		coordinator.handleSendError(new Error("boom2"), "s1")
		expect(timers).toHaveLength(2)
		expect(timers[0].cancelled).toBe(true) // first timer cancelled
		expect(coordinator.currentRetryCount).toBe(2)

		fire()
		expect(sendTurn).toHaveBeenCalledTimes(1)
	})

	// Regression: the user-visible failure
	//   "Cannot connect to API:: AggregateError: connect ETIMEDOUT 43.159.106.97:443"
	// (and every other transport/network error that escapes the SDK's own 3-attempt
	// in-stream retry) must be retried continuously by the coordinator. The
	// coordinator is deliberately error-agnostic — it never inspects the error
	// type, so this test guards against anyone later adding error-class filtering
	// that would stop the retry on transient connectivity failures.
	it("retries ETIMEDOUT / 'Cannot connect to API' network failures continuously (non-stopping)", () => {
		const { coordinator, timers, sendTurn, emitRetryScheduled, fire } = makeCoordinator()

		// Exact shape observed in production: a plain Error whose message embeds
		// the raw AggregateError + ETIMEDOUT text from Node's fetch layer.
		const etimedout = new Error("Cannot connect to API:: AggregateError: connect ETIMEDOUT 43.159.106.97:443 (ETIMEDOUT)")

		// Simulate a persistent outage: the endpoint stays down across many turns,
		// each retry fails again. The coordinator must keep going — there is no
		// max-attempts ceiling.
		const consecutiveFailures = 8
		for (let attempt = 1; attempt <= consecutiveFailures; attempt++) {
			expect(coordinator.handleSendError(etimedout, "s1")).toBe(true)
			expect(coordinator.currentRetryCount).toBe(attempt)
			expect(timers.at(-1)?.delayMs).toBe(getFibonacciBackoffSeconds(attempt) * 1000)
			expect(emitRetryScheduled).toHaveBeenLastCalledWith(
				expect.objectContaining({ attempt, delaySeconds: getFibonacciBackoffSeconds(attempt) }),
			)
			fire() // the retried turn fails again → next handleSendError
			expect(sendTurn).toHaveBeenCalledTimes(attempt)
		}

		// After 8 consecutive failures the streak is still alive and incrementing —
		// proof the mechanism does not give up on a prolonged network outage.
		expect(coordinator.hasPendingRetry).toBe(false) // last fire consumed the timer
		expect(coordinator.currentRetryCount).toBe(consecutiveFailures)
		// ...and the very next failure schedules attempt 9, not a reset.
		expect(coordinator.handleSendError(etimedout, "s1")).toBe(true)
		expect(coordinator.currentRetryCount).toBe(consecutiveFailures + 1)
	})
})
