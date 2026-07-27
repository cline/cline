import {
	parseStatusQuery,
	type StatusPage,
	type StatusPrunePayload,
	type StatusPublishInput,
	type StatusQuery,
	type StatusSummary,
	type StatusUpdate,
	shouldPushToUser,
} from "@cline/shared";
import { SqliteStatusStore } from "../store/sqlite-status-store";

/**
 * Status Hub service (ARD-0005).
 *
 * Owns the store plus in-process fan-out. The hub wraps this to broadcast
 * `status.updated` to connected clients; in-process SDK consumers can
 * subscribe directly without a hub.
 */

export type StatusListener = (update: StatusUpdate) => void;

export interface StatusServiceOptions {
	/** Defaults to `resolveStatusDbPath()`. */
	dbPath?: string;
	/** Pre-built store, mainly for tests. Takes precedence over dbPath. */
	store?: SqliteStatusStore;
}

export class StatusService {
	private readonly store: SqliteStatusStore;
	private readonly listeners = new Set<StatusListener>();

	constructor(options: StatusServiceOptions = {}) {
		this.store =
			options.store ?? new SqliteStatusStore(options.dbPath ?? undefined);
	}

	/** True when text search is FTS5-backed rather than LIKE-backed. */
	get ftsAvailable(): boolean {
		return this.store.ftsAvailable;
	}

	/**
	 * Publish an update. Returns the stored row including its assigned `seq`.
	 * Listener failures are isolated: one bad subscriber must not prevent the
	 * others from seeing the update, and must not fail the publish.
	 */
	publish(input: StatusPublishInput): StatusUpdate {
		const update = this.store.publish(input);
		for (const listener of this.listeners) {
			try {
				listener(update);
			} catch {
				// A subscriber throwing is its own problem, not the publisher's.
			}
		}
		return update;
	}

	/** Whether this update should also interrupt the human. */
	isPushWorthy(update: StatusUpdate): boolean {
		return shouldPushToUser(update.priority);
	}

	current(subject: string): StatusUpdate | undefined {
		return this.store.current(subject);
	}

	/** Paginated read. Accepts the raw query shape; defaults are applied here. */
	query(query: StatusQuery = {}): StatusPage {
		return this.store.query(parseStatusQuery(query));
	}

	/**
	 * The board: current status of every subject, ordered by what needs
	 * attention rather than by recency, with per-subject history counts.
	 */
	board(query: Omit<StatusQuery, "currentOnly"> = {}): StatusPage {
		return this.store.query(
			parseStatusQuery({
				orderBy: "attention",
				includeHistoryCount: true,
				...query,
				currentOnly: true,
			}),
		);
	}

	/** Counts across every live row, independent of any page. */
	summary(): StatusSummary {
		return this.store.summary();
	}

	/** Full changelog for one subject, newest first. */
	history(
		subject: string,
		query: Omit<StatusQuery, "subject"> = {},
	): StatusPage {
		return this.store.query(parseStatusQuery({ ...query, subject }));
	}

	latestSeq(): number {
		return this.store.latestSeq();
	}

	subjects(limit?: number): string[] {
		return this.store.subjects(limit);
	}

	prune(payload: StatusPrunePayload): number {
		return this.store.prune(payload);
	}

	subscribe(listener: StatusListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	close(): void {
		this.listeners.clear();
		this.store.close();
	}
}

let sharedStatusService: StatusService | undefined;

/** Process-wide Status Hub service over the default `status.db`. */
export function getStatusService(): StatusService {
	if (!sharedStatusService) {
		sharedStatusService = new StatusService();
	}
	return sharedStatusService;
}

/** Test seam: replace or clear the process-wide service. */
export function setStatusService(service: StatusService | undefined): void {
	sharedStatusService = service;
}
