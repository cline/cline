import { describe, expect, it, vi } from "vitest"
import {
	DEFAULT_MAX_RETRY_ATTEMPTS,
	getExponentialBackoffSeconds,
	MAX_RETRY_DELAY_SECONDS,
	SdkApiRetryCoordinator,
	type SdkApiRetryCoordinatorOptions,
} from "./sdk-api-retry-coordinator"

describe("getExponentialBackoffSeconds", () => {
	it("doubles per attempt (1,2,4,8,16…)", () => {
		const expected = [1, 2, 4, 8, 16, 32, 64, 128, 256]
		expected.forEach((seconds, i) => {
			expect(getExponentialBackoffSeconds(i + 1)).toBe(seconds)
		})
	})

	it("caps at MAX_RETRY_DELAY_SECONDS (300)", () => {
		// 2^9 = 256 < 300, 2^10 = 512 > 300
		expect(getExponentialBackoffSeconds(9)).toBe(256)
		expect(getExponentialBackoffSeconds(10)).toBe(MAX_RETRY_DELAY_SECONDS)
		expect(getExponentialBackoffSeconds(100)).toBe(MAX_RETRY_DELAY_SECONDS)
	})

	it("returns 0 for non-positive / non-integer attempts", () => {
		expect(getExponentialBackoffSeconds(0)).toBe(0)
		expect(getExponentialBackoffSeconds(-1)).toBe(0)
		expect(getExponentialBackoffSeconds(2.5)).toBe(0)
		expect(getExponentialBackoffSeconds(Number.NaN)).toBe(0)
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
	const isRetryIndefinite = vi.fn(() => false)

	const coordinator = new SdkApiRetryCoordinator({
		isAutoRetryEnabled,
		isRetryIndefinite,
		isSessionActive,
		sendTurn,
		emitRetryScheduled,
		random: () => 0,
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
		isAutoRetryEnabled,
		fire,
		lastGuard,
	}
}

describe("SdkApiRetryCoordinator", () => {
	it("schedules a retry with jittered exponential backoff and emits status", () => {
		const { coordinator, timers, emitRetryScheduled, sendTurn, fire } = makeCoordinator()

		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)

		expect(timers).toHaveLength(1)
		// Equal jitter with random()=0 → exactly half the schedule (0.5s).
		expect(timers[0].delayMs).toBe(500)
		expect(emitRetryScheduled).toHaveBeenCalledWith(
			expect.objectContaining({
				attempt: 1,
				delaySeconds: 0.5,
				maxAttempts: DEFAULT_MAX_RETRY_ATTEMPTS,
				error: expect.any(Error),
			}),
		)
		expect(sendTurn).not.toHaveBeenCalled()

		fire()
		expect(sendTurn).toHaveBeenCalledWith("s1", expect.any(Function))
	})

	it("grows the delay exponentially across consecutive failures", () => {
		const { coordinator, timers, fire } = makeCoordinator({ random: () => 1 })

		// The default budget allows exactly DEFAULT_MAX_RETRY_ATTEMPTS retries.
		for (let attempt = 1; attempt <= DEFAULT_MAX_RETRY_ATTEMPTS; attempt++) {
			coordinator.handleSendError(new Error("boom"), "s1")
			// Equal jitter with random()=1 → the full schedule.
			expect(timers.at(-1)?.delayMs).toBe(getExponentialBackoffSeconds(attempt) * 1000)
			fire() // the retried turn fails again
		}
	})

	it("applies equal jitter: the delay lands in [half, full] of the schedule", () => {
		const at = (randomValue: number) => {
			const { coordinator, timers } = makeCoordinator({ random: () => randomValue })
			coordinator.handleSendError(new Error("boom"), "s1")
			return timers[0].delayMs
		}

		expect(at(0)).toBe(500) // attempt 1 schedule is 1s → exactly half
		expect(at(0.5)).toBe(750) // midpoint
		expect(at(1)).toBe(1000) // exactly full
	})

	it("stops after the default attempt budget and leaves recovery to the user", () => {
		const { coordinator, timers, emitRetryScheduled, fire } = makeCoordinator()

		for (let attempt = 1; attempt <= DEFAULT_MAX_RETRY_ATTEMPTS; attempt++) {
			expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)
			fire()
		}
		expect(emitRetryScheduled).toHaveBeenCalledTimes(DEFAULT_MAX_RETRY_ATTEMPTS)

		// The budget is exhausted: no 6th retry is scheduled.
		expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(false)
		expect(timers).toHaveLength(DEFAULT_MAX_RETRY_ATTEMPTS)
		expect(coordinator.currentRetryCount).toBe(0)
	})

	it("retries without a ceiling when the indefinite opt-in is enabled", () => {
		const { coordinator, emitRetryScheduled, fire } = makeCoordinator({ isRetryIndefinite: () => true })

		for (let attempt = 1; attempt <= DEFAULT_MAX_RETRY_ATTEMPTS + 3; attempt++) {
			expect(coordinator.handleSendError(new Error("boom"), "s1")).toBe(true)
			expect(emitRetryScheduled).toHaveBeenLastCalledWith(expect.objectContaining({ attempt, maxAttempts: undefined }))
			fire()
		}
	})

	it.each([
		["auto-retry is disabled", { isAutoRetryEnabled: () => false }],
		["the session is no longer active", { isSessionActive: () => false }],
	] as const)("does not schedule when %s", (_, overrides) => {
		const { coordinator, timers } = makeCoordinator(overrides)

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

	// Retry-After replaces the jittered schedule — the provider explicitly cleared that wait.
	it("honors a server-provided Retry-After over the backoff schedule", () => {
		const { coordinator, timers, emitRetryScheduled } = makeCoordinator({ random: () => 1 })

		expect(coordinator.handleSendError(new Error("rate limited"), "s1", 42)).toBe(true)

		expect(timers[0].delayMs).toBe(42_000) // random()=1 would otherwise jitter to the full 1s
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

	it("does not fire a re-drive when auto-retry was disabled during the countdown", () => {
		const onRetryAbandoned = vi.fn()
		const { coordinator, sendTurn, isAutoRetryEnabled, fire } = makeCoordinator({ onRetryAbandoned })

		coordinator.handleSendError(new Error("boom"), "s1")
		isAutoRetryEnabled.mockReturnValue(false)
		fire()

		expect(sendTurn).not.toHaveBeenCalled()
		expect(onRetryAbandoned).toHaveBeenCalledTimes(1)
	})
})
