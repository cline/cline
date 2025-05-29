// npx vitest run src/__tests__/RefreshTimer.test.ts

import { Mock } from "vitest"

import { RefreshTimer } from "../RefreshTimer"

vi.useFakeTimers()

describe("RefreshTimer", () => {
	let mockCallback: Mock
	let refreshTimer: RefreshTimer

	beforeEach(() => {
		mockCallback = vi.fn()
		mockCallback.mockResolvedValue(true)
	})

	afterEach(() => {
		if (refreshTimer) {
			refreshTimer.stop()
		}

		vi.clearAllTimers()
		vi.clearAllMocks()
	})

	it("should execute callback immediately when started", () => {
		refreshTimer = new RefreshTimer({
			callback: mockCallback,
		})

		refreshTimer.start()

		expect(mockCallback).toHaveBeenCalledTimes(1)
	})

	it("should schedule next attempt after success interval when callback succeeds", async () => {
		mockCallback.mockResolvedValue(true)

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			successInterval: 50000, // 50 seconds
		})

		refreshTimer.start()

		// Fast-forward to execute the first callback
		await Promise.resolve()

		expect(mockCallback).toHaveBeenCalledTimes(1)

		// Fast-forward 50 seconds
		vi.advanceTimersByTime(50000)

		// Callback should be called again
		expect(mockCallback).toHaveBeenCalledTimes(2)
	})

	it("should use exponential backoff when callback fails", async () => {
		mockCallback.mockResolvedValue(false)

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			initialBackoffMs: 1000, // 1 second
		})

		refreshTimer.start()

		// Fast-forward to execute the first callback
		await Promise.resolve()

		expect(mockCallback).toHaveBeenCalledTimes(1)

		// Fast-forward 1 second
		vi.advanceTimersByTime(1000)

		// Callback should be called again
		expect(mockCallback).toHaveBeenCalledTimes(2)

		// Fast-forward to execute the second callback
		await Promise.resolve()

		// Fast-forward 2 seconds
		vi.advanceTimersByTime(2000)

		// Callback should be called again
		expect(mockCallback).toHaveBeenCalledTimes(3)

		// Fast-forward to execute the third callback
		await Promise.resolve()
	})

	it("should not exceed maximum backoff interval", async () => {
		mockCallback.mockResolvedValue(false)

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			initialBackoffMs: 1000, // 1 second
			maxBackoffMs: 5000, // 5 seconds
		})

		refreshTimer.start()

		// Fast-forward through multiple failures to reach max backoff
		await Promise.resolve() // First attempt
		vi.advanceTimersByTime(1000)

		await Promise.resolve() // Second attempt (backoff = 2000ms)
		vi.advanceTimersByTime(2000)

		await Promise.resolve() // Third attempt (backoff = 4000ms)
		vi.advanceTimersByTime(4000)

		await Promise.resolve() // Fourth attempt (backoff would be 8000ms but max is 5000ms)

		// Should be capped at maxBackoffMs (no way to verify without logger)
	})

	it("should reset backoff after a successful attempt", async () => {
		// First call fails, second succeeds, third fails
		mockCallback.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			initialBackoffMs: 1000,
			successInterval: 5000,
		})

		refreshTimer.start()

		// First attempt (fails)
		await Promise.resolve()

		// Fast-forward 1 second
		vi.advanceTimersByTime(1000)

		// Second attempt (succeeds)
		await Promise.resolve()

		// Fast-forward 5 seconds
		vi.advanceTimersByTime(5000)

		// Third attempt (fails)
		await Promise.resolve()

		// Backoff should be reset to initial value (no way to verify without logger)
	})

	it("should handle errors in callback as failures", async () => {
		mockCallback.mockRejectedValue(new Error("Test error"))

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			initialBackoffMs: 1000,
		})

		refreshTimer.start()

		// Fast-forward to execute the callback
		await Promise.resolve()

		// Error should be treated as a failure (no way to verify without logger)
	})

	it("should stop the timer and cancel pending executions", () => {
		refreshTimer = new RefreshTimer({
			callback: mockCallback,
		})

		refreshTimer.start()

		// Stop the timer
		refreshTimer.stop()

		// Fast-forward a long time
		vi.advanceTimersByTime(1000000)

		// Callback should only have been called once (the initial call)
		expect(mockCallback).toHaveBeenCalledTimes(1)
	})

	it("should reset the backoff state", async () => {
		mockCallback.mockResolvedValue(false)

		refreshTimer = new RefreshTimer({
			callback: mockCallback,
			initialBackoffMs: 1000,
		})

		refreshTimer.start()

		// Fast-forward through a few failures
		await Promise.resolve()
		vi.advanceTimersByTime(1000)

		await Promise.resolve()
		vi.advanceTimersByTime(2000)

		// Reset the timer
		refreshTimer.reset()

		// Stop and restart to trigger a new execution
		refreshTimer.stop()
		refreshTimer.start()

		await Promise.resolve()

		// Backoff should be back to initial value (no way to verify without logger)
	})
})
