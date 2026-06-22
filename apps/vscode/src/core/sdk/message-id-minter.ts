// Single source of truth for ClineMessage identity (`ts`), update freshness (`seq`),
// and the conversation/replica fence (`epoch`).
//
// Rationale:
// - `ClineMessage.ts` is used as a message IDENTITY / merge key by the webview, not as a wall
//   clock. Minting it from a single monotonic counter makes collisions impossible across the
//   live translator, tool-approval interactions, and history rendering.
// - `seq` is a separate per-update freshness counter so the webview can resolve "two copies of
//   the same ts — which is newer" independent of delivery order.
// - `epoch` fences off traffic from a previous task / a previous render of the same task.
//
// All three are pure in-memory counters. Nothing here reads the clock per message. One instance
// per Controller, shared by every generator that emits ClineMessages or state snapshots.

export class MessageIdMinter {
	private tsCounter: number
	private seqCounter = 0
	private epochCounter = 0

	/**
	 * @param seed Starting value for the ts counter. Seeded from Date.now() by default so ids
	 * stay above any persisted legacy ids while remaining monotonic for the process lifetime.
	 */
	constructor(seed: number = Date.now()) {
		this.tsCounter = seed
	}

	/** Mint a NEW unique message ts (identity). Called once per new logical message. */
	nextTs(): number {
		return ++this.tsCounter
	}

	/**
	 * Advance and return the freshness counter. Call synchronously at the moment a message is
	 * created/updated AND when a state snapshot is assembled — before any await — so the total
	 * order matches causal order regardless of delivery timing.
	 */
	nextSeq(): number {
		return ++this.seqCounter
	}

	/** The current freshness counter without advancing it. */
	get seq(): number {
		return this.seqCounter
	}

	/**
	 * Bump the conversation/replica fence. Called once per boundary (task start/clear, cancel,
	 * reinit/resume) synchronously, BEFORE the new state is pushed. NOT on iteration_start.
	 */
	bumpEpoch(): number {
		return ++this.epochCounter
	}

	/** The current epoch (fence) value. */
	currentEpoch(): number {
		return this.epochCounter
	}
}
