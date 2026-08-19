/**
 * SQLite-backed stores (Gateway RFC, Phase 3).
 *
 * Real implementations of the ports that `@cline/bot` consumes (bot,
 * session, and run repositories) plus the Gateway-only durable stores:
 * run attempts, the global event log, canonical message history (behind
 * the `AgentMessage` messages contract), the idempotency ledger, the
 * outbox, the audit trail, the client registry, and instance metadata.
 *
 * All writes go through the single Gateway process (ADR 0001); the
 * repositories still enforce the domain invariants (immutable role and
 * parent, immutable session workspace) as a backstop.
 */

import type {
	BotRecord,
	BotRepository,
	RunRecord,
	RunRepository,
	SessionRecord,
	SessionRepository,
} from "@cline/bot";
import { RoleImmutableError, WorkspaceImmutableError } from "@cline/bot";
import type { AgentMessage } from "@cline/shared";
import type {
	BotId,
	ClientId,
	GatewayEvent,
	GatewayEventScope,
	GatewayId,
	GatewayResponse,
	IdempotencyKey,
	RunExecutionSnapshot,
	RunId,
	RunState,
	SessionId,
} from "@cline/shared/gateway";
import {
	createGatewayError,
	createGatewayId,
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventSchema,
} from "@cline/shared/gateway";
import { ConnectorOutboundStore } from "./connectors/outbound-store";
import {
	ConnectorCursorStore,
	ConnectorInstanceStore,
	ConnectorStore,
	SqliteConnectorRouteStore,
} from "./connectors/store";
import type { GatewayDatabase } from "./db";
import type { IdempotencyBeginOutcome } from "./idempotency-ledger";
import { stableStringify } from "./idempotency-ledger";
import { PluginStateStore } from "./plugins/state-store";
import { RunProvenanceStore } from "./provenance-store";
import { ScheduleJobStore, ScheduleStore } from "./schedules/store";
import { UsageStore, type UsageStoreOptions } from "./usage";

// -----------------------------------------------------------------------------
// Meta
// -----------------------------------------------------------------------------

const GATEWAY_ID_KEY = "gateway_id";
const CATALOG_GENERATION_KEY = "catalog_generation";

export class MetaStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(key: string): string | undefined {
		const row = this.database.db
			.prepare("SELECT value FROM meta WHERE key = ?;")
			.get(key);
		return row ? String(row.value) : undefined;
	}

	set(key: string, value: string): void {
		this.database.db
			.prepare(
				"INSERT INTO meta (key, value) VALUES (?, ?) " +
					"ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
			)
			.run(key, value);
	}

	/** Durable `GatewayId`: created once, stable across restarts/upgrades. */
	ensureGatewayId(): GatewayId {
		const existing = this.get(GATEWAY_ID_KEY);
		if (existing) {
			return existing as GatewayId;
		}
		const created = createGatewayId();
		this.set(GATEWAY_ID_KEY, created);
		return created;
	}

	catalogGeneration(): number {
		return Number(this.get(CATALOG_GENERATION_KEY) ?? "0");
	}

	bumpCatalogGeneration(): number {
		const next = this.catalogGeneration() + 1;
		this.set(CATALOG_GENERATION_KEY, String(next));
		return next;
	}
}

// -----------------------------------------------------------------------------
// Bots
// -----------------------------------------------------------------------------

function rowToBotRecord(row: Record<string, unknown>): BotRecord {
	const createdBy = String(row.created_by);
	return {
		identity: {
			botId: String(row.bot_id) as BotId,
			name: String(row.name),
			role: String(row.role) as BotRecord["identity"]["role"],
			parentBotId: row.parent_bot_id
				? (String(row.parent_bot_id) as BotId)
				: null,
			provenance: {
				createdBy:
					createdBy === "bootstrap" ? "bootstrap" : (createdBy as BotId),
				reason: row.reason ? String(row.reason) : undefined,
			},
			createdAt: Number(row.created_at),
		},
		config: JSON.parse(String(row.config_json)) as BotRecord["config"],
		status: String(row.status) as BotRecord["status"],
		revision: Number(row.revision),
	};
}

