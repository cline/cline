import { randomUUID } from "node:crypto";
import {
	type ResolvedStatusQuery,
	STATUS_SCHEMA_VERSION,
	STATUS_TAG_FACET_LIMIT,
	type StatusPage,
	type StatusPriority,
	type StatusPrunePayload,
	type StatusPublishInput,
	StatusPublishInputSchema,
	type StatusState,
	type StatusSummary,
	type StatusTagCount,
	type StatusUpdate,
} from "@cline/shared";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@cline/shared/db";
import { OPEN_STATUS_STATES } from "../session-supersession";
import { resolveStatusDbPath } from "./status-db-path";
import { ensureStatusSchema } from "./status-schema";

const STATUS_SUBJECTS_DEFAULT_LIMIT = 200;

/**
 * Status Hub store backed by `status.db`.
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
function attentionOrderSql(alias: string): string {
	return `CASE ${alias}.state
	WHEN 'blocked' THEN 0
	WHEN 'failed' THEN 1
	WHEN 'running' THEN 2
	WHEN 'queued' THEN 3
	WHEN 'done' THEN 4
	ELSE 5 END`;
}

const ATTENTION_ORDER_SQL = attentionOrderSql("s");

const ATTENTION_RANK: Record<string, number> = {
	blocked: 0,
	failed: 1,
	running: 2,
	queued: 3,
	done: 4,
	cancelled: 5,
};

function attentionRank(state: string): number {
	return ATTENTION_RANK[state] ?? 5;
}

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
		try {
			const schema = ensureStatusSchema(this.db);
			this.ftsAvailable = options.disableFts ? false : schema.ftsAvailable;
		} catch (error) {
			this.db.close?.();
			throw error;
		}
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
					 WHERE subject = ? AND session_id IS ? AND superseded_at IS NULL;`,
				)
				.run(now, parsed.subject, parsed.sessionId ?? null);
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
				 WHERE subject = ? AND superseded_at IS NULL ORDER BY seq DESC LIMIT 1;`,
			)
			.get(subject);
		return row ? rowToStatusUpdate(row) : undefined;
	}

	/**
	 * Every unsuperseded row a session's end could close: the rule's open states.
	 *
	 * No page and no filters: this drives the sweep in `../session-supersession`,
	 * which has to see every open subject to decide which of them belong to
	 * sessions that no longer exist. The states come from the rule so the closed
	 * set has one definition.
	 */
	openRows(): StatusUpdate[] {
		const states = [...OPEN_STATUS_STATES];
		const placeholders = states.map(() => "?").join(", ");
		return this.db
			.prepare(
				`SELECT ${SELECT_COLUMNS} FROM status_updates
				 WHERE superseded_at IS NULL AND state IN (${placeholders})
				 ORDER BY seq ASC;`,
			)
			.all(...states)
			.map(rowToStatusUpdate);
	}

	/**
	 * Everything in a query that selects rows, with the keyset cursor left out.
	 *
	 * Split out because facets have to describe the whole set the filters match,
	 * not the page the cursor lands on — a count that shifted as you paged would
	 * be describing "the rest of the log from here", which is not what a chip
	 * above the list claims.
	 */
	private filterClauses(query: ResolvedStatusQuery): {
		where: string[];
		params: unknown[];
	} {
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
		if (query.tags?.length) {
			// One EXISTS per tag, so several tags narrow (AND) rather than widen.
			// `tags_json` is nullable and predates any writer that always fills it,
			// so a legacy NULL has to read as "no tags" instead of raising
			// "malformed JSON" out of json_each and failing the whole query.
			for (const tag of query.tags) {
				where.push(
					`EXISTS (SELECT 1 FROM json_each(IFNULL(s.tags_json, '[]')) WHERE json_each.value = ?)`,
				);
				params.push(tag);
			}
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

		return { where, params };
	}

	/**
	 * Keyset-paginated query. One extra row is fetched to decide `hasMore`
	 * without a second COUNT over the whole table.
	 */
	query(query: ResolvedStatusQuery): StatusPage {
		const { where, params } = this.filterClauses(query);
		const filterWhere = [...where];
		const filterParams = [...params];

		const newer = query.direction === "newer";
		const byAttention = query.orderBy === "attention";
		if (query.cursor != null) {
			if (byAttention) {
				// Composite keyset: (attention ASC, seq DESC). A seq-only cursor
				// would skip higher-seq rows that sort after the page boundary
				// because they fall in a later attention band.
				const cursorRow = this.db
					.prepare("SELECT state FROM status_updates WHERE seq = ?")
					.get(query.cursor);
				const rank = cursorRow
					? attentionRank(asString(cursorRow.state))
					: null;
				if (rank != null) {
					where.push(
						newer
							? `(${ATTENTION_ORDER_SQL} < ? OR (${ATTENTION_ORDER_SQL} = ? AND s.seq > ?))`
							: `(${ATTENTION_ORDER_SQL} > ? OR (${ATTENTION_ORDER_SQL} = ? AND s.seq < ?))`,
					);
					params.push(rank, rank, query.cursor);
				} else {
					where.push(newer ? "s.seq > ?" : "s.seq < ?");
					params.push(query.cursor);
				}
			} else {
				where.push(newer ? "s.seq > ?" : "s.seq < ?");
				params.push(query.cursor);
			}
		}

		const orderSql = byAttention
			? `${ATTENTION_ORDER_SQL} ASC, s.seq DESC`
			: `s.seq ${newer ? "ASC" : "DESC"}`;

		const extraColumns = [
			query.includeHistoryCount
				? `(SELECT COUNT(*) FROM status_updates h WHERE h.subject = s.subject AND h.session_id IS s.session_id) AS history_count`
				: null,
			`(SELECT p.state FROM status_updates p
				WHERE p.subject = s.subject AND p.session_id IS s.session_id AND p.seq < s.seq
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
			...(query.includeFacets
				? this.facets(filterWhere, filterParams, query.tags ?? [])
				: {}),
		};
	}

	/**
	 * `total` and `tagFacets` over the rows `filterWhere` selects.
	 *
	 * The cursor is deliberately absent from these clauses: both numbers are
	 * rendered next to the chip row as claims about the result set, and a click
	 * re-queries the table from the top rather than continuing the page.
	 */
	private facets(
		filterWhere: readonly string[],
		filterParams: readonly unknown[],
		selected: readonly string[],
	): { total: number; tagFacets: StatusTagCount[] } {
		const whereSql = filterWhere.length
			? `WHERE ${filterWhere.join(" AND ")}`
			: "";

		const totalRow = this.db
			.prepare(`SELECT COUNT(*) AS n FROM status_updates s ${whereSql};`)
			.get(...filterParams);
		const total = Number(totalRow?.n ?? 0);

		// Aliased `je` so the correlated `json_each` inside each tag EXISTS
		// clause keeps resolving to its own subquery table rather than to this
		// one. COUNT(DISTINCT) because a row whose `tags_json` repeats a tag
		// must still count once — the chip promises rows, not tag occurrences.
		// `json_valid` rather than `IFNULL`: this now runs on every page, not
		// only tag-filtered ones, so a legacy row holding '' or any non-JSON
		// text would otherwise raise and take each page load down with it.
		const tagFacets = this.db
			.prepare(
				`SELECT je.value AS tag, COUNT(DISTINCT s.update_id) AS n
				 FROM status_updates s,
					json_each(CASE WHEN json_valid(s.tags_json)
						THEN s.tags_json ELSE '[]' END) je
				 ${whereSql}
				 GROUP BY je.value
				 ORDER BY n DESC, tag ASC
				 LIMIT ?;`,
			)
			.all(...filterParams, STATUS_TAG_FACET_LIMIT)
			.map((row) => ({ tag: asString(row.tag), count: Number(row.n ?? 0) }))
			.filter((facet) => facet.tag !== "" && facet.count > 0);

		// A selected tag must always come back, whatever the cap did. Every row
		// the query matched carries every selected tag — that is what `tags`
		// filters on — so its count is exactly `total`. Restoring it by that
		// identity rather than trusting sort position: the cap orders by count
		// and breaks ties on `tag ASC`, so a selected tag tying with 50
		// alphabetically earlier ones really can fall off the end, and the view
		// would then draw its chip at zero beside a non-zero result count.
		if (total > 0) {
			const present = new Set(tagFacets.map((facet) => facet.tag));
			for (const tag of selected) {
				if (!present.has(tag)) tagFacets.push({ tag, count: total });
			}
		}

		return { total, tagFacets };
	}

	/**
	 * Aggregates over live rows. Runs against the whole table rather than a
	 * page, so "12 blocked" means twelve, not twelve on this page.
	 */
	summary(): StatusSummary {
		const byState: StatusSummary["byState"] = {
			queued: 0,
			running: 0,
			blocked: 0,
			done: 0,
			failed: 0,
			cancelled: 0,
		};
		for (const row of this.db
			.prepare(
				`SELECT state, COUNT(*) AS n FROM status_updates
				 WHERE superseded_at IS NULL GROUP BY state;`,
			)
			.all()) {
			byState[asString(row.state) as StatusState] = Number(row.n ?? 0);
		}

		/*
		 * `latest_subject` rides along on MAX(seq) rather than needing a second
		 * query: SQLite's bare-column rule guarantees the other columns of a
		 * grouped row come from the row that produced the MAX. `seq` carries the
		 * ordering because it is UNIQUE and strictly increasing, where
		 * `created_at` can tie at millisecond resolution.
		 */
		const byAgent = this.db
			.prepare(
				`SELECT agent_id, agent_name,
					COUNT(*) AS total,
					SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
					SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running,
					MAX(seq) AS latest_seq,
					subject AS latest_subject,
					COUNT(DISTINCT subject) AS subject_count
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
				latestSubject: asOptionalString(row.latest_subject) ?? null,
				latestSeq: Number(row.latest_seq ?? 0),
				subjectCount: Number(row.subject_count ?? 0),
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
	subjects(limit = STATUS_SUBJECTS_DEFAULT_LIMIT): string[] {
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
								ROW_NUMBER() OVER (PARTITION BY session_id, subject ORDER BY seq DESC) AS rn
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
