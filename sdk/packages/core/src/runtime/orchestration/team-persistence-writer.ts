import type { TeamRuntimeState, TeamTeammateSpec } from "@cline/shared";
import type {
	TeamEvent,
	TeamRuntimeStateDelta,
} from "../../extensions/tools/team";
import {
	isDurableTeamEvent,
	shouldFlushTeamEventImmediately,
	toPersistableTeamEvent,
} from "../../extensions/tools/team/persistence-policy";
import type { TeamPersistenceBatch } from "../../types/storage";

/** Default batch window for coalescing durable team writes. */
export const TEAM_PERSIST_BATCH_MS = 300;
/**
 * Telemetry (heartbeats/progress) updates run liveness fields in memory. Those
 * are flushed at most this often so recovery sees a reasonably fresh
 * `heartbeatAt` without writing on every 2s heartbeat or streamed chunk.
 */
export const TEAM_TELEMETRY_FLUSH_MS = 60_000;
/**
 * Cap on events held for retry after failed writes, so a store that stays
 * broken cannot grow memory without bound. Oldest events are dropped first.
 */
export const TEAM_PERSIST_MAX_PENDING_EVENTS = 5_000;

export interface TeamPersistenceSource {
	hasPendingStateDelta(): boolean;
	drainStateDelta(): TeamRuntimeStateDelta;
	requeueStateDelta(delta: TeamRuntimeStateDelta): void;
	exportState(): TeamRuntimeState;
}

export interface TeamPersistenceSink {
	persistBatch(teamName: string, batch: TeamPersistenceBatch): unknown;
}

export interface TeamPersistenceWriterOptions {
	teamKey: string;
	store: TeamPersistenceSink;
	source: () => TeamPersistenceSource | undefined;
	teammates: () => TeamTeammateSpec[];
	batchMs?: number;
	telemetryFlushMs?: number;
	onError?: (error: unknown) => void;
	now?: () => number;
}

/**
 * Coalesces durable team writes off the event hot path.
 *
 * - Telemetry events (`agent_event`, `run_progress`) never trigger a write.
 * - Durable events are queued and flushed together after `batchMs`.
 * - Terminal run states and membership changes flush immediately.
 * - `flush()` is synchronous so shutdown paths can force a final write.
 * - A failed write keeps its batch and retries on the next flush.
 */
export class TeamPersistenceWriter {
	private readonly opts: Required<
		Omit<TeamPersistenceWriterOptions, "onError">
	> &
		Pick<TeamPersistenceWriterOptions, "onError">;
	private pendingEvents: Array<{ type: string; payload: unknown }> = [];
	private teammatesDirty = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private lastFlushAt = 0;
	private disposed = false;

	constructor(options: TeamPersistenceWriterOptions) {
		this.opts = {
			batchMs: TEAM_PERSIST_BATCH_MS,
			telemetryFlushMs: TEAM_TELEMETRY_FLUSH_MS,
			now: Date.now,
			...options,
		};
	}

	/** Called for every team event. Cheap for telemetry. */
	onEvent(event: TeamEvent): void {
		if (this.disposed) return;
		if (!isDurableTeamEvent(event)) {
			// Liveness-only change; persist lazily.
			if (this.opts.now() - this.lastFlushAt >= this.opts.telemetryFlushMs) {
				this.schedule();
			}
			return;
		}
		this.pendingEvents.push({
			type: event.type,
			payload: toPersistableTeamEvent(event),
		});
		if (shouldFlushTeamEventImmediately(event)) {
			this.flush();
			return;
		}
		this.schedule();
	}

	/** Teammate specs changed (spawn/shutdown); include them in next flush. */
	markTeammatesDirty(): void {
		this.teammatesDirty = true;
	}

	/** State changed without a team event (read receipts, cleanup). */
	markStateDirty(): void {
		if (this.disposed) return;
		this.schedule();
	}

	/** Write everything pending now. Safe to call repeatedly. */
	flush(): void {
		this.clearTimer();
		const source = this.opts.source();
		if (!source) return;
		const hasDelta = source.hasPendingStateDelta();
		if (!hasDelta && this.pendingEvents.length === 0 && !this.teammatesDirty) {
			return;
		}
		const events = this.pendingEvents;
		const teammatesDirty = this.teammatesDirty;
		this.pendingEvents = [];
		this.teammatesDirty = false;
		const delta = source.drainStateDelta();
		try {
			this.opts.store.persistBatch(this.opts.teamKey, {
				events,
				delta,
				teammates: this.opts.teammates(),
				getFullState: () => source.exportState(),
			});
			this.lastFlushAt = this.opts.now();
		} catch (error) {
			// Persistence must never break the agent: report, keep the batch so the
			// next flush retries it (e.g. after a transient SQLite lock).
			source.requeueStateDelta(delta);
			const merged = events.concat(this.pendingEvents);
			this.pendingEvents =
				merged.length > TEAM_PERSIST_MAX_PENDING_EVENTS
					? merged.slice(-TEAM_PERSIST_MAX_PENDING_EVENTS)
					: merged;
			this.teammatesDirty = this.teammatesDirty || teammatesDirty;
			if (!this.disposed) {
				this.schedule();
			}
			try {
				this.opts.onError?.(error);
			} catch {
				// Error reporting must not prevent the batch from being retried.
			}
		}
	}

	/** Final flush and stop accepting events. */
	dispose(): void {
		if (this.disposed) return;
		// Mark first so a failed final write does not schedule further retries.
		this.disposed = true;
		this.flush();
	}

	private schedule(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, this.opts.batchMs);
		// Do not keep the process alive just for a pending write.
		(this.timer as { unref?: () => void }).unref?.();
	}

	private clearTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}
