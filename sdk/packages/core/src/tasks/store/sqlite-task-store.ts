import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskRunStatus,
	AgendaTaskStatus,
	AgendaTaskUpdateInput,
	GatewayModelSelection,
} from "@cline/shared";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@cline/shared/db";
import { resolveTasksDbPath } from "@cline/shared/storage";
import { normalizeAgendaTaskLocation } from "../task-location";
import { ensureAgendaTaskSchema } from "./task-schema";

const SYSTEM_ACTOR: AgendaTaskActor = { kind: "system", id: "task_store" };

export interface SqliteAgendaTaskStoreOptions {
	dbPath?: string;
}

export class AgendaTaskRevisionConflictError extends Error {
	constructor(public readonly current: AgendaTaskRecord) {
		super(
			`task ${current.taskId} is at revision ${current.revision}; the requested revision is stale`,
		);
		this.name = "AgendaTaskRevisionConflictError";
	}
}

export interface AgendaTaskStatePatch {
	status?: AgendaTaskStatus;
	approvedRevision?: number | null;
	currentRunId?: string | null;
	lastRunId?: string | null;
	lastSessionId?: string | null;
	specPath?: string | null;
	error?: string | null;
	completedAt?: string | null;
	archivedAt?: string | null;
	updatedBy?: AgendaTaskActor;
}

export interface CreateAgendaTaskRunInput {
	taskId: string;
	taskRevision: number;
	status?: AgendaTaskRunStatus;
	claimToken?: string;
	claimUntilAt?: string;
	requestedByClientId?: string;
	sessionId?: string;
	claimedAt?: string;
}

export interface UpdateAgendaTaskRunInput {
	status?: AgendaTaskRunStatus;
	claimToken?: string | null;
	claimUntilAt?: string | null;
	requestedByClientId?: string | null;
	sessionId?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	resultSummary?: string | null;
	error?: string | null;
}

export interface ListAgendaTaskRunsInput {
	taskId?: string;
	status?: AgendaTaskRunStatus | AgendaTaskRunStatus[];
	sessionId?: string;
	limit?: number;
}

function parseJson<T>(value: unknown): T | undefined {
	if (typeof value !== "string" || !value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

function toInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.floor(value);
	}
	if (typeof value === "bigint") return Number(value);
	return undefined;
}

function taskRowToRecord(row: Record<string, unknown>): AgendaTaskRecord {
	return {
		taskId: asString(row.task_id),
		type: asString(row.type) as AgendaTaskRecord["type"],
		status: asString(row.status) as AgendaTaskStatus,
		title: asString(row.title),
		description: asOptionalString(row.description),
		instructions: asString(row.instructions),
		scope: asString(row.scope) as AgendaTaskRecord["scope"],
		workspaceRoot: asOptionalString(row.workspace_root),
		cwd: asOptionalString(row.cwd),
		resourcePaths:
			parseJson<string[]>(row.resource_paths_json)?.filter(
				(path) => typeof path === "string",
			) ?? [],
		priority: (toInteger(row.priority) ?? 3) as AgendaTaskRecord["priority"],
		assignee: asOptionalString(row.assignee),
		modelSelection: parseJson<GatewayModelSelection>(row.model_selection_json),
		mode: asOptionalString(row.mode) as AgendaTaskRecord["mode"],
		systemPrompt: asOptionalString(row.system_prompt),
		maxIterations: toInteger(row.max_iterations),
		timeoutSeconds: toInteger(row.timeout_seconds),
		availableAt: asString(row.available_at),
		expiresAt: asString(row.expires_at),
		automationEligible: Number(row.automation_eligible ?? 0) === 1,
		revision: toInteger(row.revision) ?? 1,
		approvedRevision: toInteger(row.approved_revision),
		createdBy: parseJson<AgendaTaskActor>(row.created_by_json) ?? SYSTEM_ACTOR,
		updatedBy: parseJson<AgendaTaskActor>(row.updated_by_json) ?? SYSTEM_ACTOR,
		originSessionId: asOptionalString(row.origin_session_id),
		originTaskId: asOptionalString(row.origin_task_id),
		currentRunId: asOptionalString(row.current_run_id),
		lastRunId: asOptionalString(row.last_run_id),
		lastSessionId: asOptionalString(row.last_session_id),
		specPath: asOptionalString(row.spec_path),
		error: asOptionalString(row.error),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
		completedAt: asOptionalString(row.completed_at),
		archivedAt: asOptionalString(row.archived_at),
	};
}

