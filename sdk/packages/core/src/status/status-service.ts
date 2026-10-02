import {
	parseStatusQuery,
	type StatusPage,
	type StatusPublishInput,
	type StatusUpdate,
} from "@cline/shared";
import { SqliteStatusStore } from "./store/sqlite-status-store";

/** Durable current work and history owned by one Hub transport. */
export class StatusService {
	private readonly store: SqliteStatusStore;
	private readonly listeners = new Set<(update: StatusUpdate) => void>();

	constructor(dbPath?: string) {
		this.store = new SqliteStatusStore(dbPath);
	}

	publish(input: StatusPublishInput): StatusUpdate {
		const update = this.store.publish(input);
		for (const listener of this.listeners) {
			try {
				listener(update);
			} catch {
				// A subscriber must not fail an already durable report.
			}
		}
		return update;
	}

	query(input: unknown = {}): StatusPage {
		return this.store.query(parseStatusQuery(input));
	}

	board(input: unknown = {}): StatusPage {
		const query = parseStatusQuery(input);
		return this.store.query({
			...query,
			currentOnly: true,
			orderBy: "attention",
			includeHistoryCount: true,
		});
	}

	summary() {
		return this.store.summary();
	}

	/** Close unfinished reports without claiming that their work succeeded. */
	closeSession(sessionId: string, reason: string): void {
		for (const row of this.store.openRows()) {
			if (row.sessionId !== sessionId) continue;
			this.publish({
				subject: row.subject,
				state: "cancelled",
				headline: "Reporting session ended",
				detail: `Session ended (${reason}). Last report: ${row.headline}`,
				priority: "low",
				sessionId: row.sessionId,
				agentId: row.agentId,
				agentName: row.agentName,
				workspaceRoot: row.workspaceRoot,
				tags: row.tags,
				source: "session-lifecycle",
			});
		}
	}

	/** Called before a newly constructed local runtime starts any sessions. */
	closeOrphanedReports(): void {
		const sessions = new Set(
			this.store
				.openRows()
				.flatMap((row) => (row.sessionId ? [row.sessionId] : [])),
		);
		for (const sessionId of sessions)
			this.closeSession(sessionId, "hub restarted");
	}

	subscribe(listener: (update: StatusUpdate) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close(): void {
		this.listeners.clear();
		this.store.close();
	}
}
