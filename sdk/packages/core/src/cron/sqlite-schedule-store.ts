import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
	ScheduleExecutionRecord,
	ScheduleExecutionStatus,
	ScheduleRecord,
} from "@clinebot/shared";
import {
	asOptionalString,
	asString,
	ensureSessionSchema,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@clinebot/shared/db";
import { resolveDbDataDir } from "@clinebot/shared/storage";
import { getNextCronTime } from "./scheduler";

function defaultSessionsDbPath(): string {
	return join(resolveDbDataDir(), "sessions.db");
}

function parseJsonObject(
	value: string | undefined,
): Record<string, unknown> | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Ignore malformed persisted JSON.
	}
	return undefined;
}

function parseJsonArray(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const tags = parsed
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
		return tags.length > 0 ? tags : undefined;
	} catch {
		return undefined;
	}
}

function normalizeExecutionStatus(
	value: string | undefined,
): ScheduleExecutionStatus {
	if (
		value === "pending" ||
		value === "running" ||
		value === "success" ||
		value === "completed" ||
		value === "failed" ||
		value === "timeout" ||
		value === "aborted"
	) {
		return value;
	}
	return "failed";
}

export interface HubScheduleStoreOptions {
	sessionsDbPath?: string;
}

export interface ScheduleClaimRecord {
	schedule: ScheduleRecord;
	claimToken: string;
	triggeredAt: number;
	leaseUntilAt: number;
}

export interface ListSchedulesOptions {
	enabled?: boolean;
	limit?: number;
	tags?: string[];
}

export interface ListScheduleExecutionsOptions {
	scheduleId?: string;
	status?: ScheduleExecutionStatus;
	limit?: number;
}

export interface ScheduleExecutionStats {
	totalRuns: number;
	successRate: number;
	avgDurationSeconds: number;
	lastFailure?: ScheduleExecutionRecord;
}

export class SqliteHubScheduleStore {
	private readonly db: SqliteDb;

	constructor(options: HubScheduleStoreOptions = {}) {
		const path = options.sessionsDbPath ?? defaultSessionsDbPath();
		this.db = loadSqliteDb(path);
		ensureSessionSchema(this.db, { includeLegacyMigrations: true });
	}

	public close(): void {
		this.db.close?.();
	}

	public createSchedule(input: HubScheduleCreateInput): ScheduleRecord {
		const now = nowIso();
		const scheduleId = `sched_${randomUUID()}`;
		const cronPattern = input.cronPattern.trim();
		const nextRunAt =
			input.enabled === false
				? undefined
				: getNextCronTime(cronPattern, Date.now());
		const record: ScheduleRecord = {
			scheduleId,
			name: input.name.trim(),
			cronPattern,
			prompt: input.prompt,
			workspaceRoot: input.workspaceRoot.trim(),
			cwd: input.cwd?.trim() || undefined,
			modelSelection: input.modelSelection
				? JSON.parse(JSON.stringify(input.modelSelection))
				: undefined,
			enabled: input.enabled !== false,
			mode: input.mode ?? "act",
			systemPrompt: input.systemPrompt,
			maxIterations:
				typeof input.maxIterations === "number"
					? Math.floor(input.maxIterations)
					: undefined,
			timeoutSeconds:
				typeof input.timeoutSeconds === "number"
					? Math.floor(input.timeoutSeconds)
					: undefined,
			maxParallel:
				typeof input.maxParallel === "number"
					? Math.max(1, Math.floor(input.maxParallel))
					: 1,
			createdAt: new Date(now).getTime(),
			updatedAt: new Date(now).getTime(),
			lastRunAt: undefined,
			nextRunAt,
			createdBy: input.createdBy?.trim() || undefined,
			tags: input.tags?.filter((tag) => tag.trim().length > 0),
			runtimeOptions: input.runtimeOptions
				? JSON.parse(JSON.stringify(input.runtimeOptions))
				: undefined,
			metadata: input.metadata
				? JSON.parse(JSON.stringify(input.metadata))
				: undefined,
		};
		this.db
			.prepare(
				`INSERT INTO schedules (
					schedule_id, name, cron_pattern, prompt,
					provider, model, mode, workspace_root, cwd, system_prompt,
					max_iterations, timeout_seconds, max_parallel,
					enabled, created_at, updated_at, last_run_at, next_run_at,
					claim_token, claim_started_at, claim_until_at,
					created_by, tags, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.scheduleId,
				record.name,
				record.cronPattern,
				record.prompt,
				record.modelSelection?.providerId ?? "",
				record.modelSelection?.modelId ?? "",
				record.mode ?? "act",
				record.workspaceRoot,
				record.cwd ?? null,
				record.systemPrompt ?? null,
				record.maxIterations ?? null,
				record.timeoutSeconds ?? null,
				record.maxParallel ?? 1,
				record.enabled ? 1 : 0,
				now,
				now,
				null,
				record.nextRunAt ? new Date(record.nextRunAt).toISOString() : null,
				null,
				null,
				null,
				record.createdBy ?? null,
				record.tags ? JSON.stringify(record.tags) : null,
				JSON.stringify({
					...(record.metadata ?? {}),
					...(record.runtimeOptions
						? { __hubRuntimeOptions: record.runtimeOptions }
						: {}),
				}),
			);
		return record;
	}

	public getSchedule(scheduleId: string): ScheduleRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM schedules WHERE schedule_id = ?")
			.get(scheduleId);
		return row ? this.toScheduleRecord(row) : undefined;
	}

	public listSchedules(options: ListSchedulesOptions = {}): ScheduleRecord[] {
		const whereClauses: string[] = [];
		const params: unknown[] = [];
		if (typeof options.enabled === "boolean") {
			whereClauses.push("enabled = ?");
			params.push(options.enabled ? 1 : 0);
		}
		if (options.tags && options.tags.length > 0) {
			for (const tag of options.tags) {
				whereClauses.push("tags LIKE ?");
				params.push(`%"${tag.trim()}"%`);
			}
		}
		const where =
			whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
		const limit =
			typeof options.limit === "number" && options.limit > 0
				? Math.floor(options.limit)
				: 200;
		const rows = this.db
			.prepare(
				`SELECT * FROM schedules ${where} ORDER BY created_at DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => this.toScheduleRecord(row));
	}

