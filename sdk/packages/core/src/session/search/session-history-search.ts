import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadSqliteDb, nowIso, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import type { RuntimeHost } from "../../runtime/host/runtime-host";
import type { SessionRecord } from "../../types/sessions";

const INDEX_VERSION = 2;
const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60_000;
const MAX_INDEXED_TEXT_LENGTH = 128 * 1024;
const MAX_SESSIONS = 100_000;

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

function appendSearchableText(value: unknown, output: string[]): void {
	if (output.join("\n").length >= MAX_INDEXED_TEXT_LENGTH) return;
	if (typeof value === "string") {
		output.push(value);
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
	const output: string[] = [];
	appendSearchableText(record?.content ?? message, output);
	return output.join("\n").slice(0, MAX_INDEXED_TEXT_LENGTH).trim();
}

function messageRole(message: unknown): string {
	const role = asRecord(message)?.role;
	return typeof role === "string" ? role : "unknown";
}

function sessionTitle(session: SessionRecord): string {
	const title = session.metadata?.title;
	return typeof title === "string" && title.trim()
		? title.trim()
		: session.prompt?.trim() || session.sessionId;
}

function ftsQuery(query: string): string {
	return query
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((token) => `"${token.replaceAll('"', '""')}"*`)
		.join(" AND ");
}

export class SessionHistorySearchService {
	private readonly db: SqliteDb;
	private readonly intervalMs: number;
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
		this.db = loadSqliteDb(
			options.dbPath ?? join(resolveDbDataDir(), "session-search.db"),
		);
		this.intervalMs =
			options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
		this.ensureSchema();
	}

	start(): void {
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
		this.db.close?.();
	}

	refreshNow(): Promise<void> {
		if (!this.refreshPromise) {
			this.refreshPromise = this.reconcile().finally(() => {
				this.refreshPromise = undefined;
			});
		}
		return this.refreshPromise;
	}

	async waitUntilReady(): Promise<void> {
		await this.readyPromise;
	}

	search(input: SessionSearchInput): SessionSearchHit[] {
		const query = ftsQuery(input.query);
		if (!query) return [];
		const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
		const workspaceRoot = input.workspaceRoot?.trim();
		const rows = this.db
			.prepare(
				`SELECT session_search.session_id, document_id, ordinal, role, started_at,
					workspace_root, indexed_sessions.title,
					snippet(session_search, 7, '[', ']', '…', 24) AS snippet,
					bm25(session_search, 0, 0, 0, 0, 0.5, 8.0, 1.0) AS score
				 FROM session_search
				 JOIN indexed_sessions
					ON indexed_sessions.session_id = session_search.session_id
				 WHERE session_search MATCH ?
					AND (? IS NULL OR workspace_root = ?)
				 ORDER BY score, started_at DESC
				 LIMIT ?`,
			)
			.all(query, workspaceRoot ?? null, workspaceRoot ?? null, limit) as Array<
			Record<string, unknown>
		>;
		return rows.map((row) => ({
			sessionId: String(row.session_id),
			documentId: String(row.document_id),
			ordinal: Number(row.ordinal),
			role: String(row.role),
			startedAt: String(row.started_at),
			workspaceRoot: String(row.workspace_root),
			title: String(row.title),
			snippet: String(row.snippet ?? ""),
			score: Number(row.score),
		}));
	}

	private ensureSchema(): void {
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec(`CREATE TABLE IF NOT EXISTS indexed_sessions (
			session_id TEXT PRIMARY KEY,
			source_revision TEXT NOT NULL,
			indexed_at TEXT NOT NULL,
			document_count INTEGER NOT NULL,
			index_version INTEGER NOT NULL,
			title TEXT NOT NULL DEFAULT ''
		);`);
		const indexedSessionColumns = new Set(
			(
				this.db.prepare("PRAGMA table_info(indexed_sessions)").all() as Array<{
					name: string;
				}>
			).map((column) => column.name),
		);
		if (!indexedSessionColumns.has("title")) {
			this.db.exec(
				"ALTER TABLE indexed_sessions ADD COLUMN title TEXT NOT NULL DEFAULT '';",
			);
		}
		this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
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

	private async reconcile(): Promise<void> {
		const sessions = await this.host.listSessions(MAX_SESSIONS);
		const liveIds = new Set(sessions.map((session) => session.sessionId));
		const indexed = this.db
			.prepare(
				"SELECT session_id, source_revision, index_version FROM indexed_sessions",
			)
			.all() as Array<Record<string, unknown>>;
		const indexedById = new Map(
			indexed.map((row) => [String(row.session_id), row] as const),
		);

		for (const session of sessions) {
			const revision = await this.sourceRevision(session);
			const current = indexedById.get(session.sessionId);
			if (
				current?.source_revision === revision &&
				Number(current.index_version) === INDEX_VERSION
			) {
				continue;
			}
			await this.indexSession(session, revision);
		}

		for (const row of indexed) {
			const sessionId = String(row.session_id);
			if (!liveIds.has(sessionId)) this.deleteSession(sessionId);
		}
	}

	private async sourceRevision(session: SessionRecord): Promise<string> {
		if (!session.messagesPath) return `${session.updatedAt}:missing`;
		const file = await stat(session.messagesPath).catch(() => undefined);
		return `${session.updatedAt}:${file?.size ?? 0}:${file?.mtimeMs ?? 0}`;
	}

	private async indexSession(
		session: SessionRecord,
		revision: string,
	): Promise<void> {
		const messages = await this.host
			.readSessionMessages(session.sessionId)
			.catch(() => []);
		const title = sessionTitle(session);
		const insert = this.db.prepare(
			`INSERT INTO session_search (
				session_id, document_id, ordinal, role, started_at,
				workspace_root, title, content
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.db.exec("BEGIN IMMEDIATE;");
		try {
			this.db
				.prepare("DELETE FROM session_search WHERE session_id = ?")
				.run(session.sessionId);
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
			this.db
				.prepare(
					`INSERT INTO indexed_sessions (
						session_id, source_revision, indexed_at, document_count, index_version, title
					) VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT(session_id) DO UPDATE SET
						source_revision = excluded.source_revision,
						indexed_at = excluded.indexed_at,
						document_count = excluded.document_count,
						index_version = excluded.index_version,
						title = excluded.title`,
				)
				.run(
					session.sessionId,
					revision,
					nowIso(),
					count,
					INDEX_VERSION,
					title,
				);
			this.db.exec("COMMIT;");
		} catch (error) {
			this.db.exec("ROLLBACK;");
			throw error;
		}
	}

	private deleteSession(sessionId: string): void {
		this.db.exec("BEGIN IMMEDIATE;");
		try {
			this.db
				.prepare("DELETE FROM session_search WHERE session_id = ?")
				.run(sessionId);
			this.db
				.prepare("DELETE FROM indexed_sessions WHERE session_id = ?")
				.run(sessionId);
			this.db.exec("COMMIT;");
		} catch (error) {
			this.db.exec("ROLLBACK;");
			throw error;
		}
	}
}