function runRowToRecord(row: Record<string, unknown>): AgendaTaskRunRecord {
	return {
		runId: asString(row.run_id),
		taskId: asString(row.task_id),
		taskRevision: toInteger(row.task_revision) ?? 1,
		attempt: toInteger(row.attempt) ?? 1,
		status: asString(row.status) as AgendaTaskRunStatus,
		claimToken: asOptionalString(row.claim_token),
		claimUntilAt: asOptionalString(row.claim_until_at),
		requestedByClientId: asOptionalString(row.requested_by_client_id),
		sessionId: asOptionalString(row.session_id),
		claimedAt: asString(row.claimed_at),
		startedAt: asOptionalString(row.started_at),
		completedAt: asOptionalString(row.completed_at),
		resultSummary: asOptionalString(row.result_summary),
		error: asOptionalString(row.error),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
	};
}

function policyRowToRecord(
	row: Record<string, unknown>,
): AgendaAutomationPolicy {
	return {
		scopeKey: asString(row.scope_key),
		mode: asString(row.mode) as AgendaAutomationPolicy["mode"],
		applyToAgentCreated: Number(row.apply_to_agent_created ?? 0) === 1,
		maxConcurrentRuns: toInteger(row.max_concurrent_runs) ?? 2,
		maxChainDepth: toInteger(row.max_chain_depth) ?? 1,
		maxStartsPerHour: toInteger(row.max_starts_per_hour) ?? 20,
		enabledBy: parseJson<AgendaTaskActor>(row.enabled_by_json),
		enabledAt: asOptionalString(row.enabled_at),
		updatedAt: asString(row.updated_at),
	};
}

