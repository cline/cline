import { describe, expect, it, vi } from "vitest"
import {
	FIRST_RETRY_DELAY_SECONDS,
	getFibonacciRetryDelaySeconds,
	MAX_RETRY_DELAY_SECONDS,
	SdkApiRetryCoordinator,
	type SdkApiRetryCoordinatorOptions,
} from "./sdk-api-retry-coordinator"

describe("getFibonacciRetryDelaySeconds", () => {
	it("follows the Fibonacci schedule (3, 5, 8, 13, 21, …)", () => {
		const expected = [3, 5, 8, 13, 21, 34, 55, 89, 144, 233]
		expected.forEach((seconds, i) => {
			expect(getFibonacciRetryDelaySeconds(i + 1)).toBe(seconds)
		})
	})

	it("caps at MAX_RETRY_DELAY_SECONDS (300)", () => {
		// fib(11) = 377 > 300
		expect(getFibonacciRetryDelaySeconds(10)).toBe(233)
		expect(getFibonacciRetryDelaySeconds(11)).toBe(MAX_RETRY_DELAY_SECONDS)
		expect(getFibonacciRetryDelaySeconds(100)).toBe(MAX_RETRY_DELAY_SECONDS)
	})

	it("returns 0 for non-positive / non-integer attempts", () => {
		expect(getFibonacciRetryDelaySeconds(0)).toBe(0)
		expect(getFibonacciRetryDelaySeconds(-1)).toBe(0)
		expect(getFibonacciRetryDelaySeconds(2.5)).toBe(0)
		expect(getFibonacciRetryDelaySeconds(Number.NaN)).toBe(0)
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

	const coordinator = new SdkApiRetryCoordinator({
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

	// Guard handed to the most recent sendTurn call.
	const lastGuard = () => sendTurn.mock.calls.at(-1)?.[1] as () => boolean

	return {
		coordinator,
		timers,
		sendTurn,
		emitRetryScheduled,
		isSessionActive,
		fire,
		lastGuard,
	}
}

describe("SdkApiRetryCoordinator", () => {
	it("schedules a retry on the Fibonacci schedule and emits status", () => {
		const { coordinator, timers, emitRetryScheduled, sendTurn, fire } = makeCoordinator()

		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)

		expect(timers).toHaveLength(1)
		// Deterministic schedule: attempt 1 waits exactly 3s (no jitter).
		expect(timers[0].delayMs).toBe(FIRST_RETRY_DELAY_SECONDS * 1000)
		expect(emitRetryScheduled).toHaveBeenCalledWith(
			expect.objectContaining({
				attempt: 1,
				delaySeconds: FIRST_RETRY_DELAY_SECONDS,
				error: expect.any(Error),
			}),
		)
		expect(sendTurn).not.toHaveBeenCalled()

		fire()
		expect(sendTurn).toHaveBeenCalledWith("s1", expect.any(Function))
	})

	it("grows the delay along the Fibonacci sequence across consecutive failures", () => {
		const { coordinator, timers, fire } = makeCoordinator()

		for (let attempt = 1; attempt <= 8; attempt++) {
			coordinator.handleSendError(new Error("boom"), "s1")
			expect(timers.at(-1)?.delayMs).toBe(getFibonacciRetryDelaySeconds(attempt) * 1000)
			fire() // the retried turn fails again
		}
	})

	it("retries indefinitely — no attempt budget, delay capped at the max", () => {
		const { coordinator, emitRetryScheduled, fire } = makeCoordinator()

		for (let attempt = 1; attempt <= 12; attempt++) {
			expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)
			expect(emitRetryScheduled).toHaveBeenLastCalledWith(expect.objectContaining({ attempt }))
			fire()
		}
		expect(emitRetryScheduled).toHaveBeenCalledTimes(12)
		// fib(11) = 377 is clamped to the 300s ceiling and stays there.
		expect(emitRetryScheduled).toHaveBeenLastCalledWith(expect.objectContaining({ delaySeconds: MAX_RETRY_DELAY_SECONDS }))
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
		const { coordinator, timers, sendTurn, fire } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		expect(coordinator.hasPendingRetry).toBe(true)
		coordinator.cancel()
		expect(coordinator.hasPendingRetry).toBe(false)

		fire() // timer was cancelled; nothing should run
		timers[0].fn() // a straggler firing of the cancelled timer must also be a no-op
		expect(sendTurn).not.toHaveBeenCalled()
		expect(coordinator.currentRetryCount).toBe(0)
	})

	it("skips the send and reports abandonment when the session died while waiting", () => {
		const onRetryAbandoned = vi.fn()
		const { coordinator, sendTurn, isSessionActive, fire } = makeCoordinator({ onRetryAbandoned })

		coordinator.handleSendError(new Error("boom"), "s1")
		isSessionActive.mockReturnValue(false) // session replaced/cleared while waiting
		fire()

		expect(sendTurn).not.toHaveBeenCalled()
		expect(onRetryAbandoned).toHaveBeenCalledTimes(1)
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

	// Retry-After replaces the schedule — the provider explicitly cleared that wait.
	it("honors a server-provided Retry-After over the backoff schedule", () => {
		const { coordinator, timers, emitRetryScheduled } = makeCoordinator()

		expect(coordinator.handleSendError(new Error("rate limited"), "s1", 42)).toBe(true)

		expect(timers[0].delayMs).toBe(42_000)
		expect(emitRetryScheduled).toHaveBeenCalledWith(
			expect.objectContaining({ attempt: 1, delaySeconds: 42, error: expect.any(Error) }),
		)
	})

	it("hands the re-drive a guard that flips once cancel() lands", () => {
		const { coordinator, sendTurn, fire, lastGuard } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		fire()
		expect(sendTurn).toHaveBeenCalledTimes(1)
		expect(lastGuard()()).toBe(false)
		coordinator.cancel()
		expect(lastGuard()()).toBe(true)
	})

	it("reset() also invalidates an in-flight re-drive", () => {
		const { coordinator, fire, lastGuard } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		fire()
		// e.g. a later turn succeeded while the re-drive was still queued in the funnel
		coordinator.reset()
		expect(lastGuard()()).toBe(true)
	})

	it("a newer scheduled retry invalidates the older re-drive's guard", () => {
		const { coordinator, sendTurn, fire, lastGuard } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		fire()
		const staleGuard = lastGuard()
		coordinator.handleSendError(new Error("boom2"), "s1")
		expect(staleGuard()).toBe(true)
		fire()
		expect(sendTurn).toHaveBeenCalledTimes(2)
		expect(lastGuard()()).toBe(false)
	})

	it("marks the guard cancelled when the session was replaced mid-re-drive", () => {
		const { coordinator, isSessionActive, fire, lastGuard } = makeCoordinator()

		coordinator.handleSendError(new Error("boom"), "s1")
		fire()
		isSessionActive.mockReturnValue(false)
		expect(lastGuard()()).toBe(true)
	})

	it("does not fire a re-drive when the retry was cancelled during the countdown", () => {
		const onRetryAbandoned = vi.fn()
		const { coordinator, sendTurn, timers } = makeCoordinator({ onRetryAbandoned })

		coordinator.handleSendError(new Error("boom"), "s1")
		coordinator.cancel()

		// Even a stray late wake-up of the cancelled timer cannot send — the
		// generation guard invalidates it, and the abandonment callback fires.
		timers[0]?.fn()

		expect(sendTurn).not.toHaveBeenCalled()
		expect(onRetryAbandoned).toHaveBeenCalledTimes(1)
	})
})
