import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	asOptionalString,
	asString,
	ensureSessionSchema,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@clinebot/shared/db";
import { resolveDbDataDir } from "@clinebot/shared/storage";
import { getNextCronRun } from "./cron";
import type {
	CreateScheduleInput,
	ListScheduleExecutionsOptions,
	ListSchedulesOptions,
	ScheduleExecutionRecord,
	ScheduleExecutionStats,
	ScheduleExecutionStatus,
	ScheduleMode,
	ScheduleRecord,
	UpdateScheduleInput,
} from "./types";

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
		// Ignore malformed persisted metadata.
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

function normalizeMode(value: string | undefined): ScheduleMode {
	return value === "plan" ? "plan" : "act";
}

function normalizeStatus(value: string | undefined): ScheduleExecutionStatus {
	if (
		value === "pending" ||
		value === "running" ||
		value === "success" ||
		value === "failed" ||
		value === "timeout" ||
		value === "aborted"
	) {
		return value;
	}
	return "failed";
}

export interface ScheduleStoreOptions {
	sessionsDbPath?: string;
}

export interface ScheduleClaimRecord {
	schedule: ScheduleRecord;
	claimToken: string;
	triggeredAt: string;
	leaseUntilAt: string;
}

export class ScheduleStore {
	private readonly db: SqliteDb;

	constructor(options: ScheduleStoreOptions = {}) {
		const path = options.sessionsDbPath ?? defaultSessionsDbPath();
		this.db = loadSqliteDb(path);
		ensureSessionSchema(this.db, { includeLegacyMigrations: true });
	}

	public createSchedule(input: CreateScheduleInput): ScheduleRecord {
		const now = nowIso();
		const scheduleId = `sched_${randomUUID()}`;
		const cronPattern = input.cronPattern.trim();
		const nextRunAt =
			input.enabled === false
				? undefined
				: getNextCronRun(cronPattern, new Date());
		const record: ScheduleRecord = {
			scheduleId,
			name: input.name.trim(),
			cronPattern,
			prompt: input.prompt,
			provider: input.provider.trim(),
			model: input.model.trim(),
			mode: input.mode === "plan" ? "plan" : "act",
			workspaceRoot: input.workspaceRoot?.trim() || undefined,
			cwd: input.cwd?.trim() || undefined,
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
			enabled: input.enabled !== false,
			createdAt: now,
			updatedAt: now,
			lastRunAt: undefined,
			nextRunAt,
			createdBy: input.createdBy?.trim() || undefined,
			tags: input.tags?.filter((tag) => tag.trim().length > 0),
			metadata: input.metadata,
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
				record.provider,
				record.model,
				record.mode,
				record.workspaceRoot ?? null,
				record.cwd ?? null,
				record.systemPrompt ?? null,
				record.maxIterations ?? null,
				record.timeoutSeconds ?? null,
				record.maxParallel,
				record.enabled ? 1 : 0,
				record.createdAt,
				record.updatedAt,
				record.lastRunAt ?? null,
				record.nextRunAt ?? null,
				null,
				null,
				null,
				record.createdBy ?? null,
				record.tags ? JSON.stringify(record.tags) : null,
				record.metadata ? JSON.stringify(record.metadata) : null,
			);
		return record;
	}

	public getSchedule(scheduleId: string): ScheduleRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM schedules WHERE schedule_id = ?")
			.get(scheduleId);
		if (!row) {
			return undefined;
		}
		return this.toScheduleRecord(row);
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

