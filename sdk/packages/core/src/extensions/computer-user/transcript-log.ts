import type { ComputerTaskArtifactEvent } from "../computer-observability/artifact-events";

/**
 * In-process tail of the computer user's transcript.
 *
 * The recording hooks already reduce every committed helper message to a
 * journal payload (see transcript-observer.ts); this log is a second sink for
 * exactly those events, so the driver's `computer_user_transcript` tool sees
 * byte-identical content to the observatory without dialing the backend —
 * crucially including while the backend is down. Entries keep the session id
 * they belong to, so history survives a helper restart without being
 * mistaken for the new session's activity. The buffer is bounded: peeking can
 * never grow the driver process unboundedly.
 */

export interface ComputerUserTranscriptEntry {
	/** Monotonic sequence, unique per log instance. Cursor for `sinceSeq`. */
	seq: number;
	/** Epoch milliseconds when the message was committed. */
	at: number;
	/** The session the message belongs to; undefined until the first run. */
	sessionId?: string;
	role: string;
	text?: string;
	toolName?: string;
	/** Truncated tool input, as reduced by the recording hooks. */
	input?: string;
	ok?: boolean;
	toolCallId?: string;
}

const DEFAULT_CAPACITY = 200;

function entryFromEvent(
	event: ComputerTaskArtifactEvent,
): ComputerUserTranscriptEntry | undefined {
	if (event.type !== "transcript.message_committed") {
		return undefined;
	}
	const payload = event.payload as Record<string, unknown>;
	const correlation = event.correlation as { toolCallId?: string } | undefined;
	const sessionId =
		typeof event.source === "object" &&
		event.source !== null &&
		"sessionId" in event.source
			? (event.source as { sessionId?: unknown }).sessionId
			: undefined;
	return {
		seq: -1, // assigned by append
		at: Date.parse(event.occurredAt),
		sessionId: typeof sessionId === "string" ? sessionId : undefined,
		role: String(payload.role ?? ""),
		...(typeof payload.text === "string" ? { text: payload.text } : {}),
		...(typeof payload.toolName === "string"
			? { toolName: payload.toolName }
			: {}),
		...(typeof payload.input === "string" ? { input: payload.input } : {}),
		...(typeof payload.ok === "boolean" ? { ok: payload.ok } : {}),
		...(correlation?.toolCallId ? { toolCallId: correlation.toolCallId } : {}),
	};
}

export class ComputerUserTranscriptLog {
	private readonly entries: ComputerUserTranscriptEntry[] = [];
	private nextSeq = 1;

	constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

	/** Tee target for the recording hooks: keeps the last `capacity` events. */
	append(event: ComputerTaskArtifactEvent): void {
		const entry = entryFromEvent(event);
		if (!entry) {
			return;
		}
		entry.seq = this.nextSeq++;
		this.entries.push(entry);
		if (this.entries.length > this.capacity) {
			this.entries.splice(0, this.entries.length - this.capacity);
		}
	}

	/**
	 * Returns up to `limit` entries in commit order. `sinceSeq` skips entries
	 * up to and including that sequence, so a driver can page through new
	 * activity without re-reading what it has already seen.
	 */
	tail(options?: { limit?: number; sinceSeq?: number }): {
		entries: ComputerUserTranscriptEntry[];
		latestSeq: number;
	} {
		const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
		const sinceSeq = options?.sinceSeq ?? 0;
		const selected = this.entries
			.filter((entry) => entry.seq > sinceSeq)
			.slice(-limit);
		return {
			entries: selected,
			latestSeq: this.nextSeq - 1,
		};
	}
}