function requiredText(value: string, field: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${field} is required`);
	return trimmed;
}

function optionalText(value: string | undefined | null): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoTimestamp(value: string, field: string): string {
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds)) {
		throw new Error(`${field} must be a valid ISO-8601 timestamp`);
	}
	return new Date(milliseconds).toISOString();
}

function optionalIsoTimestamp(
	value: string | undefined | null,
	field: string,
): string | undefined {
	return value == null ? undefined : isoTimestamp(value, field);
}

function positiveInteger(
	value: number | undefined | null,
	field: string,
): number | undefined {
	if (value == null) return undefined;
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
	return value;
}

function assertTimeWindow(availableAt: string, expiresAt: string): void {
	if (Date.parse(availableAt) >= Date.parse(expiresAt)) {
		throw new Error("availableAt must be before expiresAt");
	}
}

function placeholders(count: number): string {
	return new Array(count).fill("?").join(", ");
}

export class SqliteAgendaTaskStore {
	private readonly db: SqliteDb;

	constructor(options: SqliteAgendaTaskStoreOptions = {}) {
		this.db = loadSqliteDb(options.dbPath ?? resolveTasksDbPath());
		ensureAgendaTaskSchema(this.db);
		const now = nowIso();
		this.db
			.prepare(
				`INSERT OR IGNORE INTO agenda_task_automation (
					scope_key, mode, apply_to_agent_created, max_concurrent_runs,
					max_chain_depth, max_starts_per_hour, updated_at
				) VALUES ('global', 'manual', 1, 2, 1, 20, ?)`,
			)
			.run(now);
	}

	public close(): void {
		this.db.close?.();
	}

	public createTask(input: AgendaTaskCreateInput): AgendaTaskRecord {
		const now = nowIso();
		const taskId = optionalText(input.taskId) ?? `task_${randomUUID()}`;
		const location = normalizeAgendaTaskLocation(input);
		const availableAt = isoTimestamp(input.availableAt ?? now, "availableAt");
		const expiresAt = isoTimestamp(input.expiresAt, "expiresAt");
		assertTimeWindow(availableAt, expiresAt);
		const priority = input.priority ?? 3;
		if (!Number.isInteger(priority) || priority < 0 || priority > 5) {
			throw new Error("priority must be an integer from 0 to 5");
		}
		const maxIterations = positiveInteger(input.maxIterations, "maxIterations");
		const timeoutSeconds = positiveInteger(
			input.timeoutSeconds,
			"timeoutSeconds",
		);
		const requiresApproval = input.requiresApproval !== false;
		const initialStatus = requiresApproval ? "pending_approval" : "approved";
		const approvedRevision = requiresApproval ? null : 1;
		this.db
			.prepare(
				`INSERT INTO agenda_tasks (
					task_id, type, status, title, description, instructions, scope,
					workspace_root, cwd, resource_paths_json, priority, assignee,
					model_selection_json, mode, system_prompt, max_iterations,
					timeout_seconds, available_at, expires_at, automation_eligible,
					revision, approved_revision, created_by_json, updated_by_json, origin_session_id,
					origin_task_id, spec_path, created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?
				)`,
			)
			.run(
				taskId,
				input.type,
				initialStatus,
				requiredText(input.title, "title"),
				optionalText(input.description) ?? null,
				requiredText(input.instructions, "instructions"),
				input.scope,
				location.workspaceRoot ?? null,
				location.cwd ?? null,
				JSON.stringify(location.resourcePaths),
				priority,
				optionalText(input.assignee) ?? null,
				input.modelSelection ? JSON.stringify(input.modelSelection) : null,
				input.mode ?? null,
				optionalText(input.systemPrompt) ?? null,
				maxIterations ?? null,
				timeoutSeconds ?? null,
				availableAt,
				expiresAt,
				input.automationEligible === false ? 0 : 1,
				approvedRevision,
				JSON.stringify(input.createdBy),
				JSON.stringify(input.createdBy),
				optionalText(input.originSessionId) ?? null,
				optionalText(input.originTaskId) ?? null,
				optionalText(input.specPath) ?? null,
				now,
				now,
			);
		const record = this.getTask(taskId);
		if (!record) throw new Error(`failed to create task ${taskId}`);
		return record;
	}

	public getTask(taskId: string): AgendaTaskRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM agenda_tasks WHERE task_id = ?")
			.get(taskId);
		return row ? taskRowToRecord(row) : undefined;
	}

	public getTaskBySpecPath(specPath: string): AgendaTaskRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM agenda_tasks WHERE spec_path = ?")
			.get(specPath);
		return row ? taskRowToRecord(row) : undefined;
	}

	/**
	 * Return every workspace that has ever owned a task. Archived rows are
	 * intentionally included so the Hub can restore file watchers after a restart.
	 */
	public listWorkspaceRoots(): string[] {
		const rows = this.db
			.prepare(
				`SELECT DISTINCT workspace_root FROM agenda_tasks
				WHERE scope = 'workspace' AND workspace_root IS NOT NULL
				ORDER BY workspace_root ASC`,
			)
			.all();
		const roots = new Set<string>();
		for (const row of rows) {
			const root = asOptionalString(row.workspace_root);
			if (root) roots.add(resolve(root));
		}
		return [...roots].sort((left, right) => left.localeCompare(right));
	}

	public listTasks(input: AgendaTaskListInput = {}): AgendaTaskRecord[] {
		if (
			input.statuses?.length === 0 ||
			input.types?.length === 0 ||
			input.priorities?.length === 0
		) {
			return [];
		}
		const where: string[] = [];
		const params: unknown[] = [];
		if (input.statuses) {
			where.push(`status IN (${placeholders(input.statuses.length)})`);
			params.push(...input.statuses);
		}
		if (input.types) {
			where.push(`type IN (${placeholders(input.types.length)})`);
			params.push(...input.types);
		}
		const workspaceRoot = input.workspaceRoot?.trim()
			? resolve(input.workspaceRoot)
			: undefined;
		if (input.scope === "workspace") {
			where.push("scope = 'workspace'");
			if (workspaceRoot) {
				where.push("workspace_root = ?");
				params.push(workspaceRoot);
			}
		} else if (input.scope === "global") {
			where.push("scope = 'global'");
		} else if (workspaceRoot) {
			where.push(
				"(scope = 'global' OR (scope = 'workspace' AND workspace_root = ?))",
			);
			params.push(workspaceRoot);
		}
		if (input.priorities) {
			where.push(`priority IN (${placeholders(input.priorities.length)})`);
			params.push(...input.priorities);
		}
		if (typeof input.automationEligible === "boolean") {
			where.push("automation_eligible = ?");
			params.push(input.automationEligible ? 1 : 0);
		}
		if (input.availableBefore) {
			where.push("available_at <= ?");
			params.push(isoTimestamp(input.availableBefore, "availableBefore"));
		}
		if (!input.includeArchived) {
			where.push("archived_at IS NULL");
		}
		const limit = Math.min(1000, Math.max(1, Math.floor(input.limit ?? 200)));
		const rows = this.db
			.prepare(
				`SELECT * FROM agenda_tasks
				${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
				ORDER BY priority ASC, available_at ASC, created_at ASC, task_id ASC
				LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map(taskRowToRecord);
	}

	/** Apply user-editable fields, increment revision, and revoke old approval. */
	public updateTask(
		input: AgendaTaskUpdateInput,
	): AgendaTaskRecord | undefined {
		const current = this.getTask(input.taskId);
		if (!current) return undefined;
		if (current.revision !== input.expectedRevision) {
			throw new AgendaTaskRevisionConflictError(current);
		}
		if (current.status === "in_progress") {
			throw new Error("an in-progress task cannot be edited");
		}

		const scope = input.scope ?? current.scope;
		const location = normalizeAgendaTaskLocation({
			scope,
			workspaceRoot:
				input.workspaceRoot === null
					? undefined
					: (input.workspaceRoot ?? current.workspaceRoot),
			cwd: input.cwd === null ? undefined : (input.cwd ?? current.cwd),
			resourcePaths: input.resourcePaths ?? current.resourcePaths,
		});
		const availableAt = isoTimestamp(
			input.availableAt ?? current.availableAt,
			"availableAt",
		);
		const expiresAt = isoTimestamp(
			input.expiresAt ?? current.expiresAt,
			"expiresAt",
		);
		assertTimeWindow(availableAt, expiresAt);
		const priority = input.priority ?? current.priority;
		if (!Number.isInteger(priority) || priority < 0 || priority > 5) {
			throw new Error("priority must be an integer from 0 to 5");
		}
		const status =
			current.status === "approved" || current.status === "failed"
				? "pending_approval"
				: current.status;
		const revision = current.revision + 1;
		const now = nowIso();
		this.db
			.prepare(
				`UPDATE agenda_tasks SET
					type = ?, status = ?, title = ?, description = ?, instructions = ?,
					scope = ?, workspace_root = ?, cwd = ?, resource_paths_json = ?,
					priority = ?, assignee = ?, model_selection_json = ?, mode = ?,
					system_prompt = ?, max_iterations = ?, timeout_seconds = ?,
					available_at = ?, expires_at = ?, automation_eligible = ?, revision = ?,
					approved_revision = NULL, error = NULL, updated_by_json = ?, updated_at = ?
				WHERE task_id = ? AND revision = ?`,
			)
			.run(
				input.type ?? current.type,
				status,
				requiredText(input.title ?? current.title, "title"),
				input.description === null
					? null
					: (optionalText(input.description ?? current.description) ?? null),
				requiredText(
					input.instructions ?? current.instructions,
					"instructions",
				),
				scope,
				location.workspaceRoot ?? null,
				location.cwd ?? null,
				JSON.stringify(location.resourcePaths),
				priority,
				input.assignee === null
					? null
					: (optionalText(input.assignee ?? current.assignee) ?? null),
				input.modelSelection === null
					? null
					: JSON.stringify(input.modelSelection ?? current.modelSelection) ||
							null,
				input.mode === null ? null : (input.mode ?? current.mode ?? null),
				input.systemPrompt === null
					? null
					: (optionalText(input.systemPrompt ?? current.systemPrompt) ?? null),
				positiveInteger(
					input.maxIterations === null
						? undefined
						: (input.maxIterations ?? current.maxIterations),
					"maxIterations",
				) ?? null,
				positiveInteger(
					input.timeoutSeconds === null
						? undefined
						: (input.timeoutSeconds ?? current.timeoutSeconds),
					"timeoutSeconds",
				) ?? null,
				availableAt,
				expiresAt,
				(input.automationEligible ?? current.automationEligible) ? 1 : 0,
				revision,
				JSON.stringify(input.updatedBy),
				now,
				input.taskId,
				current.revision,
			);
		return this.getTask(input.taskId);
	}

	/** Mutate manager-owned lifecycle fields without changing the task revision. */
	public updateTaskState(
		taskId: string,
		patch: AgendaTaskStatePatch,
		expectedRevision?: number,
	): AgendaTaskRecord | undefined {
		const current = this.getTask(taskId);
		if (!current) return undefined;
		if (
			expectedRevision !== undefined &&
			current.revision !== expectedRevision
		) {
			throw new AgendaTaskRevisionConflictError(current);
		}
		const approvedRevision =
			patch.approvedRevision === null
				? undefined
				: (patch.approvedRevision ?? current.approvedRevision);
		const status = patch.status ?? current.status;
		if (status === "in_progress" && approvedRevision !== current.revision) {
			throw new Error(
				"in-progress task must be approved for its current revision",
			);
		}
		const now = nowIso();
		this.db
			.prepare(
				`UPDATE agenda_tasks SET
					status = ?, approved_revision = ?, current_run_id = ?, last_run_id = ?,
					last_session_id = ?, spec_path = ?, error = ?, completed_at = ?,
					archived_at = ?, updated_by_json = ?, updated_at = ?
				WHERE task_id = ? AND revision = ?`,
			)
			.run(
				status,
				approvedRevision ?? null,
				patch.currentRunId === null
					? null
					: (patch.currentRunId ?? current.currentRunId ?? null),
				patch.lastRunId === null
					? null
					: (patch.lastRunId ?? current.lastRunId ?? null),
				patch.lastSessionId === null
					? null
					: (patch.lastSessionId ?? current.lastSessionId ?? null),
				patch.specPath === null
					? null
					: (patch.specPath ?? current.specPath ?? null),
				patch.error === null ? null : (patch.error ?? current.error ?? null),
				patch.completedAt === null
					? null
					: (patch.completedAt ?? current.completedAt ?? null),
				patch.archivedAt === null
					? null
					: (patch.archivedAt ?? current.archivedAt ?? null),
				JSON.stringify(patch.updatedBy ?? current.updatedBy),
				now,
				taskId,
				current.revision,
			);
		return this.getTask(taskId);
	}

	public deleteTask(taskId: string): boolean {
		return (
			(this.db.prepare("DELETE FROM agenda_tasks WHERE task_id = ?").run(taskId)
				.changes ?? 0) > 0
		);
	}

	public createRun(input: CreateAgendaTaskRunInput): AgendaTaskRunRecord {
		const task = this.getTask(input.taskId);
		if (!task) throw new Error(`task ${input.taskId} does not exist`);
		if (task.revision !== input.taskRevision) {
			throw new AgendaTaskRevisionConflictError(task);
		}
		const attemptRow = this.db
			.prepare(
				"SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM agenda_task_runs WHERE task_id = ?",
			)
			.get(input.taskId);
		const attempt = (toInteger(attemptRow?.max_attempt) ?? 0) + 1;
		const runId = `run_${randomUUID()}`;
		const now = nowIso();
		const claimedAt = input.claimedAt
			? isoTimestamp(input.claimedAt, "claimedAt")
			: now;
		this.db
			.prepare(
				`INSERT INTO agenda_task_runs (
					run_id, task_id, task_revision, attempt, status, claim_token,
					claim_until_at, requested_by_client_id, session_id, claimed_at,
					created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				runId,
				input.taskId,
				input.taskRevision,
				attempt,
				input.status ?? "starting",
				optionalText(input.claimToken) ?? null,
				optionalIsoTimestamp(input.claimUntilAt, "claimUntilAt") ?? null,
				optionalText(input.requestedByClientId) ?? null,
				optionalText(input.sessionId) ?? null,
				claimedAt,
				now,
				now,
			);
		const run = this.getRun(runId);
		if (!run) throw new Error(`failed to create run ${runId}`);
		return run;
	}

	public getRun(runId: string): AgendaTaskRunRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM agenda_task_runs WHERE run_id = ?")
			.get(runId);
		return row ? runRowToRecord(row) : undefined;
	}

	public updateRun(
		runId: string,
		input: UpdateAgendaTaskRunInput,
	): AgendaTaskRunRecord | undefined {
		const current = this.getRun(runId);
		if (!current) return undefined;
		const now = nowIso();
		this.db
			.prepare(
				`UPDATE agenda_task_runs SET
					status = ?, claim_token = ?, claim_until_at = ?,
					requested_by_client_id = ?, session_id = ?, started_at = ?,
					completed_at = ?, result_summary = ?, error = ?, updated_at = ?
				WHERE run_id = ?`,
			)
			.run(
				input.status ?? current.status,
				input.claimToken === null
					? null
					: (input.claimToken ?? current.claimToken ?? null),
				input.claimUntilAt === null
					? null
					: (input.claimUntilAt ?? current.claimUntilAt ?? null),
				input.requestedByClientId === null
					? null
					: (input.requestedByClientId ?? current.requestedByClientId ?? null),
				input.sessionId === null
					? null
					: (input.sessionId ?? current.sessionId ?? null),
				input.startedAt === null
					? null
					: (input.startedAt ?? current.startedAt ?? null),
				input.completedAt === null
					? null
					: (input.completedAt ?? current.completedAt ?? null),
				input.resultSummary === null
					? null
					: (input.resultSummary ?? current.resultSummary ?? null),
				input.error === null ? null : (input.error ?? current.error ?? null),
				now,
				runId,
			);
		return this.getRun(runId);
	}

	public listRuns(input: ListAgendaTaskRunsInput = {}): AgendaTaskRunRecord[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (input.taskId) {
			where.push("task_id = ?");
			params.push(input.taskId);
		}
		if (input.sessionId) {
			where.push("session_id = ?");
			params.push(input.sessionId);
		}
		const statuses = Array.isArray(input.status)
			? input.status
			: input.status
				? [input.status]
				: undefined;
		if (statuses?.length === 0) return [];
		if (statuses) {
			where.push(`status IN (${placeholders(statuses.length)})`);
			params.push(...statuses);
		}
		const limit = Math.min(1000, Math.max(1, Math.floor(input.limit ?? 200)));
		const rows = this.db
			.prepare(
				`SELECT * FROM agenda_task_runs
				${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
				ORDER BY created_at DESC, attempt DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map(runRowToRecord);
	}

	public getAutomationPolicy(scopeKey = "global"): AgendaAutomationPolicy {
		let row = this.db
			.prepare("SELECT * FROM agenda_task_automation WHERE scope_key = ?")
			.get(scopeKey);
		if (!row) {
			this.db
				.prepare(
					`INSERT OR IGNORE INTO agenda_task_automation (
						scope_key, mode, apply_to_agent_created, max_concurrent_runs,
						max_chain_depth, max_starts_per_hour, updated_at
					) VALUES (?, 'manual', 1, 2, 1, 20, ?)`,
				)
				.run(scopeKey, nowIso());
			row = this.db
				.prepare("SELECT * FROM agenda_task_automation WHERE scope_key = ?")
				.get(scopeKey);
		}
		if (!row)
			throw new Error(`failed to initialize automation policy ${scopeKey}`);
		return policyRowToRecord(row);
	}

	public listAutomationPolicies(): AgendaAutomationPolicy[] {
		return this.db
			.prepare("SELECT * FROM agenda_task_automation ORDER BY scope_key")
			.all()
			.map((row) => policyRowToRecord(row));
	}

	public setAutomationPolicy(
		input: Omit<AgendaAutomationPolicy, "updatedAt">,
	): AgendaAutomationPolicy {
		const scopeKey = requiredText(input.scopeKey, "scopeKey");
		const maxConcurrentRuns = positiveInteger(
			input.maxConcurrentRuns,
			"maxConcurrentRuns",
		);
		const maxChainDepth = positiveInteger(input.maxChainDepth, "maxChainDepth");
		const maxStartsPerHour = positiveInteger(
			input.maxStartsPerHour,
			"maxStartsPerHour",
		);
		const now = nowIso();
		this.db
			.prepare(
				`INSERT INTO agenda_task_automation (
					scope_key, mode, apply_to_agent_created, max_concurrent_runs,
					max_chain_depth, max_starts_per_hour, enabled_by_json,
					enabled_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(scope_key) DO UPDATE SET
					mode = excluded.mode,
					apply_to_agent_created = excluded.apply_to_agent_created,
					max_concurrent_runs = excluded.max_concurrent_runs,
					max_chain_depth = excluded.max_chain_depth,
					max_starts_per_hour = excluded.max_starts_per_hour,
					enabled_by_json = excluded.enabled_by_json,
					enabled_at = excluded.enabled_at,
					updated_at = excluded.updated_at`,
			)
			.run(
				scopeKey,
				input.mode,
				input.applyToAgentCreated ? 1 : 0,
				maxConcurrentRuns,
				maxChainDepth,
				maxStartsPerHour,
				input.enabledBy ? JSON.stringify(input.enabledBy) : null,
				optionalIsoTimestamp(input.enabledAt, "enabledAt") ?? null,
				now,
			);
		return this.getAutomationPolicy(scopeKey);
	}
}