	public updateSchedule(
		scheduleId: string,
		updates: HubScheduleUpdateInput,
	): ScheduleRecord | undefined {
		const current = this.getSchedule(scheduleId);
		if (!current) {
			return undefined;
		}
		const next: ScheduleRecord = {
			...current,
			name: updates.name?.trim() ?? current.name,
			cronPattern: updates.cronPattern?.trim() ?? current.cronPattern,
			prompt: updates.prompt ?? current.prompt,
			workspaceRoot:
				updates.workspaceRoot !== undefined
					? updates.workspaceRoot.trim()
					: current.workspaceRoot,
			cwd:
				updates.cwd !== undefined
					? updates.cwd.trim() || undefined
					: current.cwd,
			modelSelection:
				updates.modelSelection !== undefined
					? JSON.parse(JSON.stringify(updates.modelSelection))
					: current.modelSelection,
			enabled: updates.enabled ?? current.enabled,
			mode: updates.mode ?? current.mode,
			systemPrompt:
				updates.systemPrompt === null
					? undefined
					: updates.systemPrompt !== undefined
						? updates.systemPrompt
						: current.systemPrompt,
			maxIterations:
				updates.maxIterations === null
					? undefined
					: updates.maxIterations !== undefined
						? Math.floor(updates.maxIterations)
						: current.maxIterations,
			timeoutSeconds:
				updates.timeoutSeconds === null
					? undefined
					: updates.timeoutSeconds !== undefined
						? Math.floor(updates.timeoutSeconds)
						: current.timeoutSeconds,
			maxParallel:
				updates.maxParallel !== undefined
					? Math.max(1, Math.floor(updates.maxParallel))
					: current.maxParallel,
			updatedAt: Date.now(),
			createdBy:
				updates.createdBy === null
					? undefined
					: updates.createdBy !== undefined
						? updates.createdBy.trim() || undefined
						: current.createdBy,
			tags: updates.tags ?? current.tags,
			runtimeOptions:
				updates.runtimeOptions !== undefined
					? JSON.parse(JSON.stringify(updates.runtimeOptions))
					: current.runtimeOptions,
			metadata:
				updates.metadata !== undefined
					? JSON.parse(JSON.stringify(updates.metadata))
					: current.metadata,
		};

		const cronChanged = next.cronPattern !== current.cronPattern;
		const enabledChanged = next.enabled !== current.enabled;
		if (cronChanged || enabledChanged) {
			next.nextRunAt = next.enabled
				? getNextCronTime(next.cronPattern, Date.now())
				: undefined;
		}

		const updatedAtIso = new Date(next.updatedAt).toISOString();
		this.db
			.prepare(
				`UPDATE schedules SET
					name = ?, cron_pattern = ?, prompt = ?,
					provider = ?, model = ?, mode = ?, workspace_root = ?, cwd = ?, system_prompt = ?,
					max_iterations = ?, timeout_seconds = ?, max_parallel = ?,
					enabled = ?, updated_at = ?, last_run_at = ?, next_run_at = ?,
					created_by = ?, tags = ?, metadata_json = ?
				 WHERE schedule_id = ?`,
			)
			.run(
				next.name,
				next.cronPattern,
				next.prompt,
				next.modelSelection?.providerId ?? "",
				next.modelSelection?.modelId ?? "",
				next.mode ?? "act",
				next.workspaceRoot,
				next.cwd ?? null,
				next.systemPrompt ?? null,
				next.maxIterations ?? null,
				next.timeoutSeconds ?? null,
				next.maxParallel ?? 1,
				next.enabled ? 1 : 0,
				updatedAtIso,
				next.lastRunAt ? new Date(next.lastRunAt).toISOString() : null,
				next.nextRunAt ? new Date(next.nextRunAt).toISOString() : null,
				next.createdBy ?? null,
				next.tags ? JSON.stringify(next.tags) : null,
				JSON.stringify({
					...(next.metadata ?? {}),
					...(next.runtimeOptions
						? { __hubRuntimeOptions: next.runtimeOptions }
						: {}),
				}),
				next.scheduleId,
			);
		return next;
	}

