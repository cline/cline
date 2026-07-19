// Coalesces frequent postStateToWebview() requests into a single trailing
// rebuild. During a streaming turn the session event coordinator can fire
// postStateToWebview() many times per second; each call rebuilds the full
// ExtensionState (including task history), which is expensive enough to
// saturate the extension host event loop if run on every event. This class
// owns the debounce timer, in-flight/queued bookkeeping, and the resolver
// list, extracted from SdkController so the concurrency behavior can be unit
// tested in isolation.
//
// ## Delta Push (Optional)
//
// Besides full snapshots, this class supports an optional "delta" mode where
// small incremental updates (append a message, update a field) are shipped
// without rebuilding the entire state. The delta is a lightweight JSON payload
// that the webview's convergent-replica reducer applies in place.
//
// Feature flag: controlled by the `sendDelta` callback — if null, falls back
// to full-snapshot flush. This makes the delta path safe for gradual rollout.
import { Logger } from "@/shared/services/Logger"

// ─── Delta Types ───────────────────────────────────────────────────────────

export type StateDelta =
	| { type: "append_message"; message: unknown; version: number }
	| { type: "update_message"; messageId: string; patch: Record<string, unknown>; version: number }
	| { type: "replace_all"; messages: unknown[]; version: number }

/**
 * Variant of `StateDelta` without the `version` field, used by callers
 * that let the debouncer auto-stamp the monotonically increasing version.
 */
export type DeltaPayload =
	| { type: "append_message"; message: unknown }
	| { type: "update_message"; messageId: string; patch: Record<string, unknown> }
	| { type: "replace_all"; messages: unknown[] }

export interface StatePostDebouncerOptions {
	/** Trailing debounce window: bursts of post() calls within this window collapse into one flush. */
	debounceMs: number
	/** Builds and ships the current state snapshot. Rejections propagate to post() callers. */
	flush: () => Promise<void>
	/**
	 * Optional delta sender. When provided, `postDelta()` ships deltas instead
	 * of full snapshots. Callers that `await post()` always wait for the next
	 * flush so consistency is maintained. When null, deltas are silently dropped
	 * and `post()` is the only path.
	 */
	sendDelta?: (delta: StateDelta) => Promise<void>
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
 *
 * `postDelta()` ships an incremental delta (append/update message) without
 * rebuilding the full state. Deltas are fire-and-forget — they do NOT block
 * on delivery — but the next full `flush()` always carries the ground truth.
 */
export class StatePostDebouncer {
	private debounceTimer?: NodeJS.Timeout
	private inFlight = false
	private inFlightPromise?: Promise<void>
	private queued = false
	private pendingResolvers: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
	private disposed = false

	/** Monotonically increasing version counter for delta ordering. */
	private deltaVersion = 0

	constructor(private readonly options: StatePostDebouncerOptions) {}

	/**
	 * Ship an incremental delta to the webview without a full state rebuild.
	 *
	 * Deltas are fire-and-forget: errors are logged but never propagated.
	 * The next full `post()` / `flush()` always carries the ground truth,
	 * so a dropped delta is eventually reconciled.
	 */
	postDelta(delta: DeltaPayload): void {
		if (this.disposed || !this.options.sendDelta) return

		const versioned: StateDelta = { ...delta, version: ++this.deltaVersion } as StateDelta
		this.options.sendDelta(versioned).catch((err) => {
			Logger.error("[StatePostDebouncer] Delta send failed (will reconcile on next full flush):", err)
		})
	}

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
