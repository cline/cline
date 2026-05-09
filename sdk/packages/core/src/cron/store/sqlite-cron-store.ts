import { randomUUID } from "node:crypto";
import type {
	AutomationEventEnvelope,
	CronSpec,
	CronSpecExtensionKind,
	CronTriggerKind,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
} from "@clinebot/shared";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
} from "@clinebot/shared/db";
import { resolveCronDbPath } from "@clinebot/shared/storage";
import { getNextCronTime } from "../schedule/scheduler";
import { ensureCronSchema } from "./cron-schema";

/**
 * Generalized cron/automation store backed by `cron.db`. Sessions stay in
 * their own database (see @clinebot/shared `ensureSessionSchema`). cron_runs
 * here absorb one-off, recurring, and event-driven work under one queue.
 */

export type CronRunStatus =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

export type CronRunTriggerKind =
	| "one_off"
	| "schedule"
	| "event"
	| "manual"
	| "retry";

export type CronParseStatus = "valid" | "invalid";

export type CronEventProcessingStatus =
	| "received"
	| "unmatched"
	| "queued"
	| "suppressed"
	| "failed";

export interface CronSpecRecord {
	specId: string;
	externalId: string;
	sourcePath: string;
	triggerKind: CronTriggerKind;
	sourceMtimeMs?: number;
	sourceHash?: string;
	parseStatus: CronParseStatus;
	parseError?: string;
	enabled: boolean;
	removed: boolean;
	title: string;
	prompt?: string;
	workspaceRoot?: string;
	scheduleExpr?: string;
	timezone?: string;
	eventType?: string;
	filters?: Record<string, unknown>;
	debounceSeconds?: number;
	dedupeWindowSeconds?: number;
	cooldownSeconds?: number;
	mode?: string;
	systemPrompt?: string;
	providerId?: string;
	modelId?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel?: number;
	tools?: string[];
	notesDirectory?: string;
	extensions?: CronSpecExtensionKind[];
	source?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
	revision: number;
	lastMaterializedRunId?: string;
	lastRunAt?: string;
	nextRunAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CronRunRecord {
	runId: string;
	specId: string;
	specRevision: number;
	triggerKind: CronRunTriggerKind;
	status: CronRunStatus;
	claimToken?: string;
	claimStartedAt?: string;
	claimUntilAt?: string;
	scheduledFor?: string;
	triggerEventId?: string;
	startedAt?: string;
	completedAt?: string;
	sessionId?: string;
	reportPath?: string;
	error?: string;
	attemptCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface CronEventLogRecord {
	eventId: string;
	eventType: string;
	source: string;
	subject?: string;
	occurredAt: string;
	receivedAt: string;
	workspaceRoot?: string;
	dedupeKey?: string;
	payload?: Record<string, unknown>;
	attributes?: Record<string, unknown>;
	processingStatus: CronEventProcessingStatus;
	matchedSpecCount: number;
	queuedRunCount: number;
	suppressedCount: number;
	error?: string;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertSpecInput {
	externalId: string;
	sourcePath: string;
	triggerKind: CronTriggerKind;
	sourceMtimeMs?: number;
	sourceHash: string;
	parseStatus: CronParseStatus;
	parseError?: string;
	spec?: CronSpec;
}

export interface UpsertSpecResult {
	record: CronSpecRecord;
	created: boolean;
	revisionChanged: boolean;
}

export interface SqliteCronStoreOptions {
	dbPath?: string;
}

function parseJsonRecord(
	value: string | undefined,
): Record<string, unknown> | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignore
	}
	return undefined;
}

function parseJsonArray(
	value: string | undefined,
	options: { preserveEmpty?: boolean } = {},
): string[] | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return undefined;
		const tags = parsed
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
		if (options.preserveEmpty) {
			return tags;
		}
		return tags.length > 0 ? tags : undefined;
	} catch {
		return undefined;
	}
}

function toInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	return undefined;
}

function specToRecord(row: Record<string, unknown>): CronSpecRecord {
	return {
		specId: asString(row.spec_id),
		externalId: asString(row.external_id),
		sourcePath: asString(row.source_path),
		triggerKind: asString(row.trigger_kind) as CronTriggerKind,
		sourceMtimeMs: toInt(row.source_mtime_ms),
		sourceHash: asOptionalString(row.source_hash),
		parseStatus: asString(row.parse_status) === "invalid" ? "invalid" : "valid",
		parseError: asOptionalString(row.parse_error),
		enabled: Number(row.enabled ?? 0) === 1,
		removed: Number(row.removed ?? 0) === 1,
		title: asString(row.title),
		prompt: asOptionalString(row.prompt),
		workspaceRoot: asOptionalString(row.workspace_root),
		scheduleExpr: asOptionalString(row.schedule_expr),
		timezone: asOptionalString(row.timezone),
		eventType: asOptionalString(row.event_type),
		filters: parseJsonRecord(asOptionalString(row.filters_json)),
		debounceSeconds: toInt(row.debounce_seconds),
		dedupeWindowSeconds: toInt(row.dedupe_window_seconds),
		cooldownSeconds: toInt(row.cooldown_seconds),
		mode: asOptionalString(row.mode),
		systemPrompt: asOptionalString(row.system_prompt),
		providerId: asOptionalString(row.provider_id),
		modelId: asOptionalString(row.model_id),
		maxIterations: toInt(row.max_iterations),
		timeoutSeconds: toInt(row.timeout_seconds),
		maxParallel: toInt(row.max_parallel),
		tools: parseJsonArray(asOptionalString(row.tools_json), {
			preserveEmpty: true,
		}),
		notesDirectory: asOptionalString(row.notes_directory),
		extensions: parseJsonArray(asOptionalString(row.extensions_json), {
			preserveEmpty: true,
		}) as CronSpecExtensionKind[] | undefined,
		source: asOptionalString(row.source),
		tags: parseJsonArray(asOptionalString(row.tags_json)),
		metadata: parseJsonRecord(asOptionalString(row.metadata_json)),
		revision: Number(row.revision ?? 1),
		lastMaterializedRunId: asOptionalString(row.last_materialized_run_id),
		lastRunAt: asOptionalString(row.last_run_at),
		nextRunAt: asOptionalString(row.next_run_at),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
	};
}