export class SqliteBotRepository implements BotRepository {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(botId: BotId): BotRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM bots WHERE bot_id = ?;")
			.get(botId);
		return row ? rowToBotRecord(row) : undefined;
	}

	list(): readonly BotRecord[] {
		return this.database.db
			.prepare("SELECT * FROM bots ORDER BY created_at, bot_id;")
			.all()
			.map(rowToBotRecord);
	}

	save(record: BotRecord): void {
		const existing = this.get(record.identity.botId);
		if (
			existing &&
			(existing.identity.role !== record.identity.role ||
				existing.identity.parentBotId !== record.identity.parentBotId)
		) {
			throw new RoleImmutableError(
				`Bot ${record.identity.botId} cannot change role/parent ` +
					`(${existing.identity.role} -> ${record.identity.role})`,
			);
		}
		this.database.db
			.prepare(
				`INSERT INTO bots (
					bot_id, name, role, parent_bot_id, created_by, reason,
					created_at, config_json, status, revision
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(bot_id) DO UPDATE SET
					name = excluded.name,
					config_json = excluded.config_json,
					status = excluded.status,
					revision = excluded.revision;`,
			)
			.run(
				record.identity.botId,
				record.identity.name,
				record.identity.role,
				record.identity.parentBotId,
				record.identity.provenance.createdBy,
				record.identity.provenance.reason ?? null,
				record.identity.createdAt,
				JSON.stringify(record.config),
				record.status,
				record.revision,
			);
	}
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

function rowToSessionRecord(row: Record<string, unknown>): SessionRecord {
	return {
		sessionId: String(row.session_id) as SessionId,
		botId: String(row.bot_id) as BotId,
		workspace: Object.freeze({ rootPath: String(row.workspace_root) }),
		state: String(row.state) as SessionRecord["state"],
		kind:
			row.kind === "dedicated"
				? "dedicated"
				: ("canonical" as SessionRecord["kind"]),
		createdAt: Number(row.created_at),
		revision: Number(row.revision),
	};
}

export class SqliteSessionRepository implements SessionRepository {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(sessionId: SessionId): SessionRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM sessions WHERE session_id = ?;")
			.get(sessionId);
		return row ? rowToSessionRecord(row) : undefined;
	}

	listByBot(botId: BotId): readonly SessionRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM sessions WHERE bot_id = ? ORDER BY created_at, session_id;",
			)
			.all(botId)
			.map(rowToSessionRecord);
	}

	list(): readonly SessionRecord[] {
		return this.database.db
			.prepare("SELECT * FROM sessions ORDER BY created_at, session_id;")
			.all()
			.map(rowToSessionRecord);
	}

	save(record: SessionRecord): void {
		const existing = this.get(record.sessionId);
		if (existing && existing.workspace.rootPath !== record.workspace.rootPath) {
			throw new WorkspaceImmutableError(
				`Session ${record.sessionId} workspace cannot change`,
			);
		}
		this.database.db
			.prepare(
				`INSERT INTO sessions (
					session_id, bot_id, workspace_root, state, kind, created_at, revision
				) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					state = excluded.state,
					revision = excluded.revision;`,
			)
			.run(
				record.sessionId,
				record.botId,
				record.workspace.rootPath,
				record.state,
				record.kind ?? "canonical",
				record.createdAt,
				record.revision,
			);
	}
}

// -----------------------------------------------------------------------------
// Runs (durable FIFO queue)
// -----------------------------------------------------------------------------

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
	return {
		runId: String(row.run_id) as RunId,
		sessionId: String(row.session_id) as SessionId,
		botId: String(row.bot_id) as BotId,
		state: String(row.state) as RunState,
		input: String(row.input),
		acceptedAt: Number(row.accepted_at),
		startedAt: row.started_at === null ? undefined : Number(row.started_at),
		endedAt: row.ended_at === null ? undefined : Number(row.ended_at),
		outputText: row.output_text === null ? undefined : String(row.output_text),
		error:
			row.error_name === null && row.error_message === null
				? undefined
				: {
						name: String(row.error_name ?? "Error"),
						message: String(row.error_message ?? ""),
					},
	};
}

export class SqliteRunRepository implements RunRepository {
	private readonly database: GatewayDatabase;
	private readonly instanceId: string;

	constructor(database: GatewayDatabase, instanceId: string) {
		this.database = database;
		this.instanceId = instanceId;
	}

