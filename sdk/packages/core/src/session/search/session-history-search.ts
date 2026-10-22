import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
	formatSessionSearchPreview,
	formatSessionSearchTitle,
} from "@cline/shared";
import { loadSqliteDb, nowIso, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import type { RuntimeHost } from "../../runtime/host/runtime-host";
import type { SessionRecord } from "../../types/sessions";

const INDEX_VERSION = 2;
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60_000;
const MAX_INDEXED_TEXT_LENGTH = 128 * 1024;
const MAX_SESSIONS = 100_000;
const MAX_SEARCH_CANDIDATES = 2_000;
// FTS5 weights are positional and include the five UNINDEXED metadata columns.
const SESSION_SEARCH_RANKING = "bm25(0, 0, 0, 0, 0, 0.5, 8.0, 1.0)";

export interface SessionSearchInput {
	query: string;
	limit?: number;
	workspaceRoot?: string;
}

export interface SessionSearchHit {
	sessionId: string;
	documentId: string;
	ordinal: number;
	role: string;
	startedAt: string;
	workspaceRoot: string;
	title: string;
	snippet: string;
	score: number;
}

export interface SessionHistorySearchOptions {
	dbPath?: string;
	reconcileIntervalMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

interface SearchableTextAccumulator {
	length: number;
	parts: string[];
}

function appendSearchableText(
	value: unknown,
	output: SearchableTextAccumulator,
): void {
	if (output.length >= MAX_INDEXED_TEXT_LENGTH) return;
	if (typeof value === "string") {
		const separatorLength = output.parts.length > 0 ? 1 : 0;
		const remaining = MAX_INDEXED_TEXT_LENGTH - output.length - separatorLength;
		if (remaining <= 0) return;
		const part = value.slice(0, remaining);
		if (!part) return;
		output.parts.push(part);
		output.length += separatorLength + part.length;
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) appendSearchableText(item, output);
		return;
	}
	const record = asRecord(value);
	if (!record) return;
	for (const [key, item] of Object.entries(record)) {
		if (
			key === "data" ||
			key === "image" ||
			key === "images" ||
			key === "reasoning" ||
			key === "thinking" ||
			key === "metadata"
		) {
			continue;
		}
		appendSearchableText(item, output);
	}
}

function messageText(message: unknown): string {
	const record = asRecord(message);
	const output: SearchableTextAccumulator = { length: 0, parts: [] };
	appendSearchableText(record?.content ?? message, output);
	return output.parts.join("\n").trim();
}

function messageRole(message: unknown): string {
	const role = asRecord(message)?.role;
	return typeof role === "string" ? role : "unknown";
}

function sessionTitle(session: SessionRecord): string {
	const title = session.metadata?.title;
	const source =
		typeof title === "string" && title.trim()
			? title
			: session.prompt || session.sessionId;
	return formatSessionSearchTitle(source) || session.sessionId;
}

function ftsQuery(query: string): string {
	return query
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((token) => `"${token.replaceAll('"', '""')}"*`)
		.join(" AND ");
}

function ensureSearchSchema(db: SqliteDb): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(`CREATE TABLE IF NOT EXISTS indexed_sessions (
		session_id TEXT PRIMARY KEY,
		source_revision TEXT NOT NULL,
		indexed_at TEXT NOT NULL,
		document_count INTEGER NOT NULL,
		index_version INTEGER NOT NULL,
		title TEXT NOT NULL DEFAULT ''
	);`);
	const indexedSessionColumns = new Set(
		(
			db.prepare("PRAGMA table_info(indexed_sessions)").all() as Array<{
				name: string;
			}>
		).map((column) => column.name),
	);
	if (!indexedSessionColumns.has("title")) {
		db.exec(
			"ALTER TABLE indexed_sessions ADD COLUMN title TEXT NOT NULL DEFAULT '';",
		);
	}
	db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
		session_id UNINDEXED,
		document_id UNINDEXED,
		ordinal UNINDEXED,
		role UNINDEXED,
		started_at UNINDEXED,
		workspace_root,
		title,
		content,
		tokenize='unicode61 remove_diacritics 2 tokenchars ''_-@'''
	);`);
}

function initializeSearchDatabase(dbPath: string): {
	db?: SqliteDb;
	error?: unknown;
} {
	let db: SqliteDb | undefined;
	try {
		db = loadSqliteDb(dbPath);
		ensureSearchSchema(db);
		return { db };
	} catch (error) {
		try {
			db?.close?.();
		} catch {
			// The database is already unavailable; preserve the initialization error.
		}
		return {
			error:
				error ?? new Error("Session search database initialization failed"),
		};
	}
}

export class SessionHistorySearchService {
	private readonly db: SqliteDb | undefined;
	private readonly initializationError: unknown | undefined;
	private readonly intervalMs: number;
	private readonly removedDuringRefresh = new Set<string>();
	private readonly failedEvictionSessionIds = new Set<string>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private refreshPromise: Promise<void> | undefined;
	private readyPromise: Promise<void> = Promise.resolve();

	constructor(
		private readonly host: Pick<
			RuntimeHost,
			"listSessions" | "readSessionMessages"
		>,
		options: SessionHistorySearchOptions = {},
	) {
		const initialized = initializeSearchDatabase(
			options.dbPath ?? join(resolveDbDataDir(), "session-search.db"),
		);
		this.db = initialized.db;
		this.initializationError = initialized.error;
		this.intervalMs =
			options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
	}

	start(): void {
		if (!this.db) return;
		this.readyPromise = this.refreshNow();
		void this.readyPromise.catch((error) =>
			console.warn("[hub] session search indexing failed", error),
		);
		this.timer = setInterval(() => {
			void this.refreshNow().catch((error) =>
				console.warn("[hub] session search reconciliation failed", error),
			);
		}, this.intervalMs);
		this.timer.unref?.();
	}

	async dispose(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		await this.refreshPromise?.catch(() => undefined);
		this.db?.close?.();
	}

	refreshNow(): Promise<void> {
		const db = this.db;
		if (!db) return Promise.resolve();
		if (!this.refreshPromise) {
			this.refreshPromise = this.reconcile(db).finally(() => {
				this.removedDuringRefresh.clear();
				this.refreshPromise = undefined;
			});
		}
		return this.refreshPromise;
	}

	/**
	 * Removes one session from the derived index without scanning canonical
	 * history. The temporary tombstone prevents an in-flight reconciliation
	 * that captured the session before deletion from writing it back.
	 */
	removeSession(sessionId: string): void {
		const db = this.db;
		if (!db) return;
		const normalized = sessionId.trim();
		if (!normalized) return;
		if (this.refreshPromise) this.removedDuringRefresh.add(normalized);
		try {
			this.deleteIndexedSession(db, normalized);
			this.failedEvictionSessionIds.delete(normalized);
		} catch (error) {
			// Keep failed evictions hidden until reconciliation can retry the
			// disposable database cleanup successfully.
			this.failedEvictionSessionIds.add(normalized);
			throw error;
		}
	}

	async waitUntilReady(): Promise<void> {
		await this.readyPromise;
	}

	isAvailable(): boolean {
		return this.db !== undefined;
	}

	getInitializationError(): unknown | undefined {
		return this.initializationError;
	}

	search(input: SessionSearchInput): SessionSearchHit[] {
		const db = this.db;
		if (!db) return [];
		const query = ftsQuery(input.query);
		if (!query) return [];
		const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
		// Bound per-session deduplication work for broad queries while scanning
		// enough ranked candidates to keep chatty sessions from crowding the list.
		const candidateLimit = Math.min(
			Math.max(limit * 20, 200),
			MAX_SEARCH_CANDIDATES,
		);
		const workspaceRoot = input.workspaceRoot?.trim();
		const rows = db
			.prepare(
				`WITH matches AS MATERIALIZED (
					SELECT session_search.session_id, document_id, ordinal, role, started_at,
						workspace_root, indexed_sessions.title,
						snippet(session_search, 7, '[', ']', '…', 24) AS snippet,
						session_search.rank AS score
					FROM session_search
					JOIN indexed_sessions
						ON indexed_sessions.session_id = session_search.session_id
					WHERE session_search MATCH ?
						AND session_search.rank MATCH ?
						AND (? IS NULL OR workspace_root = ?)
					ORDER BY score, started_at DESC
					LIMIT ?
				), ranked AS (
					SELECT *, ROW_NUMBER() OVER (
						PARTITION BY session_id ORDER BY score, ordinal
					) AS session_rank
					FROM matches
				)
				SELECT session_id, document_id, ordinal, role, started_at,
					workspace_root, title, snippet, score
				FROM ranked
				WHERE session_rank = 1
				ORDER BY score, started_at DESC
				LIMIT ?`,
			)
			.all(
				query,
				SESSION_SEARCH_RANKING,
				workspaceRoot ?? null,
				workspaceRoot ?? null,
				candidateLimit,
				limit,
			) as Array<Record<string, unknown>>;
		const visibleRows =
			this.removedDuringRefresh.size === 0 &&
			this.failedEvictionSessionIds.size === 0
				? rows
				: rows.filter(
						(row) => !this.isSessionSuppressed(String(row.session_id)),
					);
		return visibleRows.map((row) => {
			const role = String(row.role);
			return {
				sessionId: String(row.session_id),
				documentId: String(row.document_id),
				ordinal: Number(row.ordinal),
				role,
				startedAt: String(row.started_at),
				workspaceRoot: String(row.workspace_root),
				title: formatSessionSearchTitle(String(row.title)),
				snippet: formatSessionSearchPreview(role, String(row.snippet ?? "")),
				score: Number(row.score),
			};
		});
	}

	private isSessionSuppressed(sessionId: string): boolean {
		return (
			this.removedDuringRefresh.has(sessionId) ||
			this.failedEvictionSessionIds.has(sessionId)
		);
	}

	private async reconcile(db: SqliteDb): Promise<void> {
		const sessions = await this.host.listSessions(MAX_SESSIONS);
		const liveIds = new Set(sessions.map((session) => session.sessionId));
		const indexed = db
			.prepare(
				"SELECT session_id, source_revision, index_version FROM indexed_sessions",
			)
			.all() as Array<Record<string, unknown>>;
		const indexedById = new Map(
			indexed.map((row) => [String(row.session_id), row] as const),
		);

		for (const session of sessions) {
			if (this.isSessionSuppressed(session.sessionId)) continue;
			const revision = await this.sourceRevision(session);
			if (this.isSessionSuppressed(session.sessionId)) continue;
			const current = indexedById.get(session.sessionId);
			if (
				current?.source_revision === revision &&
				Number(current.index_version) === INDEX_VERSION
			) {
				continue;
			}
			await this.indexSession(db, session, revision);
		}

		for (const row of indexed) {
			const sessionId = String(row.session_id);
			if (!liveIds.has(sessionId) || this.isSessionSuppressed(sessionId)) {
				this.deleteIndexedSession(db, sessionId);
				this.failedEvictionSessionIds.delete(sessionId);
			}
		}
		const currentIndexedSession = db.prepare(
			"SELECT 1 FROM indexed_sessions WHERE session_id = ? LIMIT 1",
		);
		for (const sessionId of this.failedEvictionSessionIds) {
			// `indexedById` is a snapshot captured before this reconciliation may
			// have indexed the session. Re-check the database so a concurrent failed
			// eviction cannot lose its suppression marker after inserting a new row.
			if (!currentIndexedSession.get(sessionId)) {
				this.failedEvictionSessionIds.delete(sessionId);
			}
		}
	}

	private async sourceRevision(session: SessionRecord): Promise<string> {
		if (!session.messagesPath) return `${session.updatedAt}:missing`;
		const file = await stat(session.messagesPath).catch(() => undefined);
		return `${session.updatedAt}:${file?.size ?? 0}:${file?.mtimeMs ?? 0}`;
	}

	private async indexSession(
		db: SqliteDb,
		session: SessionRecord,
		revision: string,
	): Promise<void> {
		const messages = await this.host
			.readSessionMessages(session.sessionId)
			.catch(() => []);
		if (this.removedDuringRefresh.has(session.sessionId)) return;
		const title = sessionTitle(session);
		const insert = db.prepare(
			`INSERT INTO session_search (
				session_id, document_id, ordinal, role, started_at,
				workspace_root, title, content
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		db.exec("BEGIN IMMEDIATE;");
		try {
			db.prepare("DELETE FROM session_search WHERE session_id = ?").run(
				session.sessionId,
			);
			insert.run(
				session.sessionId,
				`${session.sessionId}:metadata`,
				-1,
				"session",
				session.startedAt,
				session.workspaceRoot,
				title,
				session.prompt?.trim() ?? "",
			);
			let count = 1;
			for (const [ordinal, message] of messages.entries()) {
				const content = messageText(message);
				if (!content) continue;
				insert.run(
					session.sessionId,
					`${session.sessionId}:${ordinal}`,
					ordinal,
					messageRole(message),
					session.startedAt,
					session.workspaceRoot,
					"",
					content,
				);
				count += 1;
			}
			db.prepare(
				`INSERT INTO indexed_sessions (
						session_id, source_revision, indexed_at, document_count, index_version, title
					) VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT(session_id) DO UPDATE SET
						source_revision = excluded.source_revision,
						indexed_at = excluded.indexed_at,
						document_count = excluded.document_count,
						index_version = excluded.index_version,
						title = excluded.title`,
			).run(session.sessionId, revision, nowIso(), count, INDEX_VERSION, title);
			db.exec("COMMIT;");
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	private deleteIndexedSession(db: SqliteDb, sessionId: string): void {
		db.exec("BEGIN IMMEDIATE;");
		try {
			db.prepare("DELETE FROM session_search WHERE session_id = ?").run(
				sessionId,
			);
			db.prepare("DELETE FROM indexed_sessions WHERE session_id = ?").run(
				sessionId,
			);
			db.exec("COMMIT;");
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}
}