	public listDueSchedules(referenceTime: string): ScheduleRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM schedules
				 WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
				 ORDER BY next_run_at ASC`,
			)
			.all(referenceTime);
		return rows.map((row) => this.toScheduleRecord(row));
	}

	public updateSchedule(
		scheduleId: string,
		updates: UpdateScheduleInput,
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
			provider: updates.provider?.trim() ?? current.provider,
			model: updates.model?.trim() ?? current.model,
			mode: updates.mode ?? current.mode,
			workspaceRoot:
				updates.workspaceRoot !== undefined
					? updates.workspaceRoot.trim() || undefined
					: current.workspaceRoot,
			cwd:
				updates.cwd !== undefined
					? updates.cwd.trim() || undefined
					: current.cwd,
			systemPrompt:
				updates.systemPrompt !== undefined
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
			enabled: updates.enabled ?? current.enabled,
			createdBy:
				updates.createdBy === null
					? undefined
					: updates.createdBy !== undefined
						? updates.createdBy.trim() || undefined
						: current.createdBy,
			tags: updates.tags ?? current.tags,
			metadata: updates.metadata ?? current.metadata,
			updatedAt: nowIso(),
		};

		const cronChanged = next.cronPattern !== current.cronPattern;
		const enabledChanged = next.enabled !== current.enabled;
		if (cronChanged || enabledChanged) {
			next.nextRunAt = next.enabled
				? getNextCronRun(next.cronPattern, new Date())
				: undefined;
		}

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
				next.provider,
				next.model,
				next.mode,
				next.workspaceRoot ?? null,
				next.cwd ?? null,
				next.systemPrompt ?? null,
				next.maxIterations ?? null,
				next.timeoutSeconds ?? null,
				next.maxParallel,
				next.enabled ? 1 : 0,
				next.updatedAt,
				next.lastRunAt ?? null,
				next.nextRunAt ?? null,
				next.createdBy ?? null,
				next.tags ? JSON.stringify(next.tags) : null,
				next.metadata ? JSON.stringify(next.metadata) : null,
				next.scheduleId,
			);
		return next;
	}

	public markScheduleTriggered(scheduleId: string, triggeredAt: string): void {
		const schedule = this.getSchedule(scheduleId);
		if (!schedule) {
			return;
		}
		const nextRunAt = schedule.enabled
			? getNextCronRun(schedule.cronPattern, new Date(triggeredAt))
			: undefined;
		this.db
			.prepare(
				"UPDATE schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE schedule_id = ?",
			)
			.run(triggeredAt, nextRunAt ?? null, nowIso(), scheduleId);
	}

	public claimDueSchedules(
		referenceTime: string,
		leaseDurationMs: number,
		limit = 50,
	): ScheduleClaimRecord[] {
		const claimed: ScheduleClaimRecord[] = [];
		const boundedLimit = Math.max(1, Math.floor(limit));
		const boundedLeaseMs = Math.max(1_000, Math.floor(leaseDurationMs));
		const leaseUntilAt = new Date(
			new Date(referenceTime).getTime() + boundedLeaseMs,
		).toISOString();
		const claimedAt = nowIso();
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
				.all(referenceTime, referenceTime, boundedLimit);
			for (const row of rows) {
				const scheduleId = asString(row.schedule_id);
				const triggeredAt = asString(row.next_run_at);
				if (!scheduleId || !triggeredAt) {
					continue;
				}
				const claimToken = `claim_${randomUUID()}`;
				const changes =
					claimStatement.run(
						claimToken,
						claimedAt,
						leaseUntilAt,
						claimedAt,
						scheduleId,
						triggeredAt,
						referenceTime,
					).changes ?? 0;
				if (changes !== 1) {
					continue;
				}
				claimed.push({
					schedule: this.toScheduleRecord(row),
					claimToken,
					triggeredAt,
					leaseUntilAt,
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
		const updatedAt = nowIso();
		const changes =
			this.db
				.prepare(
					`UPDATE schedules
						SET claim_until_at = ?, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(leaseUntilAt, updatedAt, scheduleId, claimToken).changes ?? 0;
		return changes === 1;
	}

	public releaseScheduleClaim(scheduleId: string, claimToken: string): boolean {
		const updatedAt = nowIso();
		const changes =
			this.db
				.prepare(
					`UPDATE schedules
						SET claim_token = NULL, claim_started_at = NULL, claim_until_at = NULL, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(updatedAt, scheduleId, claimToken).changes ?? 0;
		return changes === 1;
	}

	public completeScheduleClaim(
		scheduleId: string,
		claimToken: string,
		triggeredAt: string,
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
		const cronPattern = asString(row.cron_pattern);
		const enabled = Number(row.enabled ?? 0) === 1;
		const nextRunAt =
			enabled && cronPattern
				? getNextCronRun(cronPattern, new Date(triggeredAt))
				: undefined;
		const updatedAt = nowIso();
		const changes =
			this.db
				.prepare(
					`UPDATE schedules SET
						last_run_at = ?, next_run_at = ?, claim_token = NULL, claim_started_at = NULL, claim_until_at = NULL, updated_at = ?
						WHERE schedule_id = ? AND claim_token = ?`,
				)
				.run(triggeredAt, nextRunAt ?? null, updatedAt, scheduleId, claimToken)
				.changes ?? 0;
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
				execution.sessionId ?? null,
				execution.triggeredAt,
				execution.startedAt ?? null,
				execution.endedAt ?? null,
				execution.status,
				execution.exitCode ?? null,
				execution.errorMessage ?? null,
				execution.iterations ?? null,
				execution.tokensUsed ?? null,
				execution.costUsd ?? null,
			);
	}

	public getExecution(
		executionId: string,
	): ScheduleExecutionRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM schedule_executions WHERE execution_id = ?")
			.get(executionId);
		if (!row) {
			return undefined;
		}
		return this.toScheduleExecutionRecord(row);
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
			return {
				totalRuns: 0,
				successRate: 0,
				avgDurationSeconds: 0,
			};
		}
		let success = 0;
		let withDuration = 0;
		let durationMsTotal = 0;
		let lastFailure: ScheduleExecutionRecord | undefined;
		for (const execution of all) {
			if (execution.status === "success") {
				success += 1;
			}
			if (!lastFailure && execution.status !== "success") {
				lastFailure = execution;
			}
			if (execution.startedAt && execution.endedAt) {
				const durationMs =
					new Date(execution.endedAt).getTime() -
					new Date(execution.startedAt).getTime();
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
		return {
			scheduleId: asString(row.schedule_id),
			name: asString(row.name),
			cronPattern: asString(row.cron_pattern),
			prompt: asString(row.prompt),
			provider: asString(row.provider),
			model: asString(row.model),
			mode: normalizeMode(asOptionalString(row.mode)),
			workspaceRoot: asOptionalString(row.workspace_root),
			cwd: asOptionalString(row.cwd),
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
			enabled: Number(row.enabled ?? 0) === 1,
			createdAt: asString(row.created_at),
			updatedAt: asString(row.updated_at),
			lastRunAt: asOptionalString(row.last_run_at),
			nextRunAt: asOptionalString(row.next_run_at),
			createdBy: asOptionalString(row.created_by),
			tags: parseJsonArray(asOptionalString(row.tags)),
			metadata: parseJsonObject(asOptionalString(row.metadata_json)),
		};
	}

	private toScheduleExecutionRecord(
		row: Record<string, unknown>,
	): ScheduleExecutionRecord {
		return {
			executionId: asString(row.execution_id),
			scheduleId: asString(row.schedule_id),
			sessionId: asOptionalString(row.session_id),
			triggeredAt: asString(row.triggered_at),
			startedAt: asOptionalString(row.started_at),
			endedAt: asOptionalString(row.ended_at),
			status: normalizeStatus(asOptionalString(row.status)),
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