function runToRecord(row: Record<string, unknown>): CronRunRecord {
	return {
		runId: asString(row.run_id),
		specId: asString(row.spec_id),
		specRevision: Number(row.spec_revision ?? 1),
		triggerKind: asString(row.trigger_kind) as CronRunTriggerKind,
		status: asString(row.status) as CronRunStatus,
		claimToken: asOptionalString(row.claim_token),
		claimStartedAt: asOptionalString(row.claim_started_at),
		claimUntilAt: asOptionalString(row.claim_until_at),
		scheduledFor: asOptionalString(row.scheduled_for),
		triggerEventId: asOptionalString(row.trigger_event_id),
		startedAt: asOptionalString(row.started_at),
		completedAt: asOptionalString(row.completed_at),
		sessionId: asOptionalString(row.session_id),
		reportPath: asOptionalString(row.report_path),
		error: asOptionalString(row.error),
		attemptCount: Number(row.attempt_count ?? 0),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
	};
}

function eventLogToRecord(row: Record<string, unknown>): CronEventLogRecord {
	return {
		eventId: asString(row.event_id),
		eventType: asString(row.event_type),
		source: asString(row.source),
		subject: asOptionalString(row.subject),
		occurredAt: asString(row.occurred_at),
		receivedAt: asString(row.received_at),
		workspaceRoot: asOptionalString(row.workspace_root),
		dedupeKey: asOptionalString(row.dedupe_key),
		payload: parseJsonRecord(asOptionalString(row.payload_json)),
		attributes: parseJsonRecord(asOptionalString(row.attributes_json)),
		processingStatus: asString(
			row.processing_status,
		) as CronEventProcessingStatus,
		matchedSpecCount: Number(row.matched_spec_count ?? 0),
		queuedRunCount: Number(row.queued_run_count ?? 0),
		suppressedCount: Number(row.suppressed_count ?? 0),
		error: asOptionalString(row.error),
		createdAt: asString(row.created_at),
		updatedAt: asString(row.updated_at),
	};
}

function jsonOrNull(value: Record<string, unknown> | undefined): string | null {
	return value ? JSON.stringify(value) : null;
}

const MEANINGFUL_FIELD_KEYS = [
	"prompt",
	"workspaceRoot",
	"mode",
	"systemPrompt",
	"providerId",
	"modelId",
	"maxIterations",
	"timeoutSeconds",
	"maxParallel",
	"tools",
	"notesDirectory",
	"extensions",
	"source",
	"scheduleExpr",
	"timezone",
	"eventType",
	"filters",
	"debounceSeconds",
	"dedupeWindowSeconds",
	"cooldownSeconds",
] as const;

function normalizeForCompare(value: unknown): unknown {
	if (value === undefined) return null;
	if (value && typeof value === "object") {
		return JSON.stringify(value);
	}
	return value;
}

function hasMeaningfulChange(
	prev: CronSpecRecord,
	nextValues: Record<string, unknown>,
	prevEnabled: boolean,
	nextEnabled: boolean,
): boolean {
	for (const key of MEANINGFUL_FIELD_KEYS) {
		const prevVal = (prev as unknown as Record<string, unknown>)[key];
		const nextVal = nextValues[key];
		if (normalizeForCompare(prevVal) !== normalizeForCompare(nextVal)) {
			return true;
		}
	}
	if (prevEnabled === false && nextEnabled === true) return true;
	return false;
}

function filenameStemFromPath(sourcePath: string): string {
	const base = sourcePath.split("/").pop() ?? sourcePath;
	return base
		.replace(/\.event\.md$/, "")
		.replace(/\.cron\.md$/, "")
		.replace(/\.md$/, "");
}

function hubScheduleSourcePath(scheduleId: string): string {
	return `hub/schedules/${scheduleId}.cron.md`;
}

