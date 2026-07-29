import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StatePostDebouncer } from "./state-post-debouncer"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("StatePostDebouncer", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("coalesces bursts of post() calls within the debounce window into a single flush", async () => {
		const flush = vi.fn().mockResolvedValue(undefined)
		const debouncer = new StatePostDebouncer({ debounceMs: 50, flush })

		const p1 = debouncer.post()
		const p2 = debouncer.post()
		const p3 = debouncer.post()

		await vi.advanceTimersByTimeAsync(50)
		await Promise.all([p1, p2, p3])

		expect(flush).toHaveBeenCalledTimes(1)
	})

	it("rejects all callers of the batch when flush() fails, instead of swallowing the error", async () => {
		// Before this fix, runDebouncedStatePost() caught the flush error, logged
		// it, and resolved every pending caller — so postStateToWebview() callers
		// could never observe a failed rebuild. Callers must see the rejection.
		const failure = new Error("boom")
		const flush = vi.fn().mockRejectedValue(failure)
		const debouncer = new StatePostDebouncer({ debounceMs: 50, flush })

		const p1 = debouncer.post()
		const p2 = debouncer.post()
		// Attach rejection handlers to both promises before awaiting either, so
		// neither is briefly "unhandled" while the other's assertion runs.
		const settled = Promise.allSettled([p1, p2])

		await vi.advanceTimersByTimeAsync(50)

		const [result1, result2] = await settled
		expect(result1).toEqual({ status: "rejected", reason: failure })
		expect(result2).toEqual({ status: "rejected", reason: failure })
	})

	it("does not let a request that joins an in-flight flush overwrite the tracked in-flight promise", async () => {
		// Regression test for the P1 dispose race: a second debounced timer that
		// fires while a flush is already running must fold into the running flush
		// via `queued` rather than replacing the internal in-flight promise with
		// a throwaway resolved one. Otherwise dispose() could await the wrong
		// (already-resolved) promise and tear down resources while the original,
		// still-running flush is mid-execution.
		let resolveFirstFlush: (() => void) | undefined
		const firstFlushGate = new Promise<void>((resolve) => {
			resolveFirstFlush = resolve
		})
		let flushCallCount = 0
		const flush = vi.fn(async () => {
			flushCallCount += 1
			if (flushCallCount === 1) {
				await firstFlushGate
			}
		})
		const debouncer = new StatePostDebouncer({ debounceMs: 50, flush })

		// First post() starts the debounce timer; once it fires, flush() #1 begins
		// and blocks on firstFlushGate.
		const p1 = debouncer.post()
		await vi.advanceTimersByTimeAsync(50)
		expect(flush).toHaveBeenCalledTimes(1)

		// A second post() arrives while flush #1 is still in flight. Its debounce
		// timer fires while `inFlight` is still true, so runDebounced() must fold
		// it into the running loop (via `queued`) rather than starting a second,
		// independently-tracked flush.
		const p2 = debouncer.post()
		await vi.advanceTimersByTimeAsync(50)

		// dispose() races the still-running flush #1. If the internal in-flight
		// promise had been overwritten by the second (queued, no-op) call, this
		// would resolve well before flush #1 finishes.
		let disposeResolved = false
		const disposePromise = debouncer.dispose().then(() => {
			disposeResolved = true
		})

		// Drain many microtask ticks (generously more than the couple of hops
		// needed to unwrap an already-settled promise chain) without resolving
		// firstFlushGate. dispose() must still be pending — it can only resolve
		// once the real, still-running flush #1 finishes.
		for (let i = 0; i < 50; i++) {
			await Promise.resolve()
		}
		expect(disposeResolved).toBe(false)

		resolveFirstFlush?.()
		await disposePromise
		expect(disposeResolved).toBe(true)

		// The queued second flush runs once flush #1 completes and dispose() has
		// not yet forced an early loop exit.
		await p1
		await p2.catch(() => {})
	})

	it("post() resolves immediately without shipping state after dispose", async () => {
		const flush = vi.fn().mockResolvedValue(undefined)
		const debouncer = new StatePostDebouncer({ debounceMs: 50, flush })

		await debouncer.dispose()
		await debouncer.post()

		expect(flush).not.toHaveBeenCalled()
	})
})