	public claimDueSchedules(
		referenceTimeIso: string,
		leaseDurationMs: number,
		limit = 50,
	): ScheduleClaimRecord[] {
		const claimed: ScheduleClaimRecord[] = [];
		const boundedLimit = Math.max(1, Math.floor(limit));
		const boundedLeaseMs = Math.max(1_000, Math.floor(leaseDurationMs));
		const leaseUntilIso = new Date(
			new Date(referenceTimeIso).getTime() + boundedLeaseMs,
		).toISOString();
		const dueRowsSql = `SELECT * FROM schedules
			WHERE enabled = 1
				AND next_run_at IS NOT NULL
				AND next_run_at <= ?
				AND (claim_until_at IS NULL OR claim_until_at <= ?)
			ORDER BY next_run_at ASC
			LIMIT ?`;
		const claimSql = `UPDATE schedules SET
			claim_token = ?, claim_started_at = ?, claim_until_at = ?, updated_at = ?
			WHERE schedule_id = ?
				AND enabled = 1
				AND next_run_at = ?
				AND (claim_until_at IS NULL OR claim_until_at <= ?)`;
		const claimStatement = this.db.prepare(claimSql);
		this.db.exec("BEGIN IMMEDIATE;");
		try {
			const rows = this.db
				.prepare(dueRowsSql)
				.all(referenceTimeIso, referenceTimeIso, boundedLimit);
			for (const row of rows) {
				const scheduleId = asString(row.schedule_id);
				const triggeredAtIso = asString(row.next_run_at);
				if (!scheduleId || !triggeredAtIso) {
					continue;
				}
				const claimToken = `claim_${randomUUID()}`;
				const changes =
					claimStatement.run(
						claimToken,
						referenceTimeIso,
						leaseUntilIso,
						referenceTimeIso,
						scheduleId,
						triggeredAtIso,
						referenceTimeIso,
					).changes ?? 0;
				if (changes !== 1) {
					continue;
				}
				claimed.push({
					schedule: this.toScheduleRecord(row),
					claimToken,
					triggeredAt: new Date(triggeredAtIso).getTime(),
					leaseUntilAt: new Date(leaseUntilIso).getTime(),
				});
			}
			this.db.exec("COMMIT;");
			return claimed;
		} catch (error) {
			this.db.exec("ROLLBACK;");
			throw error;
		}
	}