	get(runId: RunId): RunRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM runs WHERE run_id = ?;")
			.get(runId);
		return row ? rowToRunRecord(row) : undefined;
	}

	listBySession(sessionId: SessionId): readonly RunRecord[] {
		return this.database.db
			.prepare("SELECT * FROM runs WHERE session_id = ? ORDER BY accepted_seq;")
			.all(sessionId)
			.map(rowToRunRecord);
	}

	/** Queued runs in global FIFO admission order. */
	listQueued(): readonly RunRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM runs WHERE state = 'queued' ORDER BY accepted_seq;",
			)
			.all()
			.map(rowToRunRecord);
	}

	listByState(state: RunState): readonly RunRecord[] {
		return this.database.db
			.prepare("SELECT * FROM runs WHERE state = ? ORDER BY accepted_seq;")
			.all(state)
			.map(rowToRunRecord);
	}

	countByState(state: RunState): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM runs WHERE state = ?;")
			.get(state);
		return Number(row?.n ?? 0);
	}

	countPendingBySession(sessionId: SessionId): number {
		const row = this.database.db
			.prepare(
				"SELECT COUNT(*) AS n FROM runs WHERE session_id = ? AND state IN ('queued', 'running');",
			)
			.get(sessionId);
		return Number(row?.n ?? 0);
	}

	/**
	 * Persist the effective config captured at admission. The snapshot
	 * carries provider/model/prompt settings only — never credentials.
	 * Retries and crash recovery execute against this snapshot, not the
	 * live bot config.
	 */
	saveConfigSnapshot(runId: RunId, config: BotRecord["config"]): void {
		this.database.db
			.prepare("UPDATE runs SET config_json = ? WHERE run_id = ?;")
			.run(JSON.stringify(config), runId);
	}

	getConfigSnapshot(runId: RunId): BotRecord["config"] | undefined {
		const row = this.database.db
			.prepare("SELECT config_json FROM runs WHERE run_id = ?;")
			.get(runId);
		if (!row || row.config_json === null) {
			return undefined;
		}
		return JSON.parse(String(row.config_json)) as BotRecord["config"];
	}

	save(record: RunRecord): void {
		this.database.db
			.prepare(
				`INSERT INTO runs (
					run_id, session_id, bot_id, state, input, accepted_at,
					accepted_seq, instance_id, started_at, ended_at,
					output_text, error_name, error_message
				) VALUES (
					?, ?, ?, ?, ?, ?,
					(SELECT COALESCE(MAX(accepted_seq), 0) + 1 FROM runs),
					?, ?, ?, ?, ?, ?
				)
				ON CONFLICT(run_id) DO UPDATE SET
					state = excluded.state,
					started_at = excluded.started_at,
					ended_at = excluded.ended_at,
					output_text = excluded.output_text,
					error_name = excluded.error_name,
					error_message = excluded.error_message;`,
			)
			.run(
				record.runId,
				record.sessionId,
				record.botId,
				record.state,
				record.input,
				record.acceptedAt,
				this.instanceId,
				record.startedAt ?? null,
				record.endedAt ?? null,
				record.outputText ?? null,
				record.error?.name ?? null,
				record.error?.message ?? null,
			);
	}
}

// -----------------------------------------------------------------------------
// Run attempts
// -----------------------------------------------------------------------------

export interface RunAttemptRecord {
	readonly runId: RunId;
	readonly attempt: number;
	readonly state:
		| "running"
		| "completed"
		| "failed"
		| "aborted"
		| "interrupted";
	readonly instanceId: string;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly error?: { name: string; message: string };
	readonly executionSnapshot?: RunExecutionSnapshot;
}

function rowToAttempt(row: Record<string, unknown>): RunAttemptRecord {
	return {
		runId: String(row.run_id) as RunId,
		attempt: Number(row.attempt),
		state: String(row.state) as RunAttemptRecord["state"],
		instanceId: String(row.instance_id),
		startedAt: Number(row.started_at),
		endedAt: row.ended_at === null ? undefined : Number(row.ended_at),
		executionSnapshot:
			row.execution_snapshot_json == null
				? undefined
				: (JSON.parse(
						String(row.execution_snapshot_json),
					) as RunExecutionSnapshot),
		error:
			row.error_name === null && row.error_message === null
				? undefined
				: {
						name: String(row.error_name ?? "Error"),
						message: String(row.error_message ?? ""),
					},
	};
}