function hubScheduleMetadata(
	input: HubScheduleCreateInput,
): Record<string, unknown> | undefined {
	const metadata = {
		...(input.metadata ?? {}),
		...(input.createdBy ? { __hubScheduleCreatedBy: input.createdBy } : {}),
		...(input.cwd ? { __hubScheduleCwd: input.cwd } : {}),
		...(input.runtimeOptions
			? { __hubRuntimeOptions: input.runtimeOptions }
			: {}),
	};
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function hubScheduleInputToCronSpec(input: HubScheduleCreateInput): CronSpec {
	return {
		triggerKind: "schedule",
		title: input.name.trim(),
		prompt: input.prompt,
		workspaceRoot: input.workspaceRoot.trim(),
		schedule: input.cronPattern.trim(),
		mode: input.mode ?? "act",
		systemPrompt: input.systemPrompt,
		modelSelection: input.modelSelection
			? JSON.parse(JSON.stringify(input.modelSelection))
			: undefined,
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
		source: "hub-schedule",
		tags: input.tags?.filter((tag) => tag.trim().length > 0),
		enabled: input.enabled !== false,
		metadata: hubScheduleMetadata(input),
	} as CronSpec;
}

function hubScheduleHash(input: HubScheduleCreateInput): string {
	return JSON.stringify(hubScheduleInputToCronSpec(input));
}

function cronSpecRecordToHubScheduleInput(
	current: CronSpecRecord,
	updates: HubScheduleUpdateInput,
): HubScheduleCreateInput {
	const metadata = current.metadata ? { ...current.metadata } : {};
	const createdBy =
		updates.createdBy === null
			? undefined
			: updates.createdBy !== undefined
				? updates.createdBy
				: typeof metadata.__hubScheduleCreatedBy === "string"
					? metadata.__hubScheduleCreatedBy
					: undefined;
	const cwd =
		updates.cwd !== undefined
			? updates.cwd
			: typeof metadata.__hubScheduleCwd === "string"
				? metadata.__hubScheduleCwd
				: undefined;
	const runtimeOptions =
		updates.runtimeOptions !== undefined
			? updates.runtimeOptions
			: metadata.__hubRuntimeOptions &&
					typeof metadata.__hubRuntimeOptions === "object" &&
					!Array.isArray(metadata.__hubRuntimeOptions)
				? (metadata.__hubRuntimeOptions as HubScheduleCreateInput["runtimeOptions"])
				: undefined;
	delete metadata.__hubScheduleCreatedBy;
	delete metadata.__hubScheduleCwd;
	delete metadata.__hubRuntimeOptions;
	return {
		name: updates.name ?? current.title,
		cronPattern: updates.cronPattern ?? current.scheduleExpr ?? "",
		prompt: updates.prompt ?? current.prompt ?? "",
		workspaceRoot: updates.workspaceRoot ?? current.workspaceRoot ?? "",
		cwd,
		modelSelection:
			updates.modelSelection !== undefined
				? updates.modelSelection
				: current.providerId || current.modelId
					? {
							providerId: current.providerId ?? "",
							modelId: current.modelId ?? "",
						}
					: undefined,
		enabled: updates.enabled ?? current.enabled,
		mode:
			updates.mode ??
			(current.mode === "plan"
				? "plan"
				: current.mode === "yolo"
					? "yolo"
					: "act"),
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
					? updates.maxIterations
					: current.maxIterations,
		timeoutSeconds:
			updates.timeoutSeconds === null
				? undefined
				: updates.timeoutSeconds !== undefined
					? updates.timeoutSeconds
					: current.timeoutSeconds,
		maxParallel: updates.maxParallel ?? current.maxParallel ?? 1,
		createdBy,
		tags: updates.tags ?? current.tags,
		runtimeOptions,
		metadata:
			updates.metadata !== undefined
				? updates.metadata
				: Object.keys(metadata).length > 0
					? (metadata as HubScheduleCreateInput["metadata"])
					: undefined,
	};
}

export interface ListSpecsOptions {
	triggerKind?: CronTriggerKind;
	enabled?: boolean;
	parseStatus?: CronParseStatus;
	includeRemoved?: boolean;
	limit?: number;
}

export interface ListRunsOptions {
	specId?: string;
	status?: CronRunStatus | CronRunStatus[];
	limit?: number;
}

export interface ClaimRunOptions {
	nowIso: string;
	leaseMs: number;
	limit?: number;
}

export interface ClaimedCronRun {
	run: CronRunRecord;
	claimToken: string;
	claimUntilAt: string;
}

interface ClaimBoundUpdate {
	runId: string;
	claimToken: string;
}

export interface MaterializeScheduleRunResult {
	queued: boolean;
	run?: CronRunRecord;
	nextRunAt?: string;
}

export interface EnqueueRunInput {
	specId: string;
	specRevision: number;
	triggerKind: CronRunTriggerKind;
	scheduledFor?: string;
	triggerEventId?: string;
}

export interface InsertEventLogResult {
	record: CronEventLogRecord;
	created: boolean;
}

export interface ListEventLogsOptions {
	eventType?: string;
	source?: string;
	processingStatus?: CronEventProcessingStatus;
	limit?: number;
}

export class SqliteCronStore {
	private readonly db: SqliteDb;

	constructor(options: SqliteCronStoreOptions = {}) {
		const path = options.dbPath ?? resolveCronDbPath();
		this.db = loadSqliteDb(path);
		ensureCronSchema(this.db);
	}

	public close(): void {
		this.db.close?.();
	}

	public getSpecBySourcePath(sourcePath: string): CronSpecRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM cron_specs WHERE source_path = ?")
			.get(sourcePath);
		return row ? specToRecord(row) : undefined;
	}

	public getSpec(specId: string): CronSpecRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM cron_specs WHERE spec_id = ?")
			.get(specId);
		return row ? specToRecord(row) : undefined;
	}

	public getSpecByExternalId(externalId: string): CronSpecRecord | undefined {
		const row = this.db
			.prepare(
				"SELECT * FROM cron_specs WHERE external_id = ? ORDER BY created_at ASC LIMIT 1",
			)
			.get(externalId);
		return row ? specToRecord(row) : undefined;
	}

	public listSpecs(options: ListSpecsOptions = {}): CronSpecRecord[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.triggerKind) {
			where.push("trigger_kind = ?");
			params.push(options.triggerKind);
		}
		if (typeof options.enabled === "boolean") {
			where.push("enabled = ?");
			params.push(options.enabled ? 1 : 0);
		}
		if (options.parseStatus) {
			where.push("parse_status = ?");
			params.push(options.parseStatus);
		}
		if (!options.includeRemoved) {
			where.push("removed = 0");
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit = Math.max(1, Math.floor(options.limit ?? 500));
		const rows = this.db
			.prepare(
				`SELECT * FROM cron_specs ${whereClause} ORDER BY created_at DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => specToRecord(row));
	}

	public createHubSchedule(input: HubScheduleCreateInput): CronSpecRecord {
		const scheduleId = `sched_${randomUUID()}`;
		const result = this.upsertSpec({
			externalId: scheduleId,
			sourcePath: hubScheduleSourcePath(scheduleId),
			triggerKind: "schedule",
			sourceHash: hubScheduleHash(input),
			parseStatus: "valid",
			spec: hubScheduleInputToCronSpec(input),
		});
		this.initializeScheduleNextRun(result.record.specId);
		const record = this.getSpec(result.record.specId);
		if (!record) throw new Error("failed to create hub schedule");
		return record;
	}

	public getHubSchedule(scheduleId: string): CronSpecRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT * FROM cron_specs
					WHERE external_id = ? AND source = 'hub-schedule' AND removed = 0
					ORDER BY created_at ASC LIMIT 1`,
			)
			.get(scheduleId);
		return row ? specToRecord(row) : undefined;
	}

	public listHubSchedules(
		options: { enabled?: boolean; limit?: number; tags?: string[] } = {},
	): CronSpecRecord[] {
		const where = [
			"source = 'hub-schedule'",
			"trigger_kind = 'schedule'",
			"removed = 0",
		];
		const params: unknown[] = [];
		if (typeof options.enabled === "boolean") {
			where.push("enabled = ?");
			params.push(options.enabled ? 1 : 0);
		}
		if (options.tags && options.tags.length > 0) {
			for (const tag of options.tags) {
				where.push("tags_json LIKE ?");
				params.push(`%"${tag.trim()}"%`);
			}
		}
		const limit = Math.max(1, Math.floor(options.limit ?? 200));
		const rows = this.db
			.prepare(
				`SELECT * FROM cron_specs
					WHERE ${where.join(" AND ")}
					ORDER BY created_at DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => specToRecord(row));
	}

	public updateHubSchedule(
		scheduleId: string,
		updates: HubScheduleUpdateInput,
	): CronSpecRecord | undefined {
		const current = this.getHubSchedule(scheduleId);
		if (!current) return undefined;
		const input = cronSpecRecordToHubScheduleInput(current, updates);
		const result = this.upsertSpec({
			externalId: scheduleId,
			sourcePath: current.sourcePath,
			triggerKind: "schedule",
			sourceHash: hubScheduleHash(input),
			parseStatus: "valid",
			spec: hubScheduleInputToCronSpec(input),
		});
		if (updates.cronPattern !== undefined || updates.enabled !== undefined) {
			this.initializeScheduleNextRun(result.record.specId);
		}
		return this.getSpec(result.record.specId);
	}

	public deleteHubSchedule(scheduleId: string): boolean {
		const spec = this.getHubSchedule(scheduleId);
		if (!spec) return false;
		this.markSpecRemoved(spec.specId);
		this.cancelQueuedRunsForSpec(spec.specId);
		return true;
	}

	public enqueueHubScheduleRun(
		scheduleId: string,
		triggerKind: "manual" | "retry" = "manual",
	): CronRunRecord | undefined {
		const spec = this.getHubSchedule(scheduleId);
		if (
			!spec ||
			!spec.enabled ||
			spec.removed ||
			spec.parseStatus !== "valid"
		) {
			return undefined;
		}
		return this.enqueueRun({
			specId: spec.specId,
			specRevision: spec.revision,
			triggerKind,
			scheduledFor: nowIso(),
		});
	}

	public listEventSpecsForType(eventType: string): CronSpecRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM cron_specs
					WHERE trigger_kind = 'event'
						AND event_type = ?
						AND enabled = 1
						AND removed = 0
						AND parse_status = 'valid'
					ORDER BY created_at ASC`,
			)
			.all(eventType);
		return rows.map((row) => specToRecord(row));
	}

	public upsertSpec(input: UpsertSpecInput): UpsertSpecResult {
		const now = nowIso();
		const existing = this.getSpecBySourcePath(input.sourcePath);

		const spec = input.spec;
		const nextValues: Record<string, unknown> = {
			title:
				spec?.title ??
				existing?.title ??
				filenameStemFromPath(input.sourcePath),
			prompt: spec?.prompt,
			workspaceRoot: spec?.workspaceRoot,
			scheduleExpr:
				spec?.triggerKind === "schedule" ? spec.schedule : undefined,
			timezone: spec?.triggerKind === "schedule" ? spec.timezone : undefined,
			eventType: spec?.triggerKind === "event" ? spec.event : undefined,
			filters: spec?.triggerKind === "event" ? spec.filters : undefined,
			debounceSeconds:
				spec?.triggerKind === "event" ? spec.debounceSeconds : undefined,
			dedupeWindowSeconds:
				spec?.triggerKind === "event" ? spec.dedupeWindowSeconds : undefined,
			cooldownSeconds:
				spec?.triggerKind === "event" ? spec.cooldownSeconds : undefined,
			mode: spec?.mode,
			systemPrompt: spec?.systemPrompt,
			providerId: spec?.modelSelection?.providerId,
			modelId: spec?.modelSelection?.modelId,
			maxIterations: spec?.maxIterations,
			timeoutSeconds: spec?.timeoutSeconds,
			maxParallel:
				spec && "maxParallel" in spec
					? (spec.maxParallel as number | undefined)
					: undefined,
			tools: spec?.tools,
			notesDirectory: spec?.notesDirectory,
			extensions: spec?.extensions,
			source: spec?.source,
		};

		const enabled = input.parseStatus === "valid" && (spec?.enabled ?? true);

		if (!existing) {
			const specId = `cspec_${randomUUID()}`;
			this.insertSpecRow(specId, input, nextValues, enabled, now);
			const record = this.getSpec(specId);
			if (!record) throw new Error("failed to insert cron_spec row");
			return { record, created: true, revisionChanged: true };
		}

		const hashChanged = existing.sourceHash !== input.sourceHash;
		const revisionChanged =
			hashChanged &&
			hasMeaningfulChange(existing, nextValues, existing.enabled, enabled);
		const revision = revisionChanged
			? existing.revision + 1
			: existing.revision;
		this.updateSpecRow(
			existing.specId,
			input,
			nextValues,
			enabled,
			revision,
			now,
		);
		const record = this.getSpec(existing.specId);
		if (!record) throw new Error("failed to reload cron_spec after update");
		return { record, created: false, revisionChanged };
	}

	private insertSpecRow(
		specId: string,
		input: UpsertSpecInput,
		v: Record<string, unknown>,
		enabled: boolean,
		now: string,
	): void {
		const spec = input.spec;
		this.db
			.prepare(
				`INSERT INTO cron_specs (
						spec_id, external_id, source_path, trigger_kind,
						source_mtime_ms, source_hash, parse_status, parse_error,
						enabled, removed, title, prompt, workspace_root,
						schedule_expr, timezone, event_type, filters_json,
						debounce_seconds, dedupe_window_seconds, cooldown_seconds,
						mode, system_prompt, provider_id, model_id,
						max_iterations, timeout_seconds, max_parallel,
						tools_json, notes_directory, extensions_json, source,
						tags_json, metadata_json, revision,
						created_at, updated_at
					) VALUES (${Array.from({ length: 36 }, () => "?").join(",")})`,
			)
			.run(
				specId,
				input.externalId,
				input.sourcePath,
				input.triggerKind,
				input.sourceMtimeMs ?? null,
				input.sourceHash,
				input.parseStatus,
				input.parseError ?? null,
				enabled ? 1 : 0,
				0,
				(v.title as string) ?? "",
				(v.prompt as string | undefined) ?? null,
				(v.workspaceRoot as string | undefined) ?? null,
				(v.scheduleExpr as string | undefined) ?? null,
				(v.timezone as string | undefined) ?? null,
				(v.eventType as string | undefined) ?? null,
				v.filters ? JSON.stringify(v.filters) : null,
				(v.debounceSeconds as number | undefined) ?? null,
				(v.dedupeWindowSeconds as number | undefined) ?? null,
				(v.cooldownSeconds as number | undefined) ?? null,
				(v.mode as string | undefined) ?? null,
				(v.systemPrompt as string | undefined) ?? null,
				(v.providerId as string | undefined) ?? null,
				(v.modelId as string | undefined) ?? null,
				(v.maxIterations as number | undefined) ?? null,
				(v.timeoutSeconds as number | undefined) ?? null,
				(v.maxParallel as number | undefined) ?? null,
				v.tools ? JSON.stringify(v.tools) : null,
				(v.notesDirectory as string | undefined) ?? null,
				v.extensions ? JSON.stringify(v.extensions) : null,
				(v.source as string | undefined) ?? null,
				spec?.tags ? JSON.stringify(spec.tags) : null,
				spec?.metadata ? JSON.stringify(spec.metadata) : null,
				1,
				now,
				now,
			);
	}

	private updateSpecRow(
		specId: string,
		input: UpsertSpecInput,
		v: Record<string, unknown>,
		enabled: boolean,
		revision: number,
		now: string,
	): void {
		const spec = input.spec;
		this.db
			.prepare(
				`UPDATE cron_specs SET
						external_id = ?, trigger_kind = ?,
						source_mtime_ms = ?, source_hash = ?, parse_status = ?, parse_error = ?,
						enabled = ?, removed = 0, title = ?, prompt = ?,
						workspace_root = ?, schedule_expr = ?, timezone = ?,
						event_type = ?, filters_json = ?,
						debounce_seconds = ?, dedupe_window_seconds = ?, cooldown_seconds = ?,
						mode = ?, system_prompt = ?, provider_id = ?, model_id = ?,
						max_iterations = ?, timeout_seconds = ?, max_parallel = ?,
						tools_json = ?, notes_directory = ?, extensions_json = ?, source = ?,
						tags_json = ?, metadata_json = ?,
						revision = ?, updated_at = ?
				WHERE spec_id = ?`,
			)
			.run(
				input.externalId,
				input.triggerKind,
				input.sourceMtimeMs ?? null,
				input.sourceHash,
				input.parseStatus,
				input.parseError ?? null,
				enabled ? 1 : 0,
				(v.title as string) ?? "",
				(v.prompt as string | undefined) ?? null,
				(v.workspaceRoot as string | undefined) ?? null,
				(v.scheduleExpr as string | undefined) ?? null,
				(v.timezone as string | undefined) ?? null,
				(v.eventType as string | undefined) ?? null,
				v.filters ? JSON.stringify(v.filters) : null,
				(v.debounceSeconds as number | undefined) ?? null,
				(v.dedupeWindowSeconds as number | undefined) ?? null,
				(v.cooldownSeconds as number | undefined) ?? null,
				(v.mode as string | undefined) ?? null,
				(v.systemPrompt as string | undefined) ?? null,
				(v.providerId as string | undefined) ?? null,
				(v.modelId as string | undefined) ?? null,
				(v.maxIterations as number | undefined) ?? null,
				(v.timeoutSeconds as number | undefined) ?? null,
				(v.maxParallel as number | undefined) ?? null,
				v.tools ? JSON.stringify(v.tools) : null,
				(v.notesDirectory as string | undefined) ?? null,
				v.extensions ? JSON.stringify(v.extensions) : null,
				(v.source as string | undefined) ?? null,
				spec?.tags ? JSON.stringify(spec.tags) : null,
				spec?.metadata ? JSON.stringify(spec.metadata) : null,
				revision,
				now,
				specId,
			);
	}

	public markSpecRemoved(specId: string): void {
		this.db
			.prepare(
				`UPDATE cron_specs SET removed = 1, enabled = 0, updated_at = ? WHERE spec_id = ?`,
			)
			.run(nowIso(), specId);
	}

	public updateSpecNextRunAt(
		specId: string,
		nextRunAt: string | undefined,
	): void {
		this.db
			.prepare(
				`UPDATE cron_specs SET next_run_at = ?, updated_at = ? WHERE spec_id = ?`,
			)
			.run(nextRunAt ?? null, nowIso(), specId);
	}

	public updateSpecLastRunAt(specId: string, lastRunAt: string): void {
		this.db
			.prepare(
				`UPDATE cron_specs SET last_run_at = ?, updated_at = ? WHERE spec_id = ?`,
			)
			.run(lastRunAt, nowIso(), specId);
	}

	public updateLastMaterializedRunId(specId: string, runId: string): void {
		this.db
			.prepare(
				`UPDATE cron_specs SET last_materialized_run_id = ?, updated_at = ? WHERE spec_id = ?`,
			)
			.run(runId, nowIso(), specId);
	}

	private initializeScheduleNextRun(specId: string): void {
		const spec = this.getSpec(specId);
		if (
			!spec ||
			spec.triggerKind !== "schedule" ||
			!spec.enabled ||
			!spec.scheduleExpr
		) {
			this.updateSpecNextRunAt(specId, undefined);
			return;
		}
		const nextRunAt = new Date(
			getNextCronTime(spec.scheduleExpr, Date.now(), spec.timezone),
		).toISOString();
		this.updateSpecNextRunAt(specId, nextRunAt);
	}

	public materializeDueScheduleRun(options: {
		specId: string;
		nowMs: number;
	}): MaterializeScheduleRunResult {
		const nowMs = options.nowMs;
		const now = new Date(nowMs).toISOString();
		this.db.exec("BEGIN IMMEDIATE;");
		try {
			const row = this.db
				.prepare("SELECT * FROM cron_specs WHERE spec_id = ?")
				.get(options.specId);
			if (!row) {
				this.db.exec("COMMIT;");
				return { queued: false };
			}
			const spec = specToRecord(row);
			if (
				spec.triggerKind !== "schedule" ||
				!spec.enabled ||
				spec.removed ||
				spec.parseStatus !== "valid" ||
				!spec.scheduleExpr
			) {
				this.db.exec("COMMIT;");
				return { queued: false };
			}

			const dueAt = spec.nextRunAt;
			if (!dueAt) {
				const initializedNext = new Date(
					getNextCronTime(spec.scheduleExpr, nowMs, spec.timezone),
				).toISOString();
				this.db
					.prepare(
						`UPDATE cron_specs SET next_run_at = ?, updated_at = ? WHERE spec_id = ?`,
					)
					.run(initializedNext, now, spec.specId);
				this.db.exec("COMMIT;");
				return { queued: false, nextRunAt: initializedNext };
			}

			if (new Date(dueAt).getTime() > nowMs) {
				this.db.exec("COMMIT;");
				return { queued: false, nextRunAt: dueAt };
			}

			const runId = `crun_${randomUUID()}`;
			let nextRunAt: string | undefined;
			try {
				nextRunAt = new Date(
					getNextCronTime(spec.scheduleExpr, nowMs, spec.timezone),
				).toISOString();
			} catch {
				nextRunAt = undefined;
			}

			this.db
				.prepare(
					`INSERT INTO cron_runs (
						run_id, spec_id, spec_revision, trigger_kind, status,
						scheduled_for, trigger_event_id, attempt_count,
						created_at, updated_at
					) VALUES (?,?,?,?,?, ?,?,?, ?,?)`,
				)
				.run(
					runId,
					spec.specId,
					spec.revision,
					"schedule",
					"queued",
					dueAt,
					null,
					0,
					now,
					now,
				);
			this.db
				.prepare(
					`UPDATE cron_specs SET
						last_materialized_run_id = ?,
						last_run_at = ?,
						next_run_at = ?,
						updated_at = ?
					WHERE spec_id = ?`,
				)
				.run(runId, now, nextRunAt ?? null, now, spec.specId);
			this.db.exec("COMMIT;");
			return {
				queued: true,
				run: this.getRun(runId),
				nextRunAt,
			};
		} catch (err) {
			this.db.exec("ROLLBACK;");
			throw err;
		}
	}

	public getRun(runId: string): CronRunRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM cron_runs WHERE run_id = ?")
			.get(runId);
		return row ? runToRecord(row) : undefined;
	}

	public insertEventLog(
		event: AutomationEventEnvelope,
		options: { receivedAtIso?: string } = {},
	): InsertEventLogResult {
		const now = nowIso();
		const receivedAt = options.receivedAtIso ?? now;
		const eventId = event.eventId.trim();
		if (!eventId) {
			throw new Error("automation event requires eventId");
		}
		const eventType = event.eventType.trim();
		if (!eventType) {
			throw new Error("automation event requires eventType");
		}
		const source = event.source.trim();
		if (!source) {
			throw new Error("automation event requires source");
		}
		const occurredAt = event.occurredAt.trim() || receivedAt;
		const changes =
			this.db
				.prepare(
					`INSERT OR IGNORE INTO cron_event_log (
						event_id, event_type, source, subject,
						occurred_at, received_at, workspace_root, dedupe_key,
						payload_json, attributes_json, processing_status,
						matched_spec_count, queued_run_count, suppressed_count,
						error, created_at, updated_at
					) VALUES (?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?, ?,?,?)`,
				)
				.run(
					eventId,
					eventType,
					source,
					event.subject?.trim() || null,
					occurredAt,
					receivedAt,
					event.workspaceRoot?.trim() || null,
					event.dedupeKey?.trim() || null,
					jsonOrNull(event.payload),
					jsonOrNull(event.attributes),
					"received",
					0,
					0,
					0,
					null,
					now,
					now,
				).changes ?? 0;
		const record = this.getEventLog(eventId);
		if (!record) throw new Error("failed to insert cron_event_log row");
		return { record, created: changes === 1 };
	}

	public getEventLog(eventId: string): CronEventLogRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM cron_event_log WHERE event_id = ?")
			.get(eventId);
		return row ? eventLogToRecord(row) : undefined;
	}

	public listEventLogs(
		options: ListEventLogsOptions = {},
	): CronEventLogRecord[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.eventType) {
			where.push("event_type = ?");
			params.push(options.eventType);
		}
		if (options.source) {
			where.push("source = ?");
			params.push(options.source);
		}
		if (options.processingStatus) {
			where.push("processing_status = ?");
			params.push(options.processingStatus);
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit = Math.max(1, Math.floor(options.limit ?? 200));
		const rows = this.db
			.prepare(
				`SELECT * FROM cron_event_log ${whereClause}
					ORDER BY received_at DESC, created_at DESC
					LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => eventLogToRecord(row));
	}

	public updateEventLogProcessing(
		eventId: string,
		update: {
			status: CronEventProcessingStatus;
			matchedSpecCount?: number;
			queuedRunCount?: number;
			suppressedCount?: number;
			error?: string;
		},
	): boolean {
		const changes =
			this.db
				.prepare(
					`UPDATE cron_event_log SET
						processing_status = ?,
						matched_spec_count = COALESCE(?, matched_spec_count),
						queued_run_count = COALESCE(?, queued_run_count),
						suppressed_count = COALESCE(?, suppressed_count),
						error = ?,
						updated_at = ?
					WHERE event_id = ?`,
				)
				.run(
					update.status,
					update.matchedSpecCount ?? null,
					update.queuedRunCount ?? null,
					update.suppressedCount ?? null,
					update.error ?? null,
					nowIso(),
					eventId,
				).changes ?? 0;
		return changes === 1;
	}

	public listRuns(options: ListRunsOptions = {}): CronRunRecord[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.specId) {
			where.push("spec_id = ?");
			params.push(options.specId);
		}
		if (options.status) {
			const statuses = Array.isArray(options.status)
				? options.status
				: [options.status];
			if (statuses.length > 0) {
				const placeholders = statuses.map(() => "?").join(",");
				where.push(`status IN (${placeholders})`);
				for (const s of statuses) params.push(s);
			}
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit = Math.max(1, Math.floor(options.limit ?? 200));
		const rows = this.db
			.prepare(
				`SELECT * FROM cron_runs ${whereClause} ORDER BY created_at DESC LIMIT ?`,
			)
			.all(...params, limit);
		return rows.map((row) => runToRecord(row));
	}

	public hasRecentEventRunForDedupe(options: {
		specId: string;
		dedupeKey: string;
		sinceIso: string;
	}): boolean {
		const row = this.db
			.prepare(
				`SELECT r.run_id FROM cron_runs r
					INNER JOIN cron_event_log e ON e.event_id = r.trigger_event_id
					WHERE r.spec_id = ?
						AND r.trigger_kind = 'event'
						AND e.dedupe_key = ?
						AND e.received_at >= ?
					LIMIT 1`,
			)
			.get(options.specId, options.dedupeKey, options.sinceIso);
		return !!row;
	}

	public hasRecentEventRunForSpec(options: {
		specId: string;
		sinceIso: string;
	}): boolean {
		const row = this.db
			.prepare(
				`SELECT r.run_id FROM cron_runs r
					INNER JOIN cron_event_log e ON e.event_id = r.trigger_event_id
					WHERE r.spec_id = ?
						AND r.trigger_kind = 'event'
						AND e.received_at >= ?
					LIMIT 1`,
			)
			.get(options.specId, options.sinceIso);
		return !!row;
	}

	public findQueuedEventRunForDedupe(options: {
		specId: string;
		dedupeKey: string;
	}): CronRunRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT r.* FROM cron_runs r
					INNER JOIN cron_event_log e ON e.event_id = r.trigger_event_id
					WHERE r.spec_id = ?
						AND r.trigger_kind = 'event'
						AND r.status = 'queued'
						AND e.dedupe_key = ?
					ORDER BY COALESCE(r.scheduled_for, r.created_at) DESC
					LIMIT 1`,
			)
			.get(options.specId, options.dedupeKey);
		return row ? runToRecord(row) : undefined;
	}

	public updateQueuedEventRunForDebounce(options: {
		runId: string;
		triggerEventId: string;
		scheduledFor: string;
	}): CronRunRecord | undefined {
		const updatedAt = nowIso();
		const changes =
			this.db
				.prepare(
					`UPDATE cron_runs SET
						trigger_event_id = ?,
						scheduled_for = ?,
						updated_at = ?
					WHERE run_id = ?
						AND trigger_kind = 'event'
						AND status = 'queued'`,
				)
				.run(
					options.triggerEventId,
					options.scheduledFor,
					updatedAt,
					options.runId,
				).changes ?? 0;
		if (changes !== 1) return undefined;
		return this.getRun(options.runId);
	}

	public hasOneOffRunForRevision(specId: string, revision: number): boolean {
		const row = this.db
			.prepare(
				`SELECT run_id FROM cron_runs
					WHERE spec_id = ? AND spec_revision = ?
						AND trigger_kind = 'one_off'
					LIMIT 1`,
			)
			.get(specId, revision);
		return !!row;
	}

	public enqueueRun(input: EnqueueRunInput): CronRunRecord {
		const runId = `crun_${randomUUID()}`;
		const now = nowIso();
		this.db
			.prepare(
				`INSERT INTO cron_runs (
					run_id, spec_id, spec_revision, trigger_kind, status,
					scheduled_for, trigger_event_id, attempt_count,
					created_at, updated_at
				) VALUES (?,?,?,?,?, ?,?,?, ?,?)`,
			)
			.run(
				runId,
				input.specId,
				input.specRevision,
				input.triggerKind,
				"queued",
				input.scheduledFor ?? null,
				input.triggerEventId ?? null,
				0,
				now,
				now,
			);
		this.updateLastMaterializedRunId(input.specId, runId);
		const run = this.getRun(runId);
		if (!run) throw new Error("failed to insert cron_run row");
		return run;
	}

	public cancelQueuedRunsForSpec(specId: string): number {
		const changes =
			this.db
				.prepare(
					`UPDATE cron_runs SET status = 'cancelled', updated_at = ?
						WHERE spec_id = ? AND status = 'queued'`,
				)
				.run(nowIso(), specId).changes ?? 0;
		return changes;
	}

	public claimDueRuns(options: ClaimRunOptions): ClaimedCronRun[] {
		const referenceIso = options.nowIso;
		const boundedLease = Math.max(1_000, Math.floor(options.leaseMs));
		const leaseUntilIso = new Date(
			new Date(referenceIso).getTime() + boundedLease,
		).toISOString();
		const limit = Math.max(1, Math.floor(options.limit ?? 25));
		const claimed: ClaimedCronRun[] = [];
		this.db.exec("BEGIN IMMEDIATE;");
		try {
			const rows = this.db
				.prepare(
					`SELECT * FROM cron_runs
						WHERE (
								status = 'queued'
								OR (
									status = 'running'
									AND claim_until_at IS NOT NULL
									AND claim_until_at <= ?
									AND completed_at IS NULL
								)
							)
							AND (scheduled_for IS NULL OR scheduled_for <= ?)
						ORDER BY COALESCE(scheduled_for, created_at) ASC
						LIMIT ?`,
				)
				.all(referenceIso, referenceIso, limit);
			for (const row of rows) {
				const runId = asString(row.run_id);
				if (!runId) continue;
				const claimToken = `cclaim_${randomUUID()}`;
				const changes =
					this.db
						.prepare(
							`UPDATE cron_runs SET
								status = 'running',
								claim_token = ?,
								claim_started_at = ?,
								claim_until_at = ?,
								started_at = ?,
								completed_at = NULL,
								session_id = NULL,
								report_path = NULL,
								error = NULL,
								attempt_count = attempt_count + 1,
								updated_at = ?
							WHERE run_id = ?
								AND (
									status = 'queued'
									OR (
										status = 'running'
										AND claim_until_at IS NOT NULL
										AND claim_until_at <= ?
										AND completed_at IS NULL
									)
								)`,
						)
						.run(
							claimToken,
							referenceIso,
							leaseUntilIso,
							referenceIso,
							referenceIso,
							runId,
							referenceIso,
						).changes ?? 0;
				if (changes !== 1) continue;
				const run = this.getRun(runId);
				if (!run) continue;
				claimed.push({ run, claimToken, claimUntilAt: leaseUntilIso });
			}
			this.db.exec("COMMIT;");
		} catch (err) {
			this.db.exec("ROLLBACK;");
			throw err;
		}
		return claimed;
	}

	public renewClaim(
		runId: string,
		claimToken: string,
		leaseUntilAt: string,
	): boolean {
		const changes =
			this.db
				.prepare(
					`UPDATE cron_runs SET claim_until_at = ?, updated_at = ?
						WHERE run_id = ? AND claim_token = ?`,
				)
				.run(leaseUntilAt, nowIso(), runId, claimToken).changes ?? 0;
		return changes === 1;
	}

	public completeRun(
		runId: string,
		update: {
			status: "done" | "failed" | "cancelled";
			sessionId?: string;
			reportPath?: string;
			error?: string;
			completedAtIso?: string;
			claimToken?: string;
		},
	): boolean {
		const completedAt = update.completedAtIso ?? nowIso();
		const whereClause = update.claimToken
			? "WHERE run_id = ? AND claim_token = ?"
			: "WHERE run_id = ?";
		const changes =
			this.db
				.prepare(
					`UPDATE cron_runs SET
						status = ?,
						session_id = COALESCE(?, session_id),
						report_path = COALESCE(?, report_path),
						error = ?,
						completed_at = ?,
						claim_started_at = NULL,
						claim_token = NULL,
						claim_until_at = NULL,
						updated_at = ?
					${whereClause}`,
				)
				.run(
					update.status,
					update.sessionId ?? null,
					update.reportPath ?? null,
					update.error ?? null,
					completedAt,
					completedAt,
					runId,
					...(update.claimToken ? [update.claimToken] : []),
				).changes ?? 0;
		return changes > 0;
	}

	public requeueRun(
		update: ClaimBoundUpdate & {
			error?: string;
			scheduledFor?: string;
		},
	): boolean {
		const updatedAt = nowIso();
		const changes =
			this.db
				.prepare(
					`UPDATE cron_runs SET
						status = 'queued',
						claim_started_at = NULL,
						claim_token = NULL,
						claim_until_at = NULL,
						started_at = NULL,
						completed_at = NULL,
						session_id = NULL,
						report_path = NULL,
						error = ?,
						scheduled_for = COALESCE(?, scheduled_for),
						updated_at = ?
					WHERE run_id = ? AND claim_token = ?`,
				)
				.run(
					update.error ?? null,
					update.scheduledFor ?? null,
					updatedAt,
					update.runId,
					update.claimToken,
				).changes ?? 0;
		return changes > 0;
	}

	public attachSessionIdToRun(runId: string, sessionId: string): void {
		this.db
			.prepare(
				`UPDATE cron_runs SET session_id = ?, updated_at = ? WHERE run_id = ?`,
			)
			.run(sessionId, nowIso(), runId);
	}

	public attachReportPathToRun(runId: string, reportPath: string): void {
		this.db
			.prepare(
				`UPDATE cron_runs SET report_path = ?, updated_at = ? WHERE run_id = ?`,
			)
			.run(reportPath, nowIso(), runId);
	}
}
