import type { FSWatcher } from "node:fs";
import { existsSync, realpathSync, statSync, watch } from "node:fs";
import { relative } from "node:path";
import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
	BasicLogger,
} from "@cline/shared";
import { createSessionId, noopBasicLogger } from "@cline/shared";
import type { AgendaTaskManagerApi } from "./agenda-task-api";
import { AgendaTaskSpecFileStore } from "./specs/task-spec-file-store";
import {
	type AgendaTaskSpec,
	agendaTaskSpecToCreateInput,
} from "./specs/task-spec-parser";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";
import { normalizeAgendaTaskLocation } from "./task-location";

const FILE_RECONCILER_ACTOR: AgendaTaskActor = {
	kind: "system",
	id: "file_reconciler",
};
const TASK_MANAGER_ACTOR: AgendaTaskActor = {
	kind: "system",
	id: "task_manager",
};
const AUTOMATION_ACTOR: AgendaTaskActor = {
	kind: "automation_policy",
	id: "global",
};
const TERMINAL_RUN_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted",
]);
const MAINTENANCE_INTERVAL_MS = 30_000;
const DEFAULT_WATCH_DEBOUNCE_MS = 250;

export type AgendaTaskManagerEventName =
	| "task.created"
	| "task.updated"
	| "task.deleted"
	| "task.run.started"
	| "task.run.completed"
	| "task.run.failed"
	| "task.automation.updated";

export interface AgendaTaskRuntimeResult {
	status: "completed" | "failed" | "cancelled";
	summary?: string;
	error?: string;
}

export interface AgendaTaskRuntime {
	isInteractiveClientAvailable?(): boolean;
	startSession(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		requestedByClientId?: string,
		options?: { unattended: boolean },
	): Promise<{ sessionId: string }>;
	runSession(
		sessionId: string,
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
	): Promise<AgendaTaskRuntimeResult>;
	abortSession(sessionId: string, reason: string): Promise<void>;
}

export interface AgendaTaskManagerOptions {
	runtime: AgendaTaskRuntime;
	store?: SqliteAgendaTaskStore;
	dbPath?: string;
	globalSpecsDir?: string;
	watcherDebounceMs?: number;
	watchFiles?: boolean;
	/**
	 * Set to false to keep the automation pump idle regardless of persisted
	 * automation policies. Policies stay stored untouched and manual approve/run
	 * commands keep working; nothing is auto-approved or auto-started.
	 */
	automationEnabled?: boolean;
	logger?: BasicLogger;
	publish?: (
		event: AgendaTaskManagerEventName,
		payload: Record<string, unknown>,
		sessionId?: string,
	) => void;
}

type WatchedScope = {
	store: AgendaTaskSpecFileStore;
	watcher?: FSWatcher;
	timer?: ReturnType<typeof setTimeout>;
};

function nowIso(): string {
	return new Date().toISOString();
}

function optionalTrimmed(value: string | null | undefined): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertFutureExpiry(expiresAt: string): void {
	const timestamp = Date.parse(expiresAt);
	if (!Number.isFinite(timestamp)) {
		throw new Error("expiresAt must be a valid ISO-8601 timestamp");
	}
	if (timestamp <= Date.now()) {
		throw new Error("expiresAt must be in the future");
	}
}

function isPathInside(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}