export class RunAttemptStore {
	private readonly database: GatewayDatabase;
	private readonly instanceId: string;

	constructor(database: GatewayDatabase, instanceId: string) {
		this.database = database;
		this.instanceId = instanceId;
	}

	begin(runId: RunId, startedAt: number): RunAttemptRecord {
		const row = this.database.db
			.prepare(
				"SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM run_attempts WHERE run_id = ?;",
			)
			.get(runId);
		const attempt = Number(row?.next ?? 1);
		this.database.db
			.prepare(
				`INSERT INTO run_attempts (run_id, attempt, state, instance_id, started_at)
				VALUES (?, ?, 'running', ?, ?);`,
			)
			.run(runId, attempt, this.instanceId, startedAt);
		return {
			runId,
			attempt,
			state: "running",
			instanceId: this.instanceId,
			startedAt,
		};
	}

	setExecutionSnapshot(
		runId: RunId,
		attempt: number,
		snapshot: RunExecutionSnapshot,
	): void {
		const result = this.database.db
			.prepare(
				"UPDATE run_attempts SET execution_snapshot_json = ? WHERE run_id = ? AND attempt = ? AND execution_snapshot_json IS NULL;",
			)
			.run(JSON.stringify(snapshot), runId, attempt);
		if (result.changes !== 1) {
			throw new Error(
				`Execution snapshot for ${runId} attempt ${attempt} is missing or already immutable`,
			);
		}
	}

	settle(
		runId: RunId,
		attempt: number,
		state: Exclude<RunAttemptRecord["state"], "running">,
		endedAt: number,
		error?: { name: string; message: string },
	): void {
		this.database.db
			.prepare(
				`UPDATE run_attempts
				SET state = ?, ended_at = ?, error_name = ?, error_message = ?
				WHERE run_id = ? AND attempt = ?;`,
			)
			.run(
				state,
				endedAt,
				error?.name ?? null,
				error?.message ?? null,
				runId,
				attempt,
			);
	}

	listByRun(runId: RunId): readonly RunAttemptRecord[] {
		return this.database.db
			.prepare("SELECT * FROM run_attempts WHERE run_id = ? ORDER BY attempt;")
			.all(runId)
			.map(rowToAttempt);
	}

	/** Crash recovery: mark every open attempt interrupted (never resumed). */
	interruptOpenAttempts(endedAt: number): readonly RunAttemptRecord[] {
		const open = this.database.db
			.prepare(
				"SELECT * FROM run_attempts WHERE state = 'running' ORDER BY attempt_id;",
			)
			.all()
			.map(rowToAttempt);
		for (const attempt of open) {
			this.settle(attempt.runId, attempt.attempt, "interrupted", endedAt, {
				name: "GatewayRestart",
				message: "Attempt abandoned by a Gateway restart; not auto-resumed",
			});
		}
		return open;
	}
}

// -----------------------------------------------------------------------------
// Durable idempotency ledger
// -----------------------------------------------------------------------------

export class SqliteIdempotencyLedger {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	begin(
		key: IdempotencyKey,
		method: string,
		params: unknown,
	): IdempotencyBeginOutcome {
		const fingerprint = stableStringify(params ?? null);
		const existing = this.database.db
			.prepare("SELECT * FROM idempotency WHERE key = ?;")
			.get(key);
		if (!existing) {
			this.database.db
				.prepare(
					"INSERT INTO idempotency (key, method, params_fingerprint, created_at) VALUES (?, ?, ?, ?);",
				)
				.run(key, method, fingerprint, Date.now());
			return { kind: "new" };
		}
		if (
			String(existing.method) !== method ||
			String(existing.params_fingerprint) !== fingerprint
		) {
			return {
				kind: "conflict",
				error: createGatewayError(
					"idempotency_conflict",
					`Idempotency key reused with a different ${
						String(existing.method) !== method ? "method" : "params payload"
					} (original: ${existing.method})`,
					{ retryable: false },
				),
			};
		}
		if (existing.response_json === null) {
			return { kind: "pending" };
		}
		return {
			kind: "replay",
			response: JSON.parse(String(existing.response_json)) as GatewayResponse,
		};
	}

