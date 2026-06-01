import type { ClineMessage } from "@shared/ExtensionMessage"

// Convergent-replica reducer for the webview's clineMessages transcript.
//
// See apps/vscode/src/sdk/docs/webview-message-state-design.md §6. The webview receives the
// same conversation over two unordered, fire-and-forget channels (incremental partial
// messages and full state snapshots). This reducer makes the transcript converge to the
// correct set under ANY arrival order, duplication, or loss, using three extension-stamped
// quantities:
//
//   - ts    : message identity / merge key (one process-wide monotonic id; see MessageIdMinter)
//   - seq   : freshness within an epoch (higher seq = newer copy of the same ts)
//   - epoch : conversation/replica fence (newer epoch replaces; older is dropped)
//
// The reducer is a pure function so it can be exhaustively unit-tested (including
// property-based, order-independent tests) with no React/gRPC/timers.

/**
 * The webview's replica of the conversation transcript plus the fence/freshness high-water
 * marks needed to reject stale traffic. `messages` is kept as an array (rendering order) and
 * mirrors what the UI consumes.
 */
export interface ReplicaState {
	messages: ClineMessage[]
	/** Highest epoch applied. Messages/snapshots from an older epoch are dropped. */
	epoch: number
	/** Highest per-message seq applied per ts. Used to ignore older copies of the same ts. */
	seqByTs: Map<number, number>
	/** Highest state snapshot version applied. Older snapshots are ignored wholesale. */
	stateVersion: number
}

/** Create an empty replica. */
export function createReplicaState(): ReplicaState {
	return { messages: [], epoch: 0, seqByTs: new Map(), stateVersion: 0 }
}

/**
 * Effective epoch of an incoming item. Unstamped (classic/legacy) items use 0, which equals
 * a fresh replica's epoch, so they merge rather than being dropped.
 */
function epochOf(item: { epoch?: number }): number {
	return item.epoch ?? 0
}

function seqOf(message: ClineMessage): number {
	return message.seq ?? 0
}

/** Replace the replica's transcript wholesale at a new epoch (new task / history load). */
function resetTo(epoch: number, messages: ClineMessage[], stateVersion: number): ReplicaState {
	const seqByTs = new Map<number, number>()
	for (const m of messages) {
		const existing = seqByTs.get(m.ts)
		if (existing === undefined || seqOf(m) >= existing) {
			seqByTs.set(m.ts, seqOf(m))
		}
	}
	return { messages: [...messages], epoch, seqByTs, stateVersion }
}

/**
 * Apply one incoming ClineMessage (from the partial-message stream OR from within a state
 * snapshot). Returns the same state object when the message is stale/ignored, or a new state
 * when it changes the transcript.
 *
 * Rules:
 *  - older epoch  -> drop (straggler from a previous task/render)
 *  - newer epoch  -> the replica resets to this epoch with just this message (a later full
 *                    snapshot at the same epoch will fill in the rest; a lone newer-epoch
 *                    partial is rare but must still advance the fence safely)
 *  - same epoch   -> upsert by ts, keeping the higher seq
 */
export function applyMessage(state: ReplicaState, incoming: ClineMessage): ReplicaState {
	const incomingEpoch = epochOf(incoming)

	if (incomingEpoch < state.epoch) {
		return state
	}

	if (incomingEpoch > state.epoch) {
		return resetTo(incomingEpoch, [incoming], state.stateVersion)
	}

	// Same epoch: merge by ts, keep highest seq.
	const existingSeq = state.seqByTs.get(incoming.ts)
	const index = state.messages.findIndex((m) => m.ts === incoming.ts)

	if (index !== -1) {
		// A copy of this ts already exists. Keep ours unless the incoming is at least as fresh.
		if (existingSeq !== undefined && seqOf(incoming) < existingSeq) {
			return state
		}
		const messages = [...state.messages]
		messages[index] = incoming
		const seqByTs = new Map(state.seqByTs)
		seqByTs.set(incoming.ts, Math.max(existingSeq ?? 0, seqOf(incoming)))
		return { ...state, messages, seqByTs }
	}

	// New ts at the current epoch — append.
	const messages = [...state.messages, incoming]
	const seqByTs = new Map(state.seqByTs)
	seqByTs.set(incoming.ts, seqOf(incoming))
	return { ...state, messages, seqByTs }
}

/**
 * Apply a full state snapshot's transcript.
 *
 *  - older epoch        -> drop entirely
 *  - newer epoch        -> replace the transcript wholesale (new task / history load)
 *  - same epoch:
 *      - older/equal stateVersion -> ignore (a newer snapshot already applied)
 *      - newer stateVersion       -> MERGE each message by ts/seq (NEVER truncate). This is the
 *                                    fix for "last message missing": a snapshot that lacks a
 *                                    message the partial stream already delivered cannot drop it.
 *
 * `snapshotEpoch`/`snapshotVersion` default to 0 (unstamped classic/legacy) which merges.
 */
export function applyStateSnapshot(
	state: ReplicaState,
	snapshotMessages: ClineMessage[],
	snapshotEpoch = 0,
	snapshotVersion = 0,
): ReplicaState {
	if (snapshotEpoch < state.epoch) {
		return state
	}

	if (snapshotEpoch > state.epoch) {
		return resetTo(snapshotEpoch, snapshotMessages, snapshotVersion)
	}

	// Same epoch.
	if (snapshotVersion !== 0 && snapshotVersion <= state.stateVersion) {
		// A newer (or equal) snapshot already applied — ignore this stale one wholesale.
		return state
	}

	// Merge each message; never shrink the transcript for the same task/epoch.
	let next = state
	for (const message of snapshotMessages) {
		next = applyMessage(next, message)
	}
	if (snapshotVersion > next.stateVersion) {
		next = next === state ? { ...state } : next
		next.stateVersion = snapshotVersion
	}
	return next
}
