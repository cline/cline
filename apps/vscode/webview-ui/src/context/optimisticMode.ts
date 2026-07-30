import type { Mode } from "@shared/storage/types"

/**
 * Bookkeeping for optimistically rendering a Plan/Act switch.
 *
 * `togglePlanActModeProto` only resolves once the extension has rebuilt the SDK
 * session for the new mode, so rendering the toggle straight from the extension's
 * state snapshots makes it visibly lag the click. The tracker lets the webview
 * paint the target mode immediately while still treating the extension as the
 * source of truth: snapshots that disagree with an in-flight switch are
 * overridden, and once the switch settles the UI snaps to whatever mode the
 * extension last reported (which may be the old one, if the rebuild failed and
 * the extension rolled the setting back).
 */
export interface OptimisticModeTracker {
	/**
	 * Records a switch to `targetMode` as locally applied. The returned callback
	 * must be invoked once the toggle RPC settles; it returns the mode the UI
	 * should render, or `null` when there is nothing to change (a newer switch
	 * has taken over, the extension already agreed, or no snapshot has arrived to
	 * contradict the switch yet).
	 */
	begin(targetMode: Mode): () => Mode | null
	/**
	 * Folds an incoming snapshot's mode into the tracker and returns the mode the
	 * UI should render for it.
	 */
	reconcile(snapshotMode: Mode | undefined): Mode
}

export function createOptimisticModeTracker(initialMode: Mode): OptimisticModeTracker {
	let pendingMode: Mode | null = null
	let serverMode: Mode = initialMode
	let latestRequestId = 0
	let sawSnapshotSincePending = false

	return {
		begin(targetMode: Mode): () => Mode | null {
			const requestId = ++latestRequestId
			pendingMode = targetMode
			sawSnapshotSincePending = false
			return () => {
				// A newer switch owns the override now; settling this stale one
				// would flash the intermediate mode.
				if (requestId !== latestRequestId || pendingMode === null) {
					return null
				}
				const contradicted = sawSnapshotSincePending && serverMode !== targetMode
				pendingMode = null
				// Without a snapshot there is no evidence the extension disagreed,
				// and `serverMode` may still be the pre-switch mode; reverting to it
				// would flicker the toggle back and forth. Releasing the override is
				// enough — the next snapshot corrects the UI if it has to.
				return contradicted ? serverMode : null
			}
		},

		reconcile(snapshotMode: Mode | undefined): Mode {
			serverMode = snapshotMode ?? serverMode
			if (pendingMode === null) {
				return serverMode
			}
			sawSnapshotSincePending = true
			if (pendingMode === serverMode) {
				pendingMode = null
				return serverMode
			}
			// The snapshot predates the in-flight switch (or reflects a rebuild
			// that has not flipped the mode yet), so keep showing the target.
			return pendingMode
		},
	}
}