	record(key: IdempotencyKey, response: GatewayResponse): void {
		const result = this.database.db
			.prepare("UPDATE idempotency SET response_json = ? WHERE key = ?;")
			.run(JSON.stringify(response), key);
		if (!result.changes) {
			throw new Error(
				"SqliteIdempotencyLedger.record called for a key that never began",
			);
		}
	}

	/**
	 * Release a key after a retryable failure so the client may retry the
	 * same request with the same key (per the wire error contract).
	 */
	forget(key: IdempotencyKey): void {
		this.database.db.prepare("DELETE FROM idempotency WHERE key = ?;").run(key);
	}

	get size(): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM idempotency;")
			.get();
		return Number(row?.n ?? 0);
	}
}

// -----------------------------------------------------------------------------
// Global durable event log
// -----------------------------------------------------------------------------

export type EventLogListener = (event: GatewayEvent) => void;

export class EventLogStore {
	private readonly database: GatewayDatabase;
	private readonly listeners = new Set<EventLogListener>();

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	/**
	 * Append a durable event and return it with its global sequence.
	 * Listener notification is deferred to a microtask so it always runs
	 * after the enclosing (synchronous) transaction has committed.
	 */
	append(
		event: string,
		scope: GatewayEventScope,
		payload: Record<string, unknown> | undefined,
		createdAt: number,
	): GatewayEvent {
		this.database.db
			.prepare(
				`INSERT INTO events (event, bot_id, session_id, run_id, payload_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?);`,
			)
			.run(
				event,
				scope.botId ?? null,
				scope.sessionId ?? null,
				scope.runId ?? null,
				payload === undefined ? null : JSON.stringify(payload),
				createdAt,
			);
		const row = this.database.db
			.prepare("SELECT MAX(sequence) AS sequence FROM events;")
			.get();
		const stored = GatewayEventSchema.parse({
			version: GATEWAY_PROTOCOL_VERSION,
			sequence: Number(row?.sequence ?? 0),
			event,
			scope,
			...(payload === undefined ? {} : { payload }),
		});
		queueMicrotask(() => {
			for (const listener of this.listeners) {
				listener(stored);
			}
		});
		return stored;
	}

	/** Events after `sequence`, oldest first, filtered by scope. */
	listAfter(
		sequence: number,
		scope: GatewayEventScope,
		limit: number,
	): GatewayEvent[] {
		const clauses = ["sequence > ?"];
		const params: unknown[] = [sequence];
		if (scope.botId) {
			clauses.push("bot_id = ?");
			params.push(scope.botId);
		}
		if (scope.sessionId) {
			clauses.push("session_id = ?");
			params.push(scope.sessionId);
		}
		if (scope.runId) {
			clauses.push("run_id = ?");
			params.push(scope.runId);
		}
		params.push(limit);
		return this.database.db
			.prepare(
				`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY sequence LIMIT ?;`,
			)
			.all(...params)
			.map((row) =>
				GatewayEventSchema.parse({
					version: GATEWAY_PROTOCOL_VERSION,
					sequence: Number(row.sequence),
					event: String(row.event),
					scope: {
						...(row.bot_id ? { botId: row.bot_id } : {}),
						...(row.session_id ? { sessionId: row.session_id } : {}),
						...(row.run_id ? { runId: row.run_id } : {}),
					},
					...(row.payload_json === null
						? {}
						: { payload: JSON.parse(String(row.payload_json)) }),
				}),
			);
	}

	lastSequence(): number {
		const row = this.database.db
			.prepare("SELECT MAX(sequence) AS sequence FROM events;")
			.get();
		return Number(row?.sequence ?? 0);
	}