function isExistingDirectory(path: string | undefined): path is string {
	if (!path || !existsSync(path)) return false;
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function specSignature(
	spec: AgendaTaskSpec,
	current: AgendaTaskRecord,
): string {
	return JSON.stringify({
		type: spec.type,
		title: spec.title,
		description: spec.description,
		instructions: spec.instructions,
		scope: spec.scope,
		workspaceRoot: spec.workspaceRoot,
		cwd: spec.cwd,
		resourcePaths: spec.resourcePaths,
		priority: spec.priority,
		assignee: spec.assignee,
		modelSelection: spec.modelSelection,
		mode: spec.mode,
		systemPrompt: spec.systemPrompt,
		maxIterations: spec.maxIterations,
		timeoutSeconds: spec.timeoutSeconds,
		availableAt: spec.availableAt ?? current.availableAt,
		expiresAt: spec.expiresAt,
		automationEligible: spec.automationEligible,
	});
}

function taskSignature(task: AgendaTaskRecord): string {
	return JSON.stringify({
		type: task.type,
		title: task.title,
		description: task.description,
		instructions: task.instructions,
		scope: task.scope,
		workspaceRoot: task.workspaceRoot,
		cwd: task.cwd,
		resourcePaths: task.resourcePaths,
		priority: task.priority,
		assignee: task.assignee,
		modelSelection: task.modelSelection,
		mode: task.mode,
		systemPrompt: task.systemPrompt,
		maxIterations: task.maxIterations,
		timeoutSeconds: task.timeoutSeconds,
		availableAt: task.availableAt,
		expiresAt: task.expiresAt,
		automationEligible: task.automationEligible,
	});
}

function specUpdate(
	spec: AgendaTaskSpec,
	current: AgendaTaskRecord,
): AgendaTaskUpdateInput {
	return {
		taskId: current.taskId,
		expectedRevision: current.revision,
		type: spec.type,
		title: spec.title,
		description: spec.description ?? null,
		instructions: spec.instructions,
		scope: spec.scope,
		workspaceRoot: spec.workspaceRoot ?? null,
		cwd: spec.cwd ?? null,
		resourcePaths: spec.resourcePaths,
		priority: spec.priority,
		assignee: spec.assignee ?? null,
		modelSelection: spec.modelSelection ?? null,
		mode: spec.mode ?? null,
		systemPrompt: spec.systemPrompt ?? null,
		maxIterations: spec.maxIterations ?? null,
		timeoutSeconds: spec.timeoutSeconds ?? null,
		availableAt: spec.availableAt ?? current.availableAt,
		expiresAt: spec.expiresAt,
		automationEligible: spec.automationEligible,
		updatedBy: FILE_RECONCILER_ACTOR,
	};
}

function mergedEditableTask(
	current: AgendaTaskRecord,
	input: AgendaTaskUpdateInput,
): AgendaTaskRecord {
	return {
		...current,
		type: input.type ?? current.type,
		title: input.title ?? current.title,
		description:
			input.description === null
				? undefined
				: (input.description ?? current.description),
		instructions: input.instructions ?? current.instructions,
		scope: input.scope ?? current.scope,
		workspaceRoot:
			input.workspaceRoot === null
				? undefined
				: (input.workspaceRoot ?? current.workspaceRoot),
		cwd: input.cwd === null ? undefined : (input.cwd ?? current.cwd),
		resourcePaths: input.resourcePaths ?? current.resourcePaths,
		priority: input.priority ?? current.priority,
		assignee:
			input.assignee === null
				? undefined
				: (input.assignee ?? current.assignee),
		modelSelection:
			input.modelSelection === null
				? undefined
				: (input.modelSelection ?? current.modelSelection),
		mode: input.mode === null ? undefined : (input.mode ?? current.mode),
		systemPrompt:
			input.systemPrompt === null
				? undefined
				: (input.systemPrompt ?? current.systemPrompt),
		maxIterations:
			input.maxIterations === null
				? undefined
				: (input.maxIterations ?? current.maxIterations),
		timeoutSeconds:
			input.timeoutSeconds === null
				? undefined
				: (input.timeoutSeconds ?? current.timeoutSeconds),
		availableAt: input.availableAt ?? current.availableAt,
		expiresAt: input.expiresAt ?? current.expiresAt,
		automationEligible: input.automationEligible ?? current.automationEligible,
	};
}

/** Hub-owned lifecycle coordinator and the only operational task writer. */
export class AgendaTaskManager implements AgendaTaskManagerApi {
	private readonly runtime: AgendaTaskRuntime;
	private readonly store: SqliteAgendaTaskStore;
	private readonly ownsStore: boolean;
	private readonly globalSpecsDir?: string;
	private readonly watcherDebounceMs: number;
	private readonly watchFiles: boolean;
	private readonly logger: BasicLogger;
	private readonly publishEvent: NonNullable<
		AgendaTaskManagerOptions["publish"]
	>;
	private readonly scopes = new Map<string, WatchedScope>();
	private readonly activeRuns = new Map<
		string,
		{ runId: string; sessionId?: string }
	>();
	private readonly backgroundRuns = new Set<Promise<void>>();
	private maintenanceTimer?: ReturnType<typeof setInterval>;
	private readonly queuedAutomationScopes = new Set<string>();
	private readonly automationEnabled: boolean;
	private automationPumping = false;
	private automationPolicyGeneration = 0;
	private started = false;
	private disposed = false;

	constructor(options: AgendaTaskManagerOptions) {
		this.runtime = options.runtime;
		this.ownsStore = !options.store;
		this.store =
			options.store ?? new SqliteAgendaTaskStore({ dbPath: options.dbPath });
		this.globalSpecsDir = options.globalSpecsDir;
		this.watcherDebounceMs = Math.max(
			0,
			options.watcherDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
		);
		this.watchFiles = options.watchFiles !== false;
		this.automationEnabled = options.automationEnabled !== false;
		this.logger = options.logger ?? noopBasicLogger;
		this.publishEvent = options.publish ?? (() => {});
	}

	async start(): Promise<void> {
		if (this.disposed) throw new Error("AgendaTaskManager disposed");
		if (this.started) return;
		this.started = true;
		this.recoverInterruptedRuns();
		await this.reconcileSourceForProjection("global", undefined, "startup");
		for (const workspaceRoot of this.store.listWorkspaceRoots()) {
			if (isExistingDirectory(workspaceRoot)) {
				await this.reconcileSourceForProjection(
					"workspace",
					workspaceRoot,
					"startup",
				);
			}
		}
		this.expireTasks();
		this.maintenanceTimer = setInterval(() => {
			this.expireTasks();
			this.queueAutomation();
		}, MAINTENANCE_INTERVAL_MS);
		this.maintenanceTimer.unref?.();
		this.queueAutomation();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
		for (const scope of this.scopes.values()) {
			if (scope.timer) clearTimeout(scope.timer);
			scope.watcher?.close();
		}
		this.scopes.clear();
		for (const active of this.activeRuns.values()) {
			if (active.sessionId) {
				await this.runtime
					.abortSession(active.sessionId, "Hub task manager stopped")
					.catch(() => {});
			}
		}
		await Promise.allSettled(this.backgroundRuns);
		for (const [taskId, active] of this.activeRuns) {
			this.store.updateRun(active.runId, {
				status: "interrupted",
				completedAt: nowIso(),
				error: "Hub task manager stopped before the run completed.",
			});
			this.store.updateTaskState(taskId, {
				status: "failed",
				currentRunId: null,
				error: "Hub task manager stopped before the run completed.",
				updatedBy: TASK_MANAGER_ACTOR,
			});
		}
		this.activeRuns.clear();
		if (this.ownsStore) this.store.close();
	}

	async createTask(input: AgendaTaskCreateInput): Promise<AgendaTaskRecord> {
		this.assertUsable();
		assertFutureExpiry(input.expiresAt);
		const location = normalizeAgendaTaskLocation(input);
		const normalizedInput: AgendaTaskCreateInput = { ...input, ...location };
		const taskId =
			optionalTrimmed(normalizedInput.taskId) ?? createSessionId("task_");
		await this.reconcileScope(
			normalizedInput.scope,
			normalizedInput.workspaceRoot,
		);
		if (this.store.getTask(taskId)) {
			throw new Error(`task ${taskId} already exists`);
		}
		const fileStore = this.ensureScope(
			normalizedInput.scope,
			normalizedInput.workspaceRoot,
		);
		const specPath = fileStore.resolveWritePath(
			taskId,
			normalizedInput.specPath,
		);
		if (existsSync(specPath) || this.store.getTaskBySpecPath(specPath)) {
			throw new Error(`task spec already exists: ${specPath}`);
		}
		const task = this.store.createTask({
			...normalizedInput,
			taskId,
			specPath,
		});
		try {
			fileStore.writeSpec(
				{ ...normalizedInput, taskId },
				{ specPath, createOnly: true },
			);
		} catch (error) {
			this.store.deleteTask(taskId);
			throw error;
		}
		this.publish("task.created", task);
		this.expireTask(task);
		this.queueAutomation();
		return this.requireTask(taskId);
	}

	async listTasks(
		input: AgendaTaskListInput = {},
	): Promise<AgendaTaskRecord[]> {
		this.assertUsable();
		if (!input.scope || input.scope === "global") {
			await this.reconcileSourceForProjection("global", undefined, "list");
		}
		if (input.workspaceRoot) {
			if (isExistingDirectory(input.workspaceRoot)) {
				await this.reconcileSourceForProjection(
					"workspace",
					input.workspaceRoot,
					"list",
				);
			}
		} else if (input.scope !== "global") {
			for (const workspaceRoot of this.store.listWorkspaceRoots()) {
				if (isExistingDirectory(workspaceRoot)) {
					await this.reconcileSourceForProjection(
						"workspace",
						workspaceRoot,
						"list",
					);
				}
			}
		}
		this.expireTasks();
		return this.store.listTasks(input);
	}

	async getTask(taskId: string): Promise<AgendaTaskRecord | undefined> {
		this.assertUsable();
		const current = this.store.getTask(taskId.trim());
		if (
			current?.scope === "workspace" &&
			isExistingDirectory(current.workspaceRoot)
		) {
			await this.reconcileSourceForProjection(
				"workspace",
				current.workspaceRoot,
				"read",
			);
		} else if (current?.scope === "global") {
			await this.reconcileSourceForProjection("global", undefined, "read");
		}
		const task = this.store.getTask(taskId.trim());
		if (task) this.expireTask(task);
		return this.store.getTask(taskId.trim());
	}

	async updateTask(input: AgendaTaskUpdateInput): Promise<AgendaTaskRecord> {
		this.assertUsable();
		const current = this.requireTask(input.taskId);
		if (current.revision !== input.expectedRevision) {
			// Let the store produce its canonical conflict error and current record.
			this.store.updateTask(input);
		}
		if (current.status === "in_progress") {
			throw new Error("an in-progress task cannot be edited");
		}
		if (
			current.status === "completed" ||
			current.status === "cancelled" ||
			current.status === "expired"
		) {
			throw new Error(
				`task ${current.taskId} cannot be edited from ${current.status}; create a new task instead`,
			);
		}
		const desired = mergedEditableTask(current, input);
		assertFutureExpiry(desired.expiresAt);
		const location = normalizeAgendaTaskLocation(desired);
		const normalizedDesired = { ...desired, ...location };
		const normalizedInput: AgendaTaskUpdateInput = {
			...input,
			scope: normalizedDesired.scope,
			workspaceRoot: normalizedDesired.workspaceRoot ?? null,
			cwd: normalizedDesired.cwd ?? null,
			resourcePaths: normalizedDesired.resourcePaths,
		};
		const targetStore = this.ensureScope(
			normalizedDesired.scope,
			normalizedDesired.workspaceRoot,
		);
		const staysInSameStore =
			current.specPath !== undefined &&
			isPathInside(targetStore.specsDir, current.specPath);
		if (!staysInSameStore) {
			await this.reconcileFileStore(targetStore);
		}
		const targetSpecPath = targetStore.resolveWritePath(
			current.taskId,
			staysInSameStore ? current.specPath : undefined,
		);
		if (
			targetSpecPath !== current.specPath &&
			(existsSync(targetSpecPath) ||
				this.store.getTaskBySpecPath(targetSpecPath))
		) {
			throw new Error(`task spec already exists: ${targetSpecPath}`);
		}
		let expectedContentHash: string | undefined;
		if (staysInSameStore && current.specPath) {
			const source = targetStore.readSpec(current.specPath);
			if (!source.ok) {
				throw new Error(`task spec is invalid: ${source.error}`);
			}
			if (
				input.updatedBy.id !== FILE_RECONCILER_ACTOR.id &&
				specSignature(source.spec, current) !== taskSignature(current)
			) {
				throw new Error(
					`task spec changed outside the manager; reconcile task ${current.taskId} and retry`,
				);
			}
			expectedContentHash = source.contentHash;
		}
		let spec: AgendaTaskSpec | undefined;
		let updated: AgendaTaskRecord | undefined;
		try {
			spec = targetStore.writeSpec(normalizedDesired, {
				specPath: targetSpecPath,
				expectedContentHash,
				createOnly: !staysInSameStore,
			});
			updated = this.store.updateTask(normalizedInput);
		} catch (error) {
			try {
				if (spec && staysInSameStore && current.specPath) {
					targetStore.writeSpec(current, {
						specPath: current.specPath,
						expectedContentHash: spec.contentHash,
					});
				} else if (spec) {
					targetStore.deleteSpec(targetSpecPath, {
						expectedContentHash: spec.contentHash,
					});
				}
			} catch (cleanupError) {
				this.logError("agenda task update rollback failed", cleanupError, {
					taskId: current.taskId,
					specPath: targetSpecPath,
				});
			}
			throw error;
		}
		if (!updated || !spec) throw new Error(`unknown task: ${input.taskId}`);
		const normalized = this.store.updateTaskState(
			updated.taskId,
			{
				status: "pending_approval",
				approvedRevision: null,
				currentRunId: null,
				specPath: spec.specPath,
				error: null,
				completedAt: null,
				archivedAt: null,
				updatedBy: input.updatedBy,
			},
			updated.revision,
		);
		if (current.specPath && current.specPath !== spec.specPath) {
			this.fileStoreForTask(current).deleteSpec(current.specPath);
		}
		const task = normalized ?? this.requireTask(input.taskId);
		this.publish("task.updated", task);
		this.expireTask(task);
		this.queueAutomation();
		return this.requireTask(input.taskId);
	}

	async approveTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
	): Promise<AgendaTaskRecord> {
		this.assertUsable();
		const current = await this.refreshAndVerifyTaskIntent(taskId);
		this.assertRevision(current, expectedRevision);
		if (this.isExpired(current)) {
			this.expireTask(current);
			throw new Error(`task ${taskId} has expired`);
		}
		if (
			current.status === "approved" &&
			current.approvedRevision === current.revision
		) {
			return current;
		}
		if (current.status !== "pending_approval" && current.status !== "failed") {
			throw new Error(
				`task ${taskId} cannot be approved from ${current.status}`,
			);
		}
		const task = this.store.updateTaskState(
			taskId,
			{
				status: "approved",
				approvedRevision: current.revision,
				error: null,
				updatedBy: actor,
			},
			current.revision,
		);
		if (!task) throw new Error(`unknown task: ${taskId}`);
		this.publish("task.updated", task);
		this.queueAutomation();
		return task;
	}

	async cancelTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
		reason?: string,
	): Promise<AgendaTaskRecord> {
		this.assertUsable();
		const current = this.requireTask(taskId);
		this.assertRevision(current, expectedRevision);
		if (current.status === "cancelled") return current;
		if (current.status === "completed" || current.status === "expired") {
			throw new Error(
				`task ${taskId} cannot be cancelled from ${current.status}`,
			);
		}
		const active = current.currentRunId
			? this.store.getRun(current.currentRunId)
			: undefined;
		const cancellationReason = reason?.trim() || "Agenda task cancelled";
		if (active && !TERMINAL_RUN_STATUSES.has(active.status)) {
			this.store.updateRun(active.runId, {
				status: "cancelled",
				completedAt: nowIso(),
				error: reason?.trim() || undefined,
			});
		}
		this.activeRuns.delete(taskId);
		const task = this.store.updateTaskState(
			taskId,
			{
				status: "cancelled",
				approvedRevision: null,
				currentRunId: null,
				error: reason?.trim() || null,
				updatedBy: actor,
			},
			current.revision,
		);
		if (!task) throw new Error(`unknown task: ${taskId}`);
		this.publish("task.updated", task, active);
		if (active?.sessionId) {
			try {
				await this.runtime.abortSession(active.sessionId, cancellationReason);
			} catch (error) {
				this.logError("agenda task session abort failed", error, {
					taskId,
					runId: active.runId,
					sessionId: active.sessionId,
				});
			}
		}
		return task;
	}

	async runTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
		requestedByClientId?: string,
	): Promise<{ task: AgendaTaskRecord; run?: AgendaTaskRunRecord }> {
		this.assertUsable();
		const current = await this.refreshAndVerifyTaskIntent(taskId);
		this.assertRevision(current, expectedRevision);
		if (this.isExpired(current)) {
			this.expireTask(current);
			throw new Error(`task ${taskId} has expired`);
		}
		if (Date.parse(current.availableAt) > Date.now()) {
			throw new Error(`task ${taskId} is not available yet`);
		}
		if (current.status !== "approved" && current.status !== "failed") {
			throw new Error(`task ${taskId} must be approved before it can run`);
		}
		if (current.approvedRevision !== current.revision) {
			throw new Error(`task ${taskId} approval is stale`);
		}
		if (this.activeRuns.has(taskId) || current.currentRunId) {
			throw new Error(`task ${taskId} already has an active run`);
		}
		let run = this.store.createRun({
			taskId,
			taskRevision: current.revision,
			requestedByClientId,
		});
		let task = this.store.updateTaskState(
			taskId,
			{
				currentRunId: run.runId,
				lastRunId: run.runId,
				error: null,
				completedAt: null,
				updatedBy: actor,
			},
			current.revision,
		);
		if (!task) throw new Error(`unknown task: ${taskId}`);
		this.activeRuns.set(taskId, { runId: run.runId });
		this.publish("task.updated", task, run);
		try {
			const started = await this.runtime.startSession(
				task,
				run,
				requestedByClientId,
				{
					unattended:
						actor.kind === "automation_policy" &&
						this.store.getAutomationPolicy(
							task.scope === "workspace" && task.workspaceRoot
								? task.workspaceRoot
								: "global",
						).mode === "unattended",
				},
			);
			const latestRun = this.store.getRun(run.runId);
			const latestTask = this.store.getTask(taskId);
			if (
				!latestRun ||
				TERMINAL_RUN_STATUSES.has(latestRun.status) ||
				latestTask?.status !== current.status ||
				latestTask.currentRunId !== run.runId
			) {
				if (latestRun && !TERMINAL_RUN_STATUSES.has(latestRun.status)) {
					this.store.updateRun(run.runId, {
						status: "cancelled",
						sessionId: started.sessionId,
						completedAt: nowIso(),
						error:
							"Task changed or was cancelled while its session was starting.",
					});
				} else if (latestRun) {
					this.store.updateRun(run.runId, { sessionId: started.sessionId });
				}
				this.activeRuns.delete(taskId);
				await this.runtime
					.abortSession(
						started.sessionId,
						"Agenda task was cancelled while its session was starting",
					)
					.catch((error) =>
						this.logError("cancelled agenda task session abort failed", error, {
							taskId,
							runId: run.runId,
							sessionId: started.sessionId,
						}),
					);
				throw new Error(
					`task ${taskId} changed or was cancelled while starting`,
				);
			}
			run =
				this.store.updateRun(run.runId, {
					status: "running",
					sessionId: started.sessionId,
					startedAt: nowIso(),
				}) ?? run;
			task =
				this.store.updateTaskState(taskId, {
					status: "in_progress",
					lastSessionId: started.sessionId,
					updatedBy: actor,
				}) ?? task;
			this.activeRuns.set(taskId, {
				runId: run.runId,
				sessionId: started.sessionId,
			});
			this.publish("task.run.started", task, run);
			const completion = this.finishRun(task, run, started.sessionId);
			this.backgroundRuns.add(completion);
			void completion.finally(() => this.backgroundRuns.delete(completion));
			return { task, run };
		} catch (error) {
			await this.finishRunFailure(task, run, error);
			throw error;
		}
	}

	async getAutomationPolicy(
		scopeKey = "global",
	): Promise<AgendaAutomationPolicy> {
		this.assertUsable();
		return this.store.getAutomationPolicy(scopeKey);
	}

	async setAutomationPolicy(
		policy: Omit<AgendaAutomationPolicy, "updatedAt">,
		actor: AgendaTaskActor,
	): Promise<AgendaAutomationPolicy> {
		this.assertUsable();
		const now = nowIso();
		const next = this.store.setAutomationPolicy({
			...policy,
			enabledBy: policy.mode === "manual" ? undefined : actor,
			enabledAt: policy.mode === "manual" ? undefined : now,
		});
		this.automationPolicyGeneration += 1;
		this.publishEvent("task.automation.updated", { policy: next });
		this.queueAutomation(next.scopeKey);
		return next;
	}

	/** Re-evaluate auto-start work after Hub client readiness changes. */
	notifyAutomationReadinessChanged(): void {
		if (!this.disposed) this.queueAutomation();
	}

	private async finishRun(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		sessionId: string,
	): Promise<void> {
		try {
			const result = await this.runtime.runSession(sessionId, task, run);
			const latestRun = this.store.getRun(run.runId);
			if (!latestRun || TERMINAL_RUN_STATUSES.has(latestRun.status)) return;
			if (result.status === "completed") {
				const completedAt = nowIso();
				const finalRun =
					this.store.updateRun(run.runId, {
						status: "completed",
						completedAt,
						resultSummary: result.summary,
						error: null,
					}) ?? latestRun;
				const finalTask =
					this.store.updateTaskState(task.taskId, {
						status: "completed",
						currentRunId: null,
						error: null,
						completedAt,
						updatedBy: TASK_MANAGER_ACTOR,
					}) ?? this.requireTask(task.taskId);
				this.publish("task.run.completed", finalTask, finalRun);
			} else if (result.status === "cancelled") {
				await this.cancelTask(
					task.taskId,
					TASK_MANAGER_ACTOR,
					task.revision,
					result.error || "Task session was cancelled",
				);
			} else {
				await this.finishRunFailure(
					task,
					run,
					new Error(result.error || result.summary || "Task session failed"),
				);
			}
		} catch (error) {
			await this.finishRunFailure(task, run, error);
		} finally {
			this.activeRuns.delete(task.taskId);
			const latest = this.store.getTask(task.taskId);
			const reconciliation =
				latest?.scope === "workspace" && latest.workspaceRoot
					? this.reconcileScope("workspace", latest.workspaceRoot)
					: this.reconcileScope("global");
			void reconciliation.catch((error) =>
				this.logError("post-run agenda task reconciliation failed", error, {
					taskId: task.taskId,
				}),
			);
			this.queueAutomation();
		}
	}

	private async finishRunFailure(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		error: unknown,
	): Promise<void> {
		const latestRun = this.store.getRun(run.runId);
		if (!latestRun || TERMINAL_RUN_STATUSES.has(latestRun.status)) return;
		const message = error instanceof Error ? error.message : String(error);
		const finalRun =
			this.store.updateRun(run.runId, {
				status: "failed",
				completedAt: nowIso(),
				error: message,
			}) ?? latestRun;
		const latestTask = this.store.getTask(task.taskId);
		if (!latestTask || latestTask.status === "cancelled") return;
		if (latestTask.currentRunId !== run.runId) {
			this.activeRuns.delete(task.taskId);
			this.publish("task.run.failed", latestTask, finalRun);
			return;
		}
		const finalTask =
			this.store.updateTaskState(task.taskId, {
				status: "failed",
				currentRunId: null,
				error: message,
				updatedBy: TASK_MANAGER_ACTOR,
			}) ?? latestTask;
		this.activeRuns.delete(task.taskId);
		this.publish("task.run.failed", finalTask, finalRun);
	}

	private ensureScope(
		scope: "global" | "workspace",
		workspaceRoot?: string,
	): AgendaTaskSpecFileStore {
		const root = optionalTrimmed(workspaceRoot);
		if (scope === "workspace" && !root) {
			throw new Error("workspaceRoot is required for workspace task scope");
		}
		if (scope === "workspace" && !isExistingDirectory(root)) {
			throw new Error("workspaceRoot must be an existing directory");
		}
		const key = scope === "global" ? "global" : `workspace:${root}`;
		const existing = this.scopes.get(key);
		if (existing) return existing.store;
		const store = new AgendaTaskSpecFileStore({
			scope,
			workspaceRoot: root,
			taskSpecsDir: scope === "global" ? this.globalSpecsDir : undefined,
		});
		const watched: WatchedScope = { store };
		let cacheScope = true;
		try {
			store.ensureSpecsDir();
			const watchRoot = this.watchFiles
				? this.resolveWatchRoot(store.specsDir)
				: undefined;
			if (watchRoot !== undefined) {
				watched.watcher = watch(watchRoot, (_event, filename) => {
					if (!filename || !String(filename).endsWith(".task.md")) return;
					if (watched.timer) clearTimeout(watched.timer);
					watched.timer = setTimeout(() => {
						watched.timer = undefined;
						void this.reconcileFileStore(store).catch((error) =>
							this.logError(
								"agenda task watcher reconciliation failed",
								error,
								{
									specsDir: store.specsDir,
								},
							),
						);
					}, this.watcherDebounceMs);
				});
				watched.watcher.on("error", (error) =>
					this.logError("agenda task watcher failed", error, {
						specsDir: store.specsDir,
					}),
				);
			}
		} catch (error) {
			cacheScope = false;
			this.logError("agenda task source could not be attached", error, {
				specsDir: store.specsDir,
			});
		}
		if (cacheScope) this.scopes.set(key, watched);
		return store;
	}

	private async reconcileScope(
		scope: "global" | "workspace",
		workspaceRoot?: string,
	): Promise<void> {
		const store = this.ensureScope(scope, workspaceRoot);
		await this.reconcileFileStore(store);
	}

	private async reconcileSourceForProjection(
		scope: "global" | "workspace",
		workspaceRoot: string | undefined,
		phase: "startup" | "list" | "read",
	): Promise<void> {
		try {
			await this.reconcileScope(scope, workspaceRoot);
		} catch (error) {
			this.logError(
				`agenda task source ${phase} reconciliation failed`,
				error,
				{ scope, ...(workspaceRoot ? { workspaceRoot } : {}) },
			);
		}
	}

	private async reconcileFileStore(
		fileStore: AgendaTaskSpecFileStore,
	): Promise<void> {
		if (this.disposed) return;
		const seen = new Set<string>();
		for (const parsed of fileStore.listSpecs()) {
			seen.add(parsed.specPath);
			if (!parsed.ok) {
				this.logger.log("agenda task spec is invalid", {
					severity: "warn",
					specPath: parsed.specPath,
					error: parsed.error,
				});
				continue;
			}
			try {
				let spec = parsed.spec;
				if (!spec.taskId) {
					spec = fileStore.writeSpec(
						{ ...spec, taskId: createSessionId("task_") },
						{
							specPath: spec.specPath,
							expectedContentHash: spec.contentHash,
						},
					);
				}
				const existingByPath = this.store.getTaskBySpecPath(spec.specPath);
				if (
					existingByPath &&
					spec.taskId &&
					spec.taskId !== existingByPath.taskId
				) {
					this.logger.log("agenda task id is immutable for an existing spec", {
						severity: "warn",
						taskId: existingByPath.taskId,
						requestedTaskId: spec.taskId,
						specPath: spec.specPath,
					});
					spec = fileStore.writeSpec(
						{ ...spec, taskId: existingByPath.taskId },
						{
							specPath: spec.specPath,
							expectedContentHash: spec.contentHash,
						},
					);
				}
				const existingById = spec.taskId
					? this.store.getTask(spec.taskId)
					: undefined;
				let existing = existingByPath ?? existingById;
				if (existingById?.specPath && existingById.specPath !== spec.specPath) {
					this.logger.log("agenda task id is already owned by another spec", {
						severity: "warn",
						taskId: spec.taskId,
						specPath: spec.specPath,
					});
					continue;
				}
				if (!existing) {
					const created = this.store.createTask(
						agendaTaskSpecToCreateInput(spec, FILE_RECONCILER_ACTOR),
					);
					this.publish("task.created", created);
					this.expireTask(created);
					continue;
				}
				if (existing.archivedAt) {
					const wasDeletedBeforeStart =
						existing.status === "cancelled" &&
						existing.error === "Task spec was deleted.";
					const restored = this.store.updateTaskState(existing.taskId, {
						status: wasDeletedBeforeStart
							? "pending_approval"
							: existing.status,
						approvedRevision: wasDeletedBeforeStart
							? null
							: existing.approvedRevision,
						archivedAt: null,
						error: wasDeletedBeforeStart ? null : existing.error,
						updatedBy: FILE_RECONCILER_ACTOR,
					});
					if (restored) {
						existing = restored;
						this.publish("task.updated", restored);
					}
				}
				if (specSignature(spec, existing) === taskSignature(existing)) continue;
				if (existing.status === "in_progress") {
					this.logger.log("agenda task edit deferred until its run completes", {
						severity: "warn",
						taskId: existing.taskId,
					});
					continue;
				}
				if (
					existing.status === "completed" ||
					existing.status === "cancelled" ||
					existing.status === "expired"
				) {
					this.logger.log("terminal agenda task edits are not applied", {
						severity: "warn",
						taskId: existing.taskId,
						status: existing.status,
					});
					fileStore.writeSpec(existing, {
						specPath: spec.specPath,
						expectedContentHash: spec.contentHash,
					});
					continue;
				}
				await this.updateTask(specUpdate(spec, existing));
			} catch (error) {
				this.logError("agenda task spec reconciliation failed", error, {
					specPath: parsed.spec.specPath,
				});
			}
		}

		const scopedTasks = this.store.listTasks({
			scope: fileStore.scope,
			workspaceRoot: fileStore.workspaceRoot,
			includeArchived: true,
			limit: 1000,
		});
		for (const task of scopedTasks) {
			if (
				!task.specPath ||
				!isPathInside(fileStore.specsDir, task.specPath) ||
				seen.has(task.specPath) ||
				task.archivedAt
			) {
				continue;
			}
			if (task.status === "in_progress") {
				await this.cancelTask(
					task.taskId,
					FILE_RECONCILER_ACTOR,
					task.revision,
					"Task spec was deleted.",
				);
			}
			const archived = this.store.updateTaskState(task.taskId, {
				status:
					task.status === "completed" || task.status === "expired"
						? task.status
						: "cancelled",
				approvedRevision: null,
				currentRunId: null,
				error:
					task.status === "cancelled"
						? (task.error ?? null)
						: "Task spec was deleted.",
				archivedAt: nowIso(),
				updatedBy: FILE_RECONCILER_ACTOR,
			});
			if (archived) this.publish("task.deleted", archived);
		}
		this.queueAutomation();
	}

	private expireTasks(): void {
		for (const task of this.store.listTasks({ limit: 1000 })) {
			this.expireTask(task);
		}
	}

	private expireTask(task: AgendaTaskRecord): void {
		if (!this.isExpired(task)) return;
		if (
			task.currentRunId ||
			task.status === "in_progress" ||
			task.status === "completed" ||
			task.status === "cancelled" ||
			task.status === "expired"
		) {
			return;
		}
		const expired = this.store.updateTaskState(task.taskId, {
			status: "expired",
			approvedRevision: null,
			currentRunId: null,
			error: "Task expired before it was started.",
			updatedBy: TASK_MANAGER_ACTOR,
		});
		if (expired) this.publish("task.updated", expired);
	}

	private isExpired(task: AgendaTaskRecord): boolean {
		return Date.parse(task.expiresAt) <= Date.now();
	}

	private recoverInterruptedRuns(): void {
		const interruptedAt = nowIso();
		for (const run of this.store.listRuns({
			status: ["starting", "running"],
			limit: 1000,
		})) {
			this.store.updateRun(run.runId, {
				status: "interrupted",
				completedAt: interruptedAt,
				error: "Hub restarted while this task was running.",
			});
			const task = this.store.getTask(run.taskId);
			if (!task || task.currentRunId !== run.runId) continue;
			if (
				task.status === "completed" ||
				task.status === "cancelled" ||
				task.status === "expired"
			) {
				this.store.updateTaskState(task.taskId, { currentRunId: null });
				continue;
			}
			if (
				run.status === "starting" &&
				task.approvedRevision === run.taskRevision &&
				task.revision === run.taskRevision &&
				!this.isExpired(task)
			) {
				this.store.updateTaskState(task.taskId, {
					status: "approved",
					currentRunId: null,
					error: "Hub restarted before this task session was linked.",
					updatedBy: TASK_MANAGER_ACTOR,
				});
				continue;
			}
			this.store.updateTaskState(task.taskId, {
				status: run.status === "starting" ? "pending_approval" : "failed",
				approvedRevision:
					run.status === "starting" ? null : task.approvedRevision,
				currentRunId: null,
				error: "Hub restarted while this task was running.",
				updatedBy: TASK_MANAGER_ACTOR,
			});
		}
	}

	private queueAutomation(scopeKey?: string): void {
		if (this.disposed || !this.automationEnabled) return;
		if (scopeKey) {
			this.queuedAutomationScopes.add(scopeKey);
		} else {
			for (const policy of this.store.listAutomationPolicies()) {
				this.queuedAutomationScopes.add(policy.scopeKey);
			}
		}
		if (this.automationPumping) return;
		queueMicrotask(() => {
			void this.pumpAutomation().catch((error) =>
				this.logError("agenda task automation pump failed", error, {}),
			);
		});
	}

	private async pumpAutomation(): Promise<void> {
		if (this.disposed || this.automationPumping) return;
		this.automationPumping = true;
		const policyGeneration = this.automationPolicyGeneration;
		try {
			while (this.queuedAutomationScopes.size > 0) {
				const scopeKey = this.queuedAutomationScopes.values().next().value;
				if (!scopeKey) break;
				this.queuedAutomationScopes.delete(scopeKey);
				const policy = this.store.getAutomationPolicy(scopeKey);
				if (policy.mode === "manual") continue;
				this.expireTasks();
				const recentStarts = this.store
					.listRuns({ limit: 1000 })
					.filter(
						(run) => Date.parse(run.claimedAt) >= Date.now() - 3_600_000,
					).length;
				let capacity = Math.min(
					Math.max(0, policy.maxConcurrentRuns - this.activeRuns.size),
					Math.max(0, policy.maxStartsPerHour - recentStarts),
				);
				if (capacity <= 0) continue;
				const candidates = this.store.listTasks({
					statuses: ["pending_approval", "approved"],
					...(scopeKey === "global"
						? {}
						: { scope: "workspace" as const, workspaceRoot: scopeKey }),
					automationEligible: true,
					availableBefore: nowIso(),
					limit: 1000,
				});
				for (const candidate of candidates) {
					if (capacity <= 0) break;
					if (policyGeneration !== this.automationPolicyGeneration) return;
					try {
						let runnable = candidate;
						if (runnable.status === "pending_approval") {
							if (!this.canAutomaticallyApprove(runnable, policy)) continue;
							runnable = await this.approveTask(
								runnable.taskId,
								AUTOMATION_ACTOR,
								runnable.revision,
							);
						}
						if (policyGeneration !== this.automationPolicyGeneration) return;
						if (
							policy.mode === "auto_start" &&
							this.runtime.isInteractiveClientAvailable?.() !== true
						) {
							continue;
						}
						await this.runTask(
							runnable.taskId,
							AUTOMATION_ACTOR,
							runnable.revision,
						);
						capacity -= 1;
					} catch (error) {
						this.logError("agenda task automation start failed", error, {
							taskId: candidate.taskId,
						});
					}
				}
			}
		} finally {
			this.automationPumping = false;
			if (this.queuedAutomationScopes.size > 0) {
				this.queueAutomation();
			}
		}
	}

	private canAutomaticallyApprove(
		task: AgendaTaskRecord,
		policy: AgendaAutomationPolicy,
	): boolean {
		const latestIntentActors = [task.createdBy, task.updatedBy];
		if (
			latestIntentActors.some(
				(actor) => actor.kind === "system" && actor.id === "file_reconciler",
			)
		) {
			return false;
		}
		if (
			!policy.applyToAgentCreated &&
			latestIntentActors.some((actor) => actor.kind === "agent")
		) {
			return false;
		}
		return this.taskChainDepth(task) <= policy.maxChainDepth;
	}

	private taskChainDepth(task: AgendaTaskRecord): number {
		let depth = 0;
		let current = task;
		const seen = new Set([task.taskId]);
		while (current.originTaskId) {
			if (seen.has(current.originTaskId)) return Number.POSITIVE_INFINITY;
			seen.add(current.originTaskId);
			const parent = this.store.getTask(current.originTaskId);
			if (!parent) break;
			depth += 1;
			current = parent;
		}
		return depth;
	}

	private fileStoreForTask(task: AgendaTaskRecord): AgendaTaskSpecFileStore {
		return this.ensureScope(task.scope, task.workspaceRoot);
	}

	/**
	 * Approval is bound to the current user-editable Markdown intent, not just
	 * the last SQLite projection. Reconcile synchronously to close the watcher
	 * debounce window, then fail closed if the source is missing, malformed, or
	 * still differs from the projection that will be approved/executed.
	 */
	private async refreshAndVerifyTaskIntent(
		taskId: string,
	): Promise<AgendaTaskRecord> {
		const known = this.requireTask(taskId);
		await this.reconcileScope(known.scope, known.workspaceRoot);
		const current = this.requireTask(taskId);
		if (current.archivedAt) {
			throw new Error(`task ${taskId} no longer has an active task spec`);
		}
		if (!current.specPath) {
			throw new Error(`task ${taskId} has no canonical task spec`);
		}
		let parsed: ReturnType<AgendaTaskSpecFileStore["readSpec"]>;
		try {
			parsed = this.fileStoreForTask(current).readSpec(current.specPath);
		} catch (error) {
			throw new Error(
				`task ${taskId} task spec is unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!parsed.ok) {
			throw new Error(`task ${taskId} task spec is invalid: ${parsed.error}`);
		}
		if (
			parsed.spec.taskId !== current.taskId ||
			specSignature(parsed.spec, current) !== taskSignature(current)
		) {
			throw new Error(
				`task ${taskId} task spec does not match revision ${current.revision}`,
			);
		}
		return current;
	}

	private requireTask(taskId: string): AgendaTaskRecord {
		const normalized = taskId.trim();
		if (!normalized) throw new Error("taskId is required");
		const task = this.store.getTask(normalized);
		if (!task) throw new Error(`unknown task: ${normalized}`);
		return task;
	}

	private assertRevision(
		task: AgendaTaskRecord,
		expectedRevision: number,
	): void {
		if (task.revision !== expectedRevision) {
			throw new Error(
				`task ${task.taskId} is at revision ${task.revision}; the requested revision is stale`,
			);
		}
	}

	private publish(
		event: AgendaTaskManagerEventName,
		task: AgendaTaskRecord,
		run?: AgendaTaskRunRecord,
	): void {
		this.publishEvent(
			event,
			{ task, ...(run ? { run } : {}) },
			run?.sessionId ?? task.lastSessionId,
		);
	}

	/**
	 * fs.watch must be handed the fully resolved form of a path: on Windows,
	 * libuv aborts the entire process (fs-event.c assertion) when the watched
	 * path contains 8.3 short components such as C:\Users\RUNNER~1, because
	 * event filenames come back in long form and fail its prefix check. When
	 * the path cannot be resolved, going without the watcher is safer than
	 * handing libuv the unresolved path.
	 */
	private resolveWatchRoot(specsDir: string): string | undefined {
		try {
			return realpathSync.native(specsDir);
		} catch (error) {
			this.logError(
				"agenda task watcher disabled: specs dir could not be resolved",
				error,
				{ specsDir },
			);
			return undefined;
		}
	}

	private logError(
		message: string,
		error: unknown,
		metadata: Record<string, unknown>,
	): void {
		if (this.logger.error) this.logger.error(message, { ...metadata, error });
		else this.logger.log(message, { ...metadata, error, severity: "error" });
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error("AgendaTaskManager disposed");
	}
}
