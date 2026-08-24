/**
 * Durable, cursor-addressed Hub event log.
 *
 * Every event the Hub publishes is appended here with a monotonically
 * increasing global sequence before it is fanned out to live sockets. A
 * client that reconnects can resume exactly where it left off by passing
 * `sinceSequence` on `stream.subscribe`: the adapter replays pages from this
 * log, then live-tails. Nothing about delivery depends on who was watching
 * when the event happened — disconnect never implies data loss.
 *
 * The log is a projection aid, not the source of truth for conversation
 * history (session messages remain canonical on disk); it is bounded by a
 * retention sweep so it can run forever.
 */

import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROWS = 200_000;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Appended bytes between sweeps; the hourly timer alone can't keep up with bursts. */
const PRUNE_EVERY_APPENDED_BYTES = 16 * 1024 * 1024;

export interface HubEventLogOptions {
	/** Database file. Defaults to an owner-scoped `<data>/db/hub-events-*.db`; use ":memory:" in tests. */
	dbPath?: string;
	/** Scopes the default `dbPath`; ignored when `dbPath` is given. */
	ownerId?: string;
	/** Events older than this are pruned. Defaults to 7 days. */
	retentionMs?: number;
	/** Hard cap on rows kept, oldest pruned first. Defaults to 200k. */
	maxRows?: number;
	/** Cap on the database file size, oldest rows pruned first. Defaults to 64 MiB. */
	maxTotalBytes?: number;
}

export interface HubEventLogScope {
	sessionId?: string;
}

/**
 * Default log location, scoped per hub owner context so coexisting hubs
 * (production and a dev shared hub) never interleave one log's sequences.
 */
export function resolveHubEventLogPath(ownerId?: string): string {
	const scope = ownerId?.replace(/[^a-zA-Z0-9_-]/g, "-");
	return join(
		resolveDbDataDir(),
		scope ? `hub-events-${scope}.db` : "hub-events.db",
	);
}

export class HubEventLogStore {
	private readonly db: SqliteDb;
	private readonly retentionMs: number;
	private readonly maxRows: number;
	private readonly maxTotalBytes: number;
	private appendedBytesSincePrune = 0;
	private closed = false;

	constructor(options: HubEventLogOptions = {}) {
		this.db = loadSqliteDb(
			options.dbPath ?? resolveHubEventLogPath(options.ownerId),
		);
		this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
		this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
		this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
		// Every streaming chunk lands here as an INSERT; WAL keeps those
		// appends from serializing against replay reads, and the busy timeout
		// matches the other SQLite stores instead of failing fast on contention.
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS hub_events (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT,
				event TEXT NOT NULL,
				session_id TEXT,
				envelope_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_hub_events_session
				ON hub_events(session_id, sequence);
			CREATE INDEX IF NOT EXISTS idx_hub_events_created
				ON hub_events(created_at);
		`);
	}

	/**
	 * Append a durable event and return it stamped with its global sequence.
	 * The returned envelope (not the input) is what must be fanned out so
	 * live listeners and replaying clients observe identical frames.
	 */
	append(envelope: HubEventEnvelope): HubEventEnvelope {
		if (this.closed) {
			return envelope;
		}
		const createdAt = envelope.timestamp ?? Date.now();
		// Stored without `sequence`; stamped from the rowid on read/return.
		const envelopeJson = JSON.stringify(envelope);
		const inserted = this.db
			.prepare(
				`INSERT INTO hub_events (event, session_id, envelope_json, created_at)
				 VALUES (?, ?, ?, ?);`,
			)
			.run(envelope.event, envelope.sessionId ?? null, envelopeJson, createdAt);
		// The AUTOINCREMENT primary key IS the sequence, so the insert's own
		// rowid stamps it without a second round-trip per streaming chunk.
		const rowid = inserted?.lastInsertRowid;
		const sequence =
			typeof rowid === "number" || typeof rowid === "bigint"
				? Number(rowid)
				: this.lastSequence();
		this.appendedBytesSincePrune += Buffer.byteLength(envelopeJson);
		if (this.appendedBytesSincePrune >= PRUNE_EVERY_APPENDED_BYTES) {
			this.appendedBytesSincePrune = 0;
			this.prune();
		}
		return { ...envelope, sequence };
	}

	/** Events after `sequence`, oldest first, optionally scoped to a session. */
	listAfter(
		sequence: number,
		scope: HubEventLogScope,
		limit: number,
	): HubEventEnvelope[] {
		if (this.closed) {
			return [];
		}
		const clauses = ["sequence > ?"];
		const params: unknown[] = [sequence];
		if (scope.sessionId) {
			clauses.push("session_id = ?");
			params.push(scope.sessionId);
		}
		params.push(limit);
		return this.db
			.prepare(
				`SELECT sequence, envelope_json FROM hub_events
				 WHERE ${clauses.join(" AND ")} ORDER BY sequence LIMIT ?;`,
			)
			.all(...params)
			.flatMap((row) => {
				try {
					const envelope = JSON.parse(
						String(row.envelope_json),
					) as HubEventEnvelope;
					return [{ ...envelope, sequence: Number(row.sequence) }];
				} catch {
					return [];
				}
			});
	}

	lastSequence(): number {
		if (this.closed) {
			return 0;
		}
		const row = this.db
			.prepare("SELECT MAX(sequence) AS sequence FROM hub_events;")
			.get();
		return Number(row?.sequence ?? 0);
	}

	/** Bound the log: drop rows past retention, the row cap, and the size budget. */
	prune(now = Date.now()): void {
		if (this.closed) {
			return;
		}
		this.db
			.prepare("DELETE FROM hub_events WHERE created_at < ?;")
			.run(now - this.retentionMs);
		this.db
			.prepare(
				`DELETE FROM hub_events WHERE sequence <= (
					SELECT sequence FROM hub_events ORDER BY sequence DESC
					LIMIT 1 OFFSET ?
				);`,
			)
			.run(this.maxRows);
		// Age/row caps alone don't bound disk: envelopes carrying full session
		// snapshots reach hundreds of KB each, so retained rows could still
		// total tens of GB (#13505). Over budget, keep only the newest rows
		// that fit in half the budget (the newest row — a NULL running sum —
		// is never deleted, so cursors never rewind), then VACUUM: DELETE
		// alone never shrinks the file on disk.
		if (this.fileSizeBytes() > this.maxTotalBytes) {
			this.db
				.prepare(
					`DELETE FROM hub_events WHERE sequence <= (
						SELECT sequence FROM (
							SELECT sequence, SUM(LENGTH(CAST(envelope_json AS BLOB))) OVER (
								ORDER BY sequence DESC
								ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
							) AS newer_bytes FROM hub_events
						)
						WHERE newer_bytes > ? ORDER BY sequence DESC LIMIT 1
					);`,
				)
				.run(Math.floor(this.maxTotalBytes / 2));
			// VACUUM needs scratch space and can fail on a full disk — the
			// very state a ballooned log causes. The deletes above already
			// bound live data, so keep the log running and let the next
			// sweep retry the reclaim once space frees up.
			try {
				this.db.exec("VACUUM;");
			} catch {
				// Retried on the next sweep.
			}
		}
	}

	private fileSizeBytes(): number {
		const pragma = (name: string) =>
			Number(this.db.prepare(`PRAGMA ${name};`).get()?.[name] ?? 0);
		return pragma("page_count") * pragma("page_size");
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.db.close?.();
	}
}