	subscribe(listener: EventLogListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

// -----------------------------------------------------------------------------
// Canonical message history (messages contract: AgentMessage)
// -----------------------------------------------------------------------------

export interface StoredMessage {
	readonly messageSeq: number;
	readonly sessionId: SessionId;
	readonly runId?: RunId;
	readonly message: AgentMessage;
}

/**
 * Global canonical message history. The stored payload is the existing
 * `AgentMessage` messages contract from `@cline/shared`; this store is
 * the storage adapter behind it.
 */
export class MessageHistoryStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	append(
		sessionId: SessionId,
		runId: RunId | undefined,
		message: AgentMessage,
	): void {
		this.database.db
			.prepare(
				`INSERT INTO messages (session_id, run_id, message_id, role, message_json, created_at)
				VALUES (?, ?, ?, ?, ?, ?);`,
			)
			.run(
				sessionId,
				runId ?? null,
				message.id,
				message.role,
				JSON.stringify(message),
				message.createdAt,
			);
	}

	listBySession(sessionId: SessionId): readonly StoredMessage[] {
		return this.database.db
			.prepare(
				"SELECT * FROM messages WHERE session_id = ? ORDER BY message_seq;",
			)
			.all(sessionId)
			.map((row) => ({
				messageSeq: Number(row.message_seq),
				sessionId: String(row.session_id) as SessionId,
				runId: row.run_id === null ? undefined : (String(row.run_id) as RunId),
				message: JSON.parse(String(row.message_json)) as AgentMessage,
			}));
	}

	countBySession(sessionId: SessionId): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?;")
			.get(sessionId);
		return Number(row?.n ?? 0);
	}
}

// -----------------------------------------------------------------------------
// Outbox (DB-authoritative file projections)
// -----------------------------------------------------------------------------

export interface OutboxEntry {
	readonly outboxId: number;
	readonly kind: string;
	readonly payload: Record<string, unknown>;
	readonly state: "pending" | "done";
	readonly attempts: number;
	readonly lastError?: string;
}

function rowToOutboxEntry(row: Record<string, unknown>): OutboxEntry {
	return {
		outboxId: Number(row.outbox_id),
		kind: String(row.kind),
		payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
		state: String(row.state) as OutboxEntry["state"],
		attempts: Number(row.attempts),
		lastError: row.last_error === null ? undefined : String(row.last_error),
	};
}

export class OutboxStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	/** Enqueue inside the same transaction as the state change it projects. */
	enqueue(kind: string, payload: Record<string, unknown>, now: number): void {
		this.database.db
			.prepare(
				"INSERT INTO outbox (kind, payload_json, created_at) VALUES (?, ?, ?);",
			)
			.run(kind, JSON.stringify(payload), now);
	}

	listPending(limit: number): readonly OutboxEntry[] {
		return this.database.db
			.prepare(
				"SELECT * FROM outbox WHERE state = 'pending' ORDER BY outbox_id LIMIT ?;",
			)
			.all(limit)
			.map(rowToOutboxEntry);
	}

	markDone(outboxId: number, now: number): void {
		this.database.db
			.prepare(
				"UPDATE outbox SET state = 'done', done_at = ?, attempts = attempts + 1, last_error = NULL WHERE outbox_id = ?;",
			)
			.run(now, outboxId);
	}

	markFailed(outboxId: number, error: string): void {
		this.database.db
			.prepare(
				"UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE outbox_id = ?;",
			)
			.run(error, outboxId);
	}

	countPending(): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM outbox WHERE state = 'pending';")
			.get();
		return Number(row?.n ?? 0);
	}
}

// -----------------------------------------------------------------------------
// Audit trail
// -----------------------------------------------------------------------------

export interface AuditEntry {
	readonly auditId: number;
	readonly at: number;
	readonly actor: string;
	readonly action: string;
	readonly subject?: string;
	readonly details?: Record<string, unknown>;
}

export class AuditLog {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	record(
		actor: string,
		action: string,
		subject?: string,
		details?: Record<string, unknown>,
		at: number = Date.now(),
	): void {
		this.database.db
			.prepare(
				"INSERT INTO audit (at, actor, action, subject, details_json) VALUES (?, ?, ?, ?, ?);",
			)
			.run(
				at,
				actor,
				action,
				subject ?? null,
				details === undefined ? null : JSON.stringify(details),
			);
	}

	list(limit = 100): readonly AuditEntry[] {
		return this.database.db
			.prepare("SELECT * FROM audit ORDER BY audit_id DESC LIMIT ?;")
			.all(limit)
			.map((row) => ({
				auditId: Number(row.audit_id),
				at: Number(row.at),
				actor: String(row.actor),
				action: String(row.action),
				subject: row.subject === null ? undefined : String(row.subject),
				details:
					row.details_json === null
						? undefined
						: (JSON.parse(String(row.details_json)) as Record<string, unknown>),
			}));
	}
}

