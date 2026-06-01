// Single source of truth for ClineMessage identity (`id`), update freshness (`seq`),
// and the conversation/replica fence (`epoch`).
//
// See apps/vscode/src/sdk/docs/webview-message-state-design.md §4.
//
// Rationale (why this exists):
// - `ClineMessage.ts` is used as a message IDENTITY / merge key, not as a wall clock. It
//   was historically minted from Date.now() in TWO independent places (the live translator
//   and the interaction coordinator), which can COLLIDE: the translator's pure-increment
//   counter drifts behind wall-clock and can later catch up to a clock-based value minted by
//   the interaction coordinator. A single monotonic minter makes collisions impossible.
// - `seq` is a separate per-update freshness counter so the webview can resolve "two copies
//   of the same id — which is newer" independent of delivery order.
// - `epoch` fences off traffic from a previous task / a previous render of the same task.
//
// All three are pure in-memory counters. Nothing here reads the clock per message.

/**
 * Process-wide authority for `id`, `seq`, and `epoch`.
 *
 * One instance per extension process, owned by SdkController and shared by:
 * - live SDK event translation (MessageTranslatorState),
 * - the interaction coordinator (tool approval / ask_question / user_feedback),
 * - history rendering (sdkMessagesToClineMessages).
 *
 * This guarantees every `id` is globally unique and monotonically increasing within the
 * process, so regenerated history ids never overlap live ids.
 */
export class MessageIdMinter {
	private idCounter: number
	private seqCounter = 0
	private epochCounter = 0

	/**
	 * @param seed Starting value for the id counter. Defaults to 0. A seed is only useful to
	 * keep ids increasing across constructions in tests; production uses a single long-lived
	 * instance, so the default is fine. Never derived from the clock per message.
	 */
	constructor(seed = 0) {
		this.idCounter = seed
	}

	/** Mint a NEW unique message id (identity). Called once per new logical message. */
	nextId(): number {
		return ++this.idCounter
	}

	/**
	 * Advance and return the freshness counter. Call synchronously at the moment a message is
	 * created/updated AND at the moment a state snapshot is assembled — before any await — so
	 * the resulting total order matches causal order regardless of delivery timing.
	 */
	nextSeq(): number {
		return ++this.seqCounter
	}

	/** The current freshness counter without advancing it. */
	get seq(): number {
		return this.seqCounter
	}

	/**
	 * Bump the conversation/replica fence. Called once per boundary (task start/clear, history
	 * open, reinit/resume, mode rebuild that swaps the session, new-session follow-up, cancel)
	 * — synchronously, BEFORE the new state is pushed. NOT on iteration_start / streaming.
	 */
	bumpEpoch(): number {
		return ++this.epochCounter
	}

	/** The current epoch (fence) value. */
	get epoch(): number {
		return this.epochCounter
	}
}
