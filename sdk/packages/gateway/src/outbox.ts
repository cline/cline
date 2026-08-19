/**
 * Outbox-driven disk projections (Gateway RFC, Phase 3; ADR 0001).
 *
 * The SQLite database is authoritative; files on disk are projections.
 * State changes enqueue an outbox entry in the same transaction, and
 * this worker drains the outbox asynchronously — so a crash between the
 * commit and the file write loses nothing: the pending entry is retried
 * on the next drain (including after restart). Projectors are idempotent
 * full rewrites, which makes retries and coalescing safe.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionId } from "@cline/shared/gateway";
import type { GatewayPaths } from "./paths";
import type { GatewayStores, OutboxEntry } from "./stores";

export const OUTBOX_KIND_SESSION_PROJECTION = "session.projection";

export type OutboxProjector = (entry: OutboxEntry) => void | Promise<void>;

/**
 * Default projector: rewrite `projections/sessions/<sessionId>.json`
 * from the authoritative database (session record, runs, attempts, and
 * canonical message history).
 */
export function createFileProjector(
	paths: GatewayPaths,
	stores: GatewayStores,
): OutboxProjector {
	return (entry) => {
		if (entry.kind !== OUTBOX_KIND_SESSION_PROJECTION) {
			throw new Error(`Unknown outbox kind: ${entry.kind}`);
		}
		const sessionId = String(entry.payload.sessionId) as SessionId;
		const session = stores.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Cannot project unknown session ${sessionId}`);
		}
		const runs = stores.runs.listBySession(sessionId);
		const projection = {
			projectedAt: Date.now(),
			session,
			runs: runs.map((run) => ({
				...run,
				attempts: stores.attempts.listByRun(run.runId),
			})),
			messages: stores.messages.listBySession(sessionId),
		};
		const file = paths.sessionProjectionFile(sessionId);
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		const tempFile = `${file}.${process.pid}.tmp`;
		writeFileSync(tempFile, `${JSON.stringify(projection, null, "\t")}\n`, {
			mode: 0o600,
		});
		renameSync(tempFile, file);
	};
}

export interface OutboxWorkerOptions {
	/** Delay before retrying entries that failed to project. */
	retryDelayMs?: number;
	batchSize?: number;
	onError?: (entry: OutboxEntry, error: unknown) => void;
}

export class OutboxWorker {
	private readonly stores: GatewayStores;
	private readonly projector: OutboxProjector;
	private readonly retryDelayMs: number;
	private readonly batchSize: number;
	private readonly onError: (entry: OutboxEntry, error: unknown) => void;

	private running = false;
	private scheduled = false;
	private stopped = false;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private inFlight: Promise<void> = Promise.resolve();

	constructor(
		stores: GatewayStores,
		projector: OutboxProjector,
		options: OutboxWorkerOptions = {},
	) {
		this.stores = stores;
		this.projector = projector;
		this.retryDelayMs = options.retryDelayMs ?? 250;
		this.batchSize = options.batchSize ?? 32;
		this.onError = options.onError ?? (() => {});
	}

	/** Request an asynchronous drain (idempotent while one is queued). */
	schedule(): void {
		if (this.stopped || this.scheduled) {
			return;
		}
		this.scheduled = true;
		queueMicrotask(() => {
			this.scheduled = false;
			this.inFlight = this.inFlight.then(() => this.drainOnce());
		});
	}

	/** Drain until the outbox is empty or every pending entry has failed. */
	async drain(): Promise<void> {
		await this.inFlight;
		await this.drainOnce();
	}

	stop(): void {
		this.stopped = true;
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = undefined;
		}
	}

	private async drainOnce(): Promise<void> {
		if (this.running || this.stopped) {
			return;
		}
		this.running = true;
		try {
			for (;;) {
				const pending = this.stores.outbox.listPending(this.batchSize);
				if (pending.length === 0) {
					return;
				}
				let progressed = false;
				for (const entry of pending) {
					try {
						await this.projector(entry);
						this.stores.outbox.markDone(entry.outboxId, Date.now());
						progressed = true;
					} catch (error) {
						this.stores.outbox.markFailed(
							entry.outboxId,
							error instanceof Error ? error.message : String(error),
						);
						this.onError(entry, error);
					}
				}
				if (!progressed) {
					// Everything pending failed this round; retry later instead
					// of spinning. The database stays authoritative meanwhile.
					this.scheduleRetry();
					return;
				}
			}
		} finally {
			this.running = false;
		}
	}

	private scheduleRetry(): void {
		if (this.stopped || this.retryTimer) {
			return;
		}
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			this.schedule();
		}, this.retryDelayMs);
		this.retryTimer.unref?.();
	}
}