// -----------------------------------------------------------------------------
// Client registry
// -----------------------------------------------------------------------------

export interface ClientRecord {
	readonly clientId: ClientId;
	readonly name: string;
	readonly version: string;
	readonly firstSeenAt: number;
	readonly lastSeenAt: number;
	readonly connections: number;
}

export class ClientRegistryStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	registerHello(
		clientId: ClientId,
		name: string,
		version: string,
		now: number,
	): ClientRecord {
		this.database.db
			.prepare(
				`INSERT INTO clients (client_id, name, version, first_seen_at, last_seen_at, connections)
				VALUES (?, ?, ?, ?, ?, 1)
				ON CONFLICT(client_id) DO UPDATE SET
					name = excluded.name,
					version = excluded.version,
					last_seen_at = excluded.last_seen_at,
					connections = clients.connections + 1;`,
			)
			.run(clientId, name, version, now, now);
		const record = this.get(clientId);
		if (!record) {
			throw new Error(`Client registry lost ${clientId} during registration`);
		}
		return record;
	}

	get(clientId: ClientId): ClientRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM clients WHERE client_id = ?;")
			.get(clientId);
		if (!row) {
			return undefined;
		}
		return {
			clientId: String(row.client_id) as ClientId,
			name: String(row.name),
			version: String(row.version),
			firstSeenAt: Number(row.first_seen_at),
			lastSeenAt: Number(row.last_seen_at),
			connections: Number(row.connections),
		};
	}

	count(): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM clients;")
			.get();
		return Number(row?.n ?? 0);
	}
}

// -----------------------------------------------------------------------------
// Bundle
// -----------------------------------------------------------------------------

export interface GatewayStores {
	readonly meta: MetaStore;
	readonly bots: SqliteBotRepository;
	readonly sessions: SqliteSessionRepository;
	readonly runs: SqliteRunRepository;
	readonly attempts: RunAttemptStore;
	readonly idempotency: SqliteIdempotencyLedger;
	readonly events: EventLogStore;
	readonly messages: MessageHistoryStore;
	readonly outbox: OutboxStore;
	readonly audit: AuditLog;
	readonly clients: ClientRegistryStore;
	readonly usage: UsageStore;
	/** Phase 4: durable plugin state behind the Gateway storage port. */
	readonly pluginState: PluginStateStore;
	/** Phase 6: bot-scoped connectors and their routes/cursors/instances. */
	readonly connectors: ConnectorStore;
	readonly connectorRoutes: SqliteConnectorRouteStore;
	readonly connectorCursors: ConnectorCursorStore;
	readonly connectorInstances: ConnectorInstanceStore;
	/** Phase 6: outbound connector messages (persisted before delivery). */
	readonly connectorOutbound: ConnectorOutboundStore;
	/** Phase 6: schedules — triggers, durable claims, reports. */
	readonly schedules: ScheduleStore;
	readonly scheduleJobs: ScheduleJobStore;
	/** Phase 6: explicit run provenance. */
	readonly provenance: RunProvenanceStore;
}

export function createGatewayStores(
	database: GatewayDatabase,
	instanceId: string,
	options: { usage?: UsageStoreOptions } = {},
): GatewayStores {
	return {
		meta: new MetaStore(database),
		bots: new SqliteBotRepository(database),
		sessions: new SqliteSessionRepository(database),
		runs: new SqliteRunRepository(database, instanceId),
		attempts: new RunAttemptStore(database, instanceId),
		idempotency: new SqliteIdempotencyLedger(database),
		events: new EventLogStore(database),
		messages: new MessageHistoryStore(database),
		outbox: new OutboxStore(database),
		audit: new AuditLog(database),
		clients: new ClientRegistryStore(database),
		usage: new UsageStore(database, options.usage),
		pluginState: new PluginStateStore(database),
		connectors: new ConnectorStore(database),
		connectorRoutes: new SqliteConnectorRouteStore(database),
		connectorCursors: new ConnectorCursorStore(database),
		connectorInstances: new ConnectorInstanceStore(database),
		connectorOutbound: new ConnectorOutboundStore(database),
		schedules: new ScheduleStore(database),
		scheduleJobs: new ScheduleJobStore(database),
		provenance: new RunProvenanceStore(database),
	};
}
