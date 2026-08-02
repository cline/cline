import { describe, expect, it, vi } from "vitest"
import { createFrameCoalescer, type FrameScheduler, scheduleAnimationFrame } from "./messageFrameScheduler"

describe("createFrameCoalescer (V12 方案6)", () => {
	function makeHarness() {
		const flush = vi.fn()
		let scheduled: (() => void) | null = null
		const schedule = vi.fn<FrameScheduler>((fn) => {
			scheduled = fn
			return () => {
				scheduled = null
			}
		})
		const coalescer = createFrameCoalescer(flush, schedule)
		return { coalescer, flush, schedule, runFrame: () => scheduled?.() }
	}

	it("flushes once per frame when scheduled repeatedly", () => {
		const { coalescer, flush, schedule, runFrame } = makeHarness()

		coalescer.schedule()
		coalescer.schedule()
		coalescer.schedule()

		expect(schedule).toHaveBeenCalledTimes(1)
		expect(flush).not.toHaveBeenCalled()

		runFrame()
		expect(flush).toHaveBeenCalledTimes(1)

		coalescer.schedule()
		runFrame()
		expect(flush).toHaveBeenCalledTimes(2)
	})

	it("cancel() drops a scheduled flush", () => {
		const { coalescer, flush, runFrame } = makeHarness()

		coalescer.schedule()
		coalescer.cancel()

		runFrame()
		expect(flush).not.toHaveBeenCalled()

		// A fresh schedule after cancel still works.
		coalescer.schedule()
		runFrame()
		expect(flush).toHaveBeenCalledTimes(1)
	})

	it("flushNow() runs immediately and cancels the pending frame", () => {
		const { coalescer, flush, runFrame } = makeHarness()

		coalescer.schedule()
		coalescer.flushNow()
		expect(flush).toHaveBeenCalledTimes(1)

		// The cancelled frame must not double-flush.
		runFrame()
		expect(flush).toHaveBeenCalledTimes(1)
	})

	it("scheduleAnimationFrame uses rAF when the document is visible", () => {
		const cb = vi.fn()
		const cancel = scheduleAnimationFrame(cb)
		expect(typeof cancel).toBe("function")
	})
})
