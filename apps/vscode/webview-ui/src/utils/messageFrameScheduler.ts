/**
 * Frame-coalesced update scheduling (V12 方案6 — high-frequency message debounce).
 *
 * Streaming deltas, partial messages and snapshots arrive as separate gRPC
 * callbacks (separate macrotasks), so without coalescing each one triggers its
 * own React render — mid-frame renders are wasted. This utility merges all
 * publishes that happen within a single animation frame into one flush.
 *
 * The scheduler function is injectable so the logic can be unit-tested with
 * fake timers/callbacks.
 */

export type FrameScheduler = (callback: () => void) => () => void

export interface FrameCoalescer {
	/** Mark a pending update; at most one scheduled flush per frame. */
	schedule: () => void
	/** Cancel a scheduled (but not yet run) flush. */
	cancel: () => void
	/** Run the flush immediately, cancelling any pending frame. */
	flushNow: () => void
}

export function createFrameCoalescer(flush: () => void, scheduleFrame: FrameScheduler): FrameCoalescer {
	let pending = false
	let cancelScheduled: (() => void) | null = null

	const runFlush = () => {
		pending = false
		cancelScheduled = null
		flush()
	}

	return {
		schedule() {
			if (pending) {
				return
			}
			pending = true
			cancelScheduled = scheduleFrame(runFlush)
		},
		cancel() {
			cancelScheduled?.()
			cancelScheduled = null
			pending = false
		},
		flushNow() {
			if (cancelScheduled) {
				cancelScheduled()
				cancelScheduled = null
			}
			pending = false
			flush()
		},
	}
}

/**
 * Default scheduler: `requestAnimationFrame` when the document is visible
 * (Chromium webview), otherwise a ~1-frame `setTimeout` fallback so backgrounded
 * webviews still converge promptly.
 */
export const scheduleAnimationFrame: FrameScheduler = (callback) => {
	if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && !document.hidden) {
		const handle = requestAnimationFrame(callback)
		return () => cancelAnimationFrame(handle)
	}
	const handle = setTimeout(callback, 16)
	return () => clearTimeout(handle)
}
