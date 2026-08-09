// Tracks each submitted prompt's exact inputs (raw text + attachments) across
// the turn lifecycle so a failed turn can be retried verbatim.
//
// Identity model: queued submissions are keyed by the *server* prompt id the
// enqueue RPC returns (`queuedPromptId`). The runtime's queue holds at most
// one entry per prompt text (same-text enqueues merge), so an id uniquely
// names a submission — no transcript-text matching is ever needed. The only
// wrinkle is timing: the queue drains on a microtask server-side, so the
// `chat_queued_prompt_start` event for a submission can reach the client
// before its own enqueue RPC resolves with the id. `startTurn` stashes such
// an unresolved start and `resolveQueuedPromptId` completes the pairing when
// the RPC comes back.

export type SentTurnPayload = {
	prompt: string;
	attachedFiles: File[];
};

// Queued submissions are bounded by how many prompts can realistically pile
// up behind a running turn.
const MAX_QUEUED_PAYLOADS = 20;

type QueuedPayloadEntry = {
	// null until the enqueue RPC resolves with the server-assigned id.
	promptId: string | null;
	payload: SentTurnPayload;
};

type UnresolvedStart = {
	promptId: string;
	// Turn epoch at the time the start event arrived; a later epoch means
	// another turn began and a late-resolving id must not become "active".
	epoch: number;
	// The turn ended with an error before its enqueue RPC resolved; when the
	// id finally arrives, the payload goes straight to `failed`.
	failed: boolean;
};

export class TurnPayloadTracker {
	private queued: QueuedPayloadEntry[] = [];
	private active: SentTurnPayload | null = null;
	private failed: SentTurnPayload | null = null;
	private unresolvedStart: UnresolvedStart | null = null;

	get failedPayload(): SentTurnPayload | null {
		return this.failed;
	}

	/** A prompt dispatched directly (session idle) is this turn's payload. */
	beginDirectTurn(payload: SentTurnPayload): void {
		this.active = payload;
		this.failed = null;
	}

	/** A prompt submitted while the session is busy waits for its server id. */
	enqueue(payload: SentTurnPayload): void {
		this.queued.push({ promptId: null, payload });
		if (this.queued.length > MAX_QUEUED_PAYLOADS) {
			this.queued.splice(0, this.queued.length - MAX_QUEUED_PAYLOADS);
		}
	}

	/**
	 * The enqueue RPC resolved: bind the submission to its server prompt id.
	 * Completes a start (or failure) that raced ahead of the RPC response.
	 */
	resolveQueuedPromptId(
		payload: SentTurnPayload,
		promptId: string,
		currentEpoch: number,
	): void {
		const entry = this.queued.find((item) => item.payload === payload);
		if (!entry) {
			// The submission already failed at dispatch (markFailed dropped it)
			// or was evicted; nothing left to bind.
			return;
		}
		const priorIndex = this.queued.findIndex(
			(item) => item !== entry && item.promptId === promptId,
		);
		if (priorIndex >= 0) {
			// The server merged this same-text submission into an existing queue
			// entry (the runtime queue is unique per prompt text). The newest
			// submission's inputs win, but attachments are inherited when the
			// new submission carried none — mirroring the runtime's merge.
			const prior = this.queued[priorIndex];
			if (
				prior &&
				entry.payload.attachedFiles.length === 0 &&
				prior.payload.attachedFiles.length > 0
			) {
				entry.payload = {
					...entry.payload,
					attachedFiles: prior.payload.attachedFiles,
				};
			}
			this.queued.splice(priorIndex, 1);
		}
		entry.promptId = promptId;
		if (this.unresolvedStart?.promptId !== promptId) {
			return;
		}
		// This submission's turn already started (and possibly ended) while the
		// RPC was in flight.
		const started = this.unresolvedStart;
		this.unresolvedStart = null;
		this.queued.splice(this.queued.indexOf(entry), 1);
		if (started.failed) {
			this.failed = entry.payload;
		} else if (started.epoch === currentEpoch) {
			this.active = entry.payload;
		}
	}

	/**
	 * A queued prompt left the queue and its turn is starting. `eventPrompt`
	 * is the runtime prompt carried by the event, used only to recognize a
	 * direct dispatch the runtime re-routed through its queue (which keeps
	 * its already-active payload).
	 */
	startTurn(
		promptId: string | undefined,
		eventPrompt: string,
		epoch: number,
	): void {
		// A new turn supersedes any previous failure and any stale stash.
		this.failed = null;
		this.unresolvedStart = null;
		if (promptId) {
			const index = this.queued.findIndex((item) => item.promptId === promptId);
			if (index >= 0) {
				this.active = this.queued[index]?.payload ?? null;
				this.queued.splice(index, 1);
				return;
			}
		}
		if (this.active && this.active.prompt === eventPrompt) {
			// A direct dispatch the runtime re-routed through its queue: the
			// event describes the payload that is already active.
			return;
		}
		this.active = null;
		if (promptId) {
			// Possibly one of ours whose enqueue RPC has not resolved yet;
			// resolveQueuedPromptId completes the pairing if so.
			this.unresolvedStart = { promptId, epoch, failed: false };
		}
	}

	/** The running turn ended with an error (chat_done reason "error"). */
	failActiveTurn(currentEpoch: number): void {
		if (this.active) {
			this.failed = this.active;
			return;
		}
		if (this.unresolvedStart && this.unresolvedStart.epoch === currentEpoch) {
			this.unresolvedStart.failed = true;
		}
	}

	/** A submission failed at dispatch (RPC error, session start failure...). */
	markFailed(payload: SentTurnPayload): void {
		this.failed = payload;
		this.queued = this.queued.filter((item) => item.payload !== payload);
	}

	/** The enqueue RPC resolved without a server id; the payload can never be
	 * paired with its turn, so drop it instead of letting it linger. */
	discardQueued(payload: SentTurnPayload): void {
		this.queued = this.queued.filter((item) => item.payload !== payload);
	}

	/** A queued prompt's text was edited in place; retry must use the new text
	 * while keeping the submission's original attachments. */
	updateQueuedPrompt(promptId: string, prompt: string): void {
		const entry = this.queued.find((item) => item.promptId === promptId);
		if (entry) {
			entry.payload = { ...entry.payload, prompt };
		}
	}

	/** A queued prompt was removed before running; its payload goes with it. */
	removeQueuedPrompt(promptId: string): void {
		this.queued = this.queued.filter((item) => item.promptId !== promptId);
	}

	reset(): void {
		this.queued = [];
		this.active = null;
		this.failed = null;
		this.unresolvedStart = null;
	}
}
