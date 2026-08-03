import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"

// Convergent-replica reducer for the webview's clineMessages transcript.
//
// The webview receives the same conversation over two unordered, fire-and-forget channels
// (incremental partial messages and full state snapshots). This reducer makes the transcript
// converge to the correct set under ANY arrival order, duplication, or loss, using three
// extension-stamped quantities:
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
	/**
	 * The authoritative UI mode for the current turn. Moves forward by `turnState.seq` only, so a
	 * late/out-of-order snapshot carrying an older phase (e.g. "idle") can never revert a newer
	 * phase (e.g. "streaming"). `undefined` for classic/legacy state with no turnState.
	 */
	turnState?: TurnState
	/**
	 * True while the visible transcript is a truncated window of a longer conversation (older
	 * messages can still be loaded via loadHistoryBatch). Owned by the state snapshot so it is
	 * reset automatically whenever the conversation fence (epoch) is bumped — a stale value from
	 * a previous task can otherwise lock the scroll-up pagination in a wrong state.
	 */
	messageTruncated?: boolean
	/** Total number of messages in the full conversation (visible + older batches). */
	totalMessageCount?: number
}

/** Create an empty replica. */
export function createReplicaState(): ReplicaState {
	return {
		messages: [],
		epoch: 0,
		seqByTs: new Map(),
		stateVersion: 0,
		turnState: undefined,
		messageTruncated: false,
		totalMessageCount: undefined,
	}
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
function resetTo(
	epoch: number,
	messages: ClineMessage[],
	stateVersion: number,
	turnState?: TurnState,
	messageTruncated?: boolean,
	totalMessageCount?: number,
): ReplicaState {
	const seqByTs = new Map<number, number>()
	for (const m of messages) {
		const existing = seqByTs.get(m.ts)
		if (existing === undefined || seqOf(m) >= existing) {
			seqByTs.set(m.ts, seqOf(m))
		}
	}
	return {
		messages: [...messages],
		epoch,
		seqByTs,
		stateVersion,
		turnState,
		messageTruncated,
		totalMessageCount,
	}
}

/**
 * Apply a TurnState update, gated by `seq`. The replica keeps the highest-seq TurnState and
 * ignores older ones, so a late/out-of-order "streaming" can never overwrite a newer
 * "completed" (and vice-versa). Returns the same state when ignored.
 */
export function applyTurnState(state: ReplicaState, incoming: TurnState | undefined): ReplicaState {
	if (!incoming) {
		return state
	}
	if (state.turnState !== undefined && incoming.seq <= state.turnState.seq) {
		return state
	}
	return { ...state, turnState: incoming }
}

/**
 * Apply one incoming ClineMessage (from the partial-message stream OR from within a state
 * snapshot). Returns the same state object when the message is stale/ignored, or a new state
 * when it changes the transcript.
 *
 * Rules:
 *  - older epoch  -> drop (straggler from a previous task/render)
 *  - newer epoch  -> advance the fence, but do NOT discard the existing transcript on the
 *                    strength of a single message. The authoritative wholesale replace for a
 *                    new task/render comes from a full state snapshot (applyStateSnapshot); a
 *                    lone newer-epoch *partial* (e.g. a bookkeeping api_req_started that raced
 *                    ahead of its snapshot) must not empty a live conversation — that would
 *                    strand the webview at messages.length === 0 and route Enter to newTask().
 *                    So we bump the epoch and append/merge this one message; the snapshot that
 *                    follows will reconcile to the true new-task transcript.
 *  - same epoch   -> upsert by ts, keeping the higher seq
 */
export function applyMessage(state: ReplicaState, incoming: ClineMessage): ReplicaState {
	const incomingEpoch = epochOf(incoming)

	if (incomingEpoch < state.epoch) {
		return state
	}

	if (incomingEpoch > state.epoch) {
		// Advance the fence without throwing away an existing transcript. Carry the prior
		// messages forward at the new epoch and merge this one in; a subsequent newer-epoch
		// snapshot performs the real wholesale replace when a genuine new task begins.
		const advanced: ReplicaState = {
			messages: [...state.messages],
			epoch: incomingEpoch,
			seqByTs: new Map(state.seqByTs),
			stateVersion: state.stateVersion,
			turnState: state.turnState,
		}
		return applyMessage(advanced, incoming)
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
 *
 * `snapshotTurnState` (when present) is applied through the same seq gate as applyTurnState: a
 * newer epoch adopts it wholesale; otherwise it only advances the replica's turnState if its
 * seq is higher. This is what stops a late/stale snapshot from reverting "streaming" -> "idle".
 */
/**
 * Prepend a batch of older messages to the transcript (scroll-up pagination).
 *
 * Called when the webview receives a LoadHistoryBatchResponse with messages
 * chronologically older than the oldest currently visible one. Messages are
 * placed at the front of the array in chronological order.
 */
export function applyBatchPrepend(
	state: ReplicaState,
	incomingMessages: ClineMessage[],
	newEpoch?: number,
	newTotalCount?: number,
): ReplicaState {
	if (incomingMessages.length === 0) {
		return state
	}

	// Freshness gate: only apply messages from not-older epoch
	const batchEpoch = newEpoch ?? state.epoch
	if (batchEpoch < state.epoch) {
		return state
	}

	const messages = [...state.messages]
	const seqByTs = new Map(state.seqByTs)

	// Track the oldest ts before prepend for ordering
	const oldestTs = messages.length > 0 ? messages[0].ts : Infinity

	// Filter incoming to only ts not already seen (at equal-or-newer seq)
	const newMessages: ClineMessage[] = []
	for (const msg of incomingMessages) {
		const existingSeq = seqByTs.get(msg.ts)
		const incomingSeq = seqOf(msg)
		if (existingSeq !== undefined && incomingSeq < existingSeq) {
			continue // We already have a newer copy
		}
		seqByTs.set(msg.ts, incomingSeq)
		newMessages.push(msg)
	}

	if (newMessages.length === 0) {
		return state
	}

	// Separate into "before oldest" and "after oldest" to maintain order
	const beforeOldest: ClineMessage[] = []
	const afterOldest: ClineMessage[] = []
	for (const msg of newMessages) {
		if (msg.ts < oldestTs) {
			beforeOldest.push(msg)
		} else {
			afterOldest.push(msg)
		}
	}

	// Sort each group chronologically
	beforeOldest.sort((a, b) => a.ts - b.ts)
	afterOldest.sort((a, b) => a.ts - b.ts)

	// Prepend beforeOldest, then existing messages, then afterOldest (shouldn't happen but be safe)
	const merged = [...beforeOldest, ...messages, ...afterOldest]
	const epoch = batchEpoch > state.epoch ? batchEpoch : state.epoch

	return {
		...state,
		messages: merged,
		epoch,
		seqByTs,
		// The batch response reports the full conversation size; adopt it so the UI
		// header can show accurate progress even after older pages are prepended.
		totalMessageCount: newTotalCount ?? state.totalMessageCount,
	}
}

/**
 * Batch-merge a snapshot's message array into the replica in a single
 * O(N+M) pass (N = existing messages, M = incoming messages), preserving
 * existing transcript order and the per-ts highest-seq rule.
 *
 * This replaces the previous O(N²) loop (`applyMessage` per message, each
 * rebuilding the full array + Map). For a 50-message window this drops the
 * snapshot-merge cost from ~2500 element copies to ~100.
 */
function mergeMessagesBatch(state: ReplicaState, incomingMessages: ClineMessage[]): ReplicaState {
	if (incomingMessages.length === 0) {
		return state
	}

	// Phase 1 — dedupe incoming by ts (keep highest seq) without touching arrays.
	const freshestIncoming = new Map<number, ClineMessage>()
	for (const message of incomingMessages) {
		const existing = freshestIncoming.get(message.ts)
		if (existing === undefined || seqOf(message) >= seqOf(existing)) {
			freshestIncoming.set(message.ts, message)
		}
	}

	// Phase 2 — decide which ts actually change the transcript.
	let changed = false
	for (const [ts, incoming] of freshestIncoming) {
		const existingSeq = state.seqByTs.get(ts)
		if (existingSeq === undefined || seqOf(incoming) >= existingSeq) {
			changed = true
			break
		}
	}
	if (!changed) {
		return state
	}

	// Phase 3 — single array/Map rebuild: replace updated ts in place,
	// append genuinely new ts (in incoming order) at the end.
	// Per-ts freshness guard: only replace when the incoming copy is at
	// equal-or-newer seq than what the replica already holds, so a mixed
	// snapshot (e.g. a truncated window that lacks the newest copy of a
	// usage-bearing api_req_started row) can never regress the transcript.
	const seqByTs = new Map(state.seqByTs)
	const messages: ClineMessage[] = []
	for (const message of state.messages) {
		const replacement = freshestIncoming.get(message.ts)
		if (replacement !== undefined) {
			// Consume the incoming copy either way so the trailing loop can't
			// re-append a rejected (stale) copy and duplicate the ts.
			freshestIncoming.delete(message.ts)
			const existingSeq = seqByTs.get(message.ts)
			if (existingSeq === undefined || seqOf(replacement) >= existingSeq) {
				messages.push(replacement)
				seqByTs.set(replacement.ts, seqOf(replacement))
			} else {
				messages.push(message)
			}
		} else {
			messages.push(message)
		}
	}
	for (const message of incomingMessages) {
		if (freshestIncoming.has(message.ts)) {
			messages.push(message)
			seqByTs.set(message.ts, seqOf(message))
		}
	}

	return { ...state, messages, seqByTs }
}

export function applyStateSnapshot(
	state: ReplicaState,
	snapshotMessages: ClineMessage[],
	snapshotEpoch = 0,
	snapshotVersion = 0,
	snapshotTurnState?: TurnState,
	snapshotMessageTruncated?: boolean,
	snapshotTotalCount?: number,
): ReplicaState {
	if (snapshotEpoch < state.epoch) {
		return state
	}

	if (snapshotEpoch > state.epoch) {
		// New task/render: replace transcript AND adopt the snapshot's turnState +
		// pagination metadata wholesale (a truncated flag from the previous task must
		// never leak into the new conversation).
		return resetTo(
			snapshotEpoch,
			snapshotMessages,
			snapshotVersion,
			snapshotTurnState,
			snapshotMessageTruncated,
			snapshotTotalCount,
		)
	}

	// Same epoch.
	if (snapshotVersion !== 0 && snapshotVersion <= state.stateVersion) {
		// A newer (or equal) snapshot already applied for the transcript — but a turnState with a
		// higher seq may still need to move the UI forward, so don't bail before the seq gate.
		return applyTurnState(state, snapshotTurnState)
	}

	// Merge each message; never shrink the transcript for the same task/epoch.
	let next = state
	next = mergeMessagesBatch(next, snapshotMessages)
	if (snapshotVersion > next.stateVersion) {
		next = next === state ? { ...state } : next
		next.stateVersion = snapshotVersion
	}
	// The extension stamps pagination metadata on every snapshot; adopt the freshest
	// values so a short-task snapshot can clear a stale truncated flag, and vice-versa.
	// Messages only ever grow within an epoch, so "undefined" here means "not truncated".
	next = {
		...next,
		messageTruncated: snapshotMessageTruncated,
		totalMessageCount: snapshotTotalCount ?? next.totalMessageCount,
	}
	// Gate turnState by seq so a stale snapshot cannot revert a newer phase.
	next = applyTurnState(next, snapshotTurnState)
	return next
}
