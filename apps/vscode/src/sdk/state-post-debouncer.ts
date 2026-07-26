// Coalesces frequent postStateToWebview() requests into a single trailing
// rebuild. During a streaming turn the session event coordinator can fire
// postStateToWebview() many times per second; each call rebuilds the full
// ExtensionState (including task history), which is expensive enough to
// saturate the extension host event loop if run on every event. This class
// owns the debounce timer, in-flight/queued bookkeeping, and the resolver
// list, extracted from SdkController so the concurrency behavior can be unit
// tested in isolation.
import { Logger } from "@/shared/services/Logger"

export interface StatePostDebouncerOptions {
	/** Trailing debounce window: bursts of post() calls within this window collapse into one flush. */
	debounceMs: number
	/** Builds and ships the current state snapshot. Rejections propagate to post() callers. */
	flush: () => Promise<void>
}

/**
 * Debounce/coalesce state posts.
 *
 * `post()` resolves once a snapshot reflecting that call has been shipped (or
 * rejects if the flush that shipped it failed — errors are not swallowed, so
 * callers awaiting `post()` can tell a state update did not reach the
 * webview). Requests arriving while a flush is in flight are folded into
 * `queued`; exactly one more flush runs afterward so the final snapshot is
 * never stale.
 */
export class StatePostDebouncer {
	private debounceTimer?: NodeJS.Timeout
	private inFlight = false
	private inFlightPromise?: Promise<void>
	private queued = false
	private pendingResolvers: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
	private disposed = false

	constructor(private readonly options: StatePostDebouncerOptions) {}

	post(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve()
		}
		return new Promise<void>((resolve, reject) => {
			this.pendingResolvers.push({ resolve, reject })
			if (this.debounceTimer) {
				return
			}
			this.debounceTimer = setTimeout(() => {
				this.debounceTimer = undefined
				// If a flush loop is already running, runDebounced() just folds this
				// request into it (via `queued`) and returns a throwaway resolved
				// promise without doing any work. Only track the promise from the
				// call that actually starts the flush loop — otherwise that trivial
				// promise would overwrite the reference to the real, still-running
				// flush, and dispose() could await the wrong one and return while
				// the original flush is still executing.
				const isStartingNewFlush = !this.inFlight
				const runPromise = this.runDebounced()
				if (isStartingNewFlush) {
					this.inFlightPromise = runPromise
				}
			}, this.options.debounceMs)
			this.debounceTimer.unref?.()
		})
	}

	private async runDebounced(): Promise<void> {
		if (this.inFlight) {
			this.queued = true
			return
		}
		this.inFlight = true
		try {
			do {
				this.queued = false
				const resolvers = this.pendingResolvers
				this.pendingResolvers = []
				try {
					await this.options.flush()
					for (const { resolve } of resolvers) {
						resolve()
					}
				} catch (error) {
					// Preserve rejection semantics: callers awaiting post() must see
					// the failure, not a silent success, so command handlers don't
					// assume the webview received a fresh snapshot when it didn't.
					Logger.error("[StatePostDebouncer] Failed to post state to webview:", error)
					for (const { reject } of resolvers) {
						reject(error)
					}
				}
			} while (this.queued && !this.disposed)
		} finally {
			this.inFlight = false
			this.inFlightPromise = undefined
		}
	}

	/**
	 * Tear down the debounce machinery: cancel any pending timer and settle
	 * in-flight awaiters so callers blocked on `post()` don't hang past
	 * disposal. Awaits any flush that's still executing so it either completes
	 * or bails via the `disposed` guard before the caller tears down downstream
	 * resources.
	 */
	async dispose(): Promise<void> {
		this.disposed = true
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = undefined
		}
		this.queued = false
		const pendingResolvers = this.pendingResolvers
		this.pendingResolvers = []
		for (const { resolve } of pendingResolvers) {
			resolve()
		}
		const inFlight = this.inFlightPromise
		if (inFlight) {
			await inFlight.catch(() => {})
			this.inFlightPromise = undefined
		}
	}
}