	public renewScheduleClaim(
		scheduleId: string,
		claimToken: string,
		leaseUntilAt: string,
	): boolean {
		const changes =
			this.db
				.prepare(
					`UPDATE schedules
						SET claim_until_at = ?, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(leaseUntilAt, nowIso(), scheduleId, claimToken).changes ?? 0;
		return changes === 1;
	}

	public completeScheduleClaim(
		scheduleId: string,
		claimToken: string,
		triggeredAtIso: string,
	): boolean {
		const row = this.db
			.prepare(
				`SELECT cron_pattern, enabled
					FROM schedules
					WHERE schedule_id = ? AND claim_token = ?`,
			)
			.get(scheduleId, claimToken);
		if (!row) {
			return false;
		}
		const nextRunAt =
			Number(row.enabled ?? 0) === 1
				? new Date(
						getNextCronTime(
							asString(row.cron_pattern),
							new Date(triggeredAtIso).getTime(),
						),
					).toISOString()
				: undefined;
		const changes =
			this.db
				.prepare(
					`UPDATE schedules SET
						last_run_at = ?, next_run_at = ?, claim_token = NULL, claim_started_at = NULL, claim_until_at = NULL, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(
					triggeredAtIso,
					nextRunAt ?? null,
					nowIso(),
					scheduleId,
					claimToken,
				).changes ?? 0;
		return changes === 1;
	}

	public releaseScheduleClaim(scheduleId: string, claimToken: string): boolean {
		const changes =
			this.db
				.prepare(
					`UPDATE schedules
						SET claim_token = NULL, claim_started_at = NULL, claim_until_at = NULL, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(nowIso(), scheduleId, claimToken).changes ?? 0;
		return changes === 1;
	}

	public deleteSchedule(scheduleId: string): boolean {
		const changes =
			this.db
				.prepare("DELETE FROM schedules WHERE schedule_id = ?")
				.run(scheduleId).changes ?? 0;
		return changes > 0;
	}

	public recordExecution(execution: ScheduleExecutionRecord): void {
		const persistedSessionId =
			execution.sessionId && this.sessionExists(execution.sessionId)
				? execution.sessionId
				: null;
		this.db
			.prepare(
				`INSERT OR REPLACE INTO schedule_executions (
					execution_id, schedule_id, session_id,
					triggered_at, started_at, ended_at, status,
					exit_code, error_message, iterations, tokens_used, cost_usd
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				execution.executionId,
				execution.scheduleId,
				persistedSessionId,
				new Date(execution.triggeredAt).toISOString(),
				execution.startedAt
					? new Date(execution.startedAt).toISOString()
					: null,
				execution.endedAt ? new Date(execution.endedAt).toISOString() : null,
				execution.status,
				execution.exitCode ?? null,
				execution.errorMessage ?? null,
				execution.iterations ?? null,
				execution.tokensUsed ?? null,
				execution.costUsd ?? null,
			);
	}

	private sessionExists(sessionId: string): boolean {
		const row = this.db
			.prepare("SELECT session_id FROM sessions WHERE session_id = ?")
			.get(sessionId);
		return !!row;
	}

	public listExecutions(
		options: ListScheduleExecutionsOptions,
	): ScheduleExecutionRecord[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.scheduleId) {
			where.push("schedule_id = ?");
			params.push(options.scheduleId);
		}
		if (options.status) {
			where.push("status = ?");
			params.push(options.status);
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit =
			typeof options.limit === "number" && options.limit > 0
				? Math.floor(options.limit)
				: 50;
		const rows = this.db
			.prepare(
				`SELECT * FROM schedule_executions ${whereClause}
				 ORDER BY triggered_at DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => this.toScheduleExecutionRecord(row));
	}

	public getExecutionStats(scheduleId: string): ScheduleExecutionStats {
		const all = this.listExecutions({ scheduleId, limit: 10_000 });
		if (all.length === 0) {
			return { totalRuns: 0, successRate: 0, avgDurationSeconds: 0 };
		}
		let success = 0;
		let withDuration = 0;
		let durationMsTotal = 0;
		let lastFailure: ScheduleExecutionRecord | undefined;
		for (const execution of all) {
			if (execution.status === "success" || execution.status === "completed") {
				success += 1;
			}
			if (
				!lastFailure &&
				execution.status !== "success" &&
				execution.status !== "completed"
			) {
				lastFailure = execution;
			}
			if (execution.startedAt && execution.endedAt) {
				const durationMs = execution.endedAt - execution.startedAt;
				if (Number.isFinite(durationMs) && durationMs >= 0) {
					durationMsTotal += durationMs;
					withDuration += 1;
				}
			}
		}
		return {
			totalRuns: all.length,
			successRate: success / all.length,
			avgDurationSeconds:
				withDuration > 0 ? durationMsTotal / withDuration / 1000 : 0,
			lastFailure,
		};
	}

	public listUpcomingRuns(limit = 20): Array<{
		scheduleId: string;
		name: string;
		nextRunAt: string;
	}> {
		const rows = this.db
			.prepare(
				`SELECT schedule_id, name, next_run_at FROM schedules
				 WHERE enabled = 1 AND next_run_at IS NOT NULL
				 ORDER BY next_run_at ASC LIMIT ?`,
			)
			.all(Math.max(1, Math.floor(limit)));
		return rows
			.map((row) => ({
				scheduleId: asString(row.schedule_id),
				name: asString(row.name),
				nextRunAt: asString(row.next_run_at),
			}))
			.filter((item) => item.scheduleId && item.nextRunAt);
	}

	private toScheduleRecord(row: Record<string, unknown>): ScheduleRecord {
		const metadata = parseJsonObject(asOptionalString(row.metadata_json));
		const runtimeOptions =
			metadata?.__hubRuntimeOptions &&
			typeof metadata.__hubRuntimeOptions === "object" &&
			!Array.isArray(metadata.__hubRuntimeOptions)
				? (metadata.__hubRuntimeOptions as ScheduleRecord["runtimeOptions"])
				: undefined;
		if (metadata && "__hubRuntimeOptions" in metadata) {
			delete metadata.__hubRuntimeOptions;
		}
		return {
			scheduleId: asString(row.schedule_id),
			name: asString(row.name),
			cronPattern: asString(row.cron_pattern),
			prompt: asString(row.prompt),
			workspaceRoot: asString(row.workspace_root),
			cwd: asOptionalString(row.cwd),
			modelSelection:
				asOptionalString(row.provider) || asOptionalString(row.model)
					? {
							providerId: asOptionalString(row.provider) ?? "",
							modelId: asOptionalString(row.model) ?? "",
						}
					: undefined,
			enabled: Number(row.enabled ?? 0) === 1,
			mode:
				asOptionalString(row.mode) === "plan"
					? "plan"
					: asOptionalString(row.mode) === "yolo"
						? "yolo"
						: "act",
			systemPrompt: asOptionalString(row.system_prompt),
			maxIterations:
				typeof row.max_iterations === "number" ? row.max_iterations : undefined,
			timeoutSeconds:
				typeof row.timeout_seconds === "number"
					? row.timeout_seconds
					: undefined,
			maxParallel:
				typeof row.max_parallel === "number" && row.max_parallel > 0
					? row.max_parallel
					: 1,
			createdAt: new Date(asString(row.created_at)).getTime(),
			updatedAt: new Date(asString(row.updated_at)).getTime(),
			lastRunAt: asOptionalString(row.last_run_at)
				? new Date(asString(row.last_run_at)).getTime()
				: undefined,
			nextRunAt: asOptionalString(row.next_run_at)
				? new Date(asString(row.next_run_at)).getTime()
				: undefined,
			createdBy: asOptionalString(row.created_by),
			tags: parseJsonArray(asOptionalString(row.tags)),
			runtimeOptions,
			metadata: metadata as ScheduleRecord["metadata"],
		};
	}

	private toScheduleExecutionRecord(
		row: Record<string, unknown>,
	): ScheduleExecutionRecord {
		return {
			executionId: asString(row.execution_id),
			scheduleId: asString(row.schedule_id),
			sessionId: asOptionalString(row.session_id),
			triggeredAt: new Date(asString(row.triggered_at)).getTime(),
			startedAt: asOptionalString(row.started_at)
				? new Date(asString(row.started_at)).getTime()
				: undefined,
			endedAt: asOptionalString(row.ended_at)
				? new Date(asString(row.ended_at)).getTime()
				: undefined,
			status: normalizeExecutionStatus(asOptionalString(row.status)),
			exitCode: typeof row.exit_code === "number" ? row.exit_code : undefined,
			errorMessage: asOptionalString(row.error_message),
			iterations:
				typeof row.iterations === "number" ? row.iterations : undefined,
			tokensUsed:
				typeof row.tokens_used === "number" ? row.tokens_used : undefined,
			costUsd: typeof row.cost_usd === "number" ? row.cost_usd : undefined,
		};
	}
}
