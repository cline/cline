import { randomUUID } from "node:crypto";
import {
	type ResolvedStatusQuery,
	STATUS_SCHEMA_VERSION,
	type StatusPage,
	type StatusPriority,
	type StatusPrunePayload,
	type StatusPublishInput,
	StatusPublishInputSchema,
	type StatusState,
	type StatusSummary,
	type StatusUpdate,
} from "@cline/shared";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@cline/shared/db";
import { resolveStatusDbPath } from "@cline/shared/storage";
import { ensureStatusSchema } from "./status-schema";

/**
 * Status Hub store backed by `status.db` (ARD-0005).
 *
 * Append-only: rows are never rewritten except to stamp `superseded_at`, so
 * the table doubles as a per-subject changelog and as a "current state of
 * everything" index.
 */

const SELECT_COLUMNS = `
	update_id, seq, subject, state, headline, detail, priority, progress,
	session_id, agent_id, agent_name, workspace_root, source,
	tags_json, metadata_json, superseded_at, created_at
`;

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
	const raw = asOptionalString(value);
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function parseJsonStringArray(value: unknown): string[] {
	const raw = asOptionalString(value);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

/**
 * Attention order: what a human needs to look at, not what moved last.
 * Lower sorts first.
 */
const ATTENTION_ORDER_SQL = `CASE s.state
	WHEN 'blocked' THEN 0
	WHEN 'failed' THEN 1
	WHEN 'running' THEN 2
	WHEN 'queued' THEN 3
	WHEN 'done' THEN 4
	ELSE 5 END`;

function rowToStatusUpdate(row: Record<string, unknown>): StatusUpdate {
	const historyCount = asOptionalNumber(row.history_count);
	const previousState = asOptionalString(row.previous_state) as
		| StatusState
		| undefined;
	return {
		schemaVersion: STATUS_SCHEMA_VERSION,
		updateId: asString(row.update_id),
		seq: Number(row.seq),
		subject: asString(row.subject),
		state: asString(row.state) as StatusState,
		headline: asString(row.headline),
		detail: asOptionalString(row.detail),
		priority: asString(row.priority) as StatusPriority,
		progress: asOptionalNumber(row.progress),
		sessionId: asOptionalString(row.session_id),
		agentId: asOptionalString(row.agent_id),
		agentName: asOptionalString(row.agent_name),
		workspaceRoot: asOptionalString(row.workspace_root),
		source: asString(row.source),
		tags: parseJsonStringArray(row.tags_json),
		metadata: parseJsonObject(row.metadata_json),
		supersededAt: asOptionalString(row.superseded_at) ?? null,
		createdAt: asString(row.created_at),
		...(historyCount != null ? { historyCount } : {}),
		...(previousState != null ? { previousState } : {}),
	};
}

/** Escape LIKE wildcards so a user searching for `100%` does not match everything. */
function escapeLikePattern(text: string): string {
	return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface SqliteStatusStoreOptions {
	/**
	 * Force the LIKE search path even where FTS5 exists. Tests use this to
	 * cover the fallback on every runtime — under Bun FTS5 is always present,
	 * but the published SDK runs on Node where it is not, so the LIKE path
	 * cannot be left to whichever runtime happens to run CI.
	 */
	disableFts?: boolean;
}

export class SqliteStatusStore {
	private readonly db: SqliteDb;
	/** True when text search uses FTS5; false when it degrades to LIKE. */
	readonly ftsAvailable: boolean;

	constructor(
		dbPath: string = resolveStatusDbPath(),
		options: SqliteStatusStoreOptions = {},
	) {
		this.db = loadSqliteDb(dbPath);
		const schema = ensureStatusSchema(this.db);
		this.ftsAvailable = options.disableFts ? false : schema.ftsAvailable;
	}

	close(): void {
		this.db.close?.();
	}

	private nextSeq(): number {
		const row = this.db
			.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM status_updates;")
			.get();
		return Number(row?.max_seq ?? 0) + 1;
	}

	/**
	 * Append an update and supersede the previous current row for the subject.
	 *
	 * Wrapped in IMMEDIATE so the supersede and the insert cannot interleave
	 * with a concurrent publisher — the partial unique index would reject the
	 * second insert, and a retry would be the caller's problem otherwise.
	 */
	publish(input: StatusPublishInput): StatusUpdate {
		const parsed = StatusPublishInputSchema.parse(input);
		const now = nowIso();
		const updateId = randomUUID();

		this.db.exec("BEGIN IMMEDIATE;");
		try {
			const seq = this.nextSeq();
			this.db
				.prepare(
					`UPDATE status_updates SET superseded_at = ?
					 WHERE subject = ? AND superseded_at IS NULL;`,
				)
				.run(now, parsed.subject);
			this.db
				.prepare(
					`INSERT INTO status_updates (
						update_id, seq, subject, state, headline, detail, priority, progress,
						session_id, agent_id, agent_name, workspace_root, source,
						tags_json, metadata_json, superseded_at, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`,
				)
				.run(
					updateId,
					seq,
					parsed.subject,
					parsed.state,
					parsed.headline,
					parsed.detail ?? null,
					parsed.priority,
					parsed.progress ?? null,
					parsed.sessionId ?? null,
					parsed.agentId ?? null,
					parsed.agentName ?? null,
					parsed.workspaceRoot ?? null,
					parsed.source,
					JSON.stringify(parsed.tags),
					parsed.metadata ? JSON.stringify(parsed.metadata) : null,
					now,
				);
			this.db.exec("COMMIT;");
			return {
				schemaVersion: STATUS_SCHEMA_VERSION,
				updateId,
				seq,
				subject: parsed.subject,
				state: parsed.state,
				headline: parsed.headline,
				detail: parsed.detail,
				priority: parsed.priority,
				progress: parsed.progress,
				sessionId: parsed.sessionId,
				agentId: parsed.agentId,
				agentName: parsed.agentName,
				workspaceRoot: parsed.workspaceRoot,
				source: parsed.source,
				tags: parsed.tags,
				metadata: parsed.metadata,
				supersededAt: null,
				createdAt: now,
			};
		} catch (error) {
			this.db.exec("ROLLBACK;");
			throw error;
		}
	}

	/** Current update for one subject, or undefined if the subject is unknown. */
	current(subject: string): StatusUpdate | undefined {
		const row = this.db
			.prepare(
				`SELECT ${SELECT_COLUMNS} FROM status_updates
				 WHERE subject = ? AND superseded_at IS NULL;`,
			)
			.get(subject);
		return row ? rowToStatusUpdate(row) : undefined;
	}

	/**
	 * Keyset-paginated query. One extra row is fetched to decide `hasMore`
	 * without a second COUNT over the whole table.
	 */
	query(query: ResolvedStatusQuery): StatusPage {
		const where: string[] = [];
		const params: unknown[] = [];

		if (query.currentOnly) {
			where.push("s.superseded_at IS NULL");
		}
		if (query.subject) {
			where.push("s.subject = ?");
			params.push(query.subject);
		}
		if (query.subjectPrefix) {
			where.push("s.subject LIKE ? ESCAPE '\\'");
			params.push(`${escapeLikePattern(query.subjectPrefix)}%`);
		}
		if (query.state?.length) {
			where.push(`s.state IN (${query.state.map(() => "?").join(", ")})`);
			params.push(...query.state);
		}
		if (query.priority?.length) {
			where.push(`s.priority IN (${query.priority.map(() => "?").join(", ")})`);
			params.push(...query.priority);
		}
		if (query.sessionId) {
			where.push("s.session_id = ?");
			params.push(query.sessionId);
		}
		if (query.agentId) {
			where.push("s.agent_id = ?");
			params.push(query.agentId);
		}
		if (query.workspaceRoot) {
			where.push("s.workspace_root = ?");
			params.push(query.workspaceRoot);
		}

		if (query.text) {
			if (this.ftsAvailable) {
				where.push(
					"s.rowid IN (SELECT rowid FROM status_fts WHERE status_fts MATCH ?)",
				);
				// Quote so user punctuation cannot be read as FTS5 query syntax.
				params.push(`"${query.text.replace(/"/g, '""')}"`);
			} else {
				where.push(
					"(s.headline LIKE ? ESCAPE '\\' OR IFNULL(s.detail, '') LIKE ? ESCAPE '\\')",
				);
				const pattern = `%${escapeLikePattern(query.text)}%`;
				params.push(pattern, pattern);
			}
		}

		const newer = query.direction === "newer";
		if (query.cursor != null) {
			where.push(newer ? "s.seq > ?" : "s.seq < ?");
			params.push(query.cursor);
		}

		// Attention order still tie-breaks on seq, so keyset paging by seq stays
		// correct within a band. Paging across bands is intentionally not
		// supported for attention order -- the board is meant to be read from
		// the top, and the summary carries the full counts.
		const orderSql =
			query.orderBy === "attention"
				? `${ATTENTION_ORDER_SQL} ASC, s.seq DESC`
				: `s.seq ${newer ? "ASC" : "DESC"}`;

		const extraColumns = [
			query.includeHistoryCount
				? `(SELECT COUNT(*) FROM status_updates h WHERE h.subject = s.subject) AS history_count`
				: null,
			`(SELECT p.state FROM status_updates p
				WHERE p.subject = s.subject AND p.seq < s.seq
				ORDER BY p.seq DESC LIMIT 1) AS previous_state`,
		]
			.filter(Boolean)
			.join(", ");

		const sql = `SELECT ${SELECT_COLUMNS}, ${extraColumns} FROM status_updates s
			${where.length ? `WHERE ${where.join(" AND ")}` : ""}
			ORDER BY ${orderSql}
			LIMIT ?;`;

		const rows = this.db.prepare(sql).all(...params, query.limit + 1);
		const hasMore = rows.length > query.limit;
		const page = hasMore ? rows.slice(0, query.limit) : rows;
		const updates = page.map(rowToStatusUpdate);

		return {
			updates,
			hasMore,
			nextCursor: hasMore ? (updates.at(-1)?.seq ?? null) : null,
		};
	}

	/**
	 * Aggregates over live rows. Runs against the whole table rather than a
	 * page, so "12 blocked" means twelve, not twelve on this page.
	 */
	summary(): StatusSummary {
		const byState: Record<string, number> = {};
		for (const row of this.db
			.prepare(
				`SELECT state, COUNT(*) AS n FROM status_updates
				 WHERE superseded_at IS NULL GROUP BY state;`,
			)
			.all()) {
			byState[asString(row.state)] = Number(row.n ?? 0);
		}

		const byAgent = this.db
			.prepare(
				`SELECT agent_id, agent_name,
					COUNT(*) AS total,
					SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
					SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running
				 FROM status_updates
				 WHERE superseded_at IS NULL AND agent_id IS NOT NULL
				 GROUP BY agent_id, agent_name
				 ORDER BY blocked DESC, total DESC
				 LIMIT 50;`,
			)
			.all()
			.map((row) => ({
				agentId: asString(row.agent_id),
				agentName: asOptionalString(row.agent_name),
				total: Number(row.total ?? 0),
				blocked: Number(row.blocked ?? 0),
				running: Number(row.running ?? 0),
			}));

		const latest = this.db
			.prepare("SELECT MAX(created_at) AS last_at FROM status_updates;")
			.get();

		return {
			total: Object.values(byState).reduce((sum, n) => sum + n, 0),
			byState: byState as StatusSummary["byState"],
			byAgent,
			lastUpdatedAt: asOptionalString(latest?.last_at) ?? null,
		};
	}

	/** Highest assigned seq. Consumers use it as a starting resume cursor. */
	latestSeq(): number {
		const row = this.db
			.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM status_updates;")
			.get();
		return Number(row?.max_seq ?? 0);
	}

	/** Distinct subjects with a live row, newest first. */
	subjects(limit = 200): string[] {
		return this.db
			.prepare(
				`SELECT subject FROM status_updates
				 WHERE superseded_at IS NULL ORDER BY seq DESC LIMIT ?;`,
			)
			.all(limit)
			.map((row) => asString(row.subject));
	}

	/**
	 * Delete superseded history. Current rows are never pruned — pruning must
	 * not be able to make a subject's status disappear.
	 */
	prune(payload: StatusPrunePayload): number {
		let deleted = 0;
		if (payload.before) {
			const result = this.db
				.prepare(
					`DELETE FROM status_updates
					 WHERE superseded_at IS NOT NULL AND created_at < ?;`,
				)
				.run(payload.before);
			deleted += result.changes ?? 0;
		}
		if (payload.keepPerSubject != null) {
			const result = this.db
				.prepare(
					`DELETE FROM status_updates WHERE update_id IN (
						SELECT update_id FROM (
							SELECT update_id,
								ROW_NUMBER() OVER (PARTITION BY subject ORDER BY seq DESC) AS rn
							FROM status_updates WHERE superseded_at IS NOT NULL
						) WHERE rn > ?
					);`,
				)
				.run(payload.keepPerSubject);
			deleted += result.changes ?? 0;
		}
		return deleted;
	}
}
