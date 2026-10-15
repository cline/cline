import type { FSWatcher } from "node:fs";
import { existsSync, realpathSync, statSync, watch } from "node:fs";
import { dirname, join, relative } from "node:path";
import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
	BasicLogger,
	FactoryRunState,
} from "@cline/shared";
import {
	createSessionId,
	DEFAULT_FACTORY_AGENTS,
	factoryCheckSchema,
	factoryTaskConfigSchema,
	noopBasicLogger,
} from "@cline/shared";
import { resolveTasksDbPath } from "@cline/shared/storage";
import { z } from "zod";
import type { AgendaTaskManagerApi } from "./agenda-task-api";
import {
	factoryReviewFindings,
	parseFactoryReview,
	resolveFactoryAgent,
} from "./factory-agents";
import { prepareFactoryWorkspace } from "./factory-local";
import { runFactoryPullRequestFollowup } from "./factory-pull-request";
import { runFactoryWorkflow } from "./factory-workflow";
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
	validateFactoryAgents?(task: AgendaTaskRecord): void;
	startDesignReviewSession?(
		task: AgendaTaskRecord,
		requestedByClientId?: string,
	): Promise<{ sessionId: string }>;
	startDesignSession?(
		task: AgendaTaskRecord,
		requestedByClientId?: string,
	): Promise<{ sessionId: string }>;
	runDesignSession?(
		sessionId: string,
		task: AgendaTaskRecord,
		requestedByClientId?: string,
	): Promise<AgendaTaskRuntimeResult>;
	startSession(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		requestedByClientId?: string,
		options?: {
			unattended: boolean;
			factoryRole?: "builder" | "reviewer" | "designer" | "verifier";
		},
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
	factoryStorageDir?: string;
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
		factory: spec.factory,
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
		factory: task.factory,
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
		factory: spec.factory ?? null,
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
		factory:
			input.factory === null ? undefined : (input.factory ?? current.factory),
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
	private readonly factoryControllers = new Map<
		string,
		{ controller: AbortController; sessions: Set<string> }
	>();
	private readonly factoryStorageDir: string;
	private readonly designSessions = new Map<
		string,
		Promise<{ sessionId: string }>
	>();
	private readonly designControllers = new Map<
		string,
		{ controller: AbortController; sessions: Set<string> }
	>();
	private factoryQueue: Array<{
		taskId: string;
		expectedRevision: number;
		actor: AgendaTaskActor;
		requestedByClientId?: string;
	}> = [];
	private factoryPumping = false;
	private lastFactoryFollowupTaskId?: string;
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
		this.factoryStorageDir =
			options.factoryStorageDir ??
			join(dirname(options.dbPath ?? resolveTasksDbPath()), "factory");
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
			this.queueFactoryFollowup();
		}, MAINTENANCE_INTERVAL_MS);
		this.maintenanceTimer.unref?.();
		this.queueAutomation();
		this.queueFactoryFollowup();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.factoryQueue = [];
		await Promise.allSettled(
			[...this.designSessions.keys()].map((taskId) =>
				this.abortFactoryDesign(taskId, "Hub stopped"),
			),
		);
		for (const active of this.factoryControllers.values()) {
			active.controller.abort(new Error("Hub stopped"));
			await Promise.allSettled(
				[...active.sessions].map((id) =>
					this.runtime.abortSession(id, "Hub stopped"),
				),
			);
		}
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
		const factory = input.factory
			? factoryTaskConfigSchema.parse(input.factory)
			: undefined;
		const normalizedInput: AgendaTaskCreateInput = {
			...input,
			...location,
			factory,
			...(factory ? { requiresApproval: true, automationEligible: false } : {}),
		};
		const taskId =
			optionalTrimmed(normalizedInput.taskId) ?? createSessionId("task_");
		await this.reconcileScope(
			normalizedInput.scope,
			normalizedInput.workspaceRoot,
		);
		if (factory?.sourceIssue) {
			const existing = this.store.findTaskBySourceIssue({
				scope: normalizedInput.scope,
				workspaceRoot: normalizedInput.workspaceRoot,
				source: factory.sourceIssue,
			});
			if (existing) return existing;
		}
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
		const known = this.requireTask(input.taskId);
		// Without watchers there is no background reconciliation, so a spec
		// edited outside the manager would fail the same-store signature check
		// below on every retry. Reconcile first — except when the reconciler
		// itself is applying a spec edit — so an external edit surfaces as a
		// stale-revision conflict the caller can re-read and retry against.
		if (input.updatedBy.id !== FILE_RECONCILER_ACTOR.id) {
			await this.reconcileSourceForProjection(
				known.scope,
				known.workspaceRoot,
				"update",
			);
		}
		const current = this.requireTask(input.taskId);
		if (this.factoryControllers.has(input.taskId))
			throw new Error("Pause feature execution before editing its brief.");
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
		if (input.factory)
			input = {
				...input,
				factory: factoryTaskConfigSchema.parse(input.factory),
			};
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
		this.assertFactoryReady(current);
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
		const factoryActive = this.factoryControllers.get(taskId);
		factoryActive?.controller.abort(new Error(cancellationReason));
		if (factoryActive)
			await Promise.allSettled(
				[...factoryActive.sessions].map((id) =>
					this.runtime.abortSession(id, cancellationReason),
				),
			);
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
		await this.abortFactoryDesign(taskId, cancellationReason);
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
		this.assertFactoryReady(current);
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
		if (current.factory && this.factoryControllers.size > 0)
			throw new Error("A feature workflow is already running");
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
			if (task.factory) {
				const active = {
					controller: new AbortController(),
					sessions: new Set<string>(),
				};
				this.factoryControllers.set(taskId, active);
				const workspace = await prepareFactoryWorkspace({
					sourceRoot: task.workspaceRoot ?? "",
					taskId,
					storageDir: this.factoryStorageDir,
					signal: active.controller.signal,
				});
				active.controller.signal.throwIfAborted();
				run =
					this.store.updateRun(run.runId, {
						factory: {
							phase: "implementing",
							repairRound: 0,
							workspace,
							sessions: [],
						},
					}) ?? run;
			}
			const started = await this.runtime.startSession(
				run.factory
					? {
							...resolveFactoryAgent(
								task,
								task.factory?.agents?.implementer ??
									DEFAULT_FACTORY_AGENTS.implementer,
							),
							cwd: run.factory.workspace.path,
							workspaceRoot: run.factory.workspace.path,
						}
					: task,
				run,
				requestedByClientId,
				{
					factoryRole: task.factory ? "builder" : undefined,
					unattended:
						!task.factory &&
						actor.kind === "automation_policy" &&
						this.store.getAutomationPolicy(
							task.scope === "workspace" && task.workspaceRoot
								? task.workspaceRoot
								: "global",
						).mode === "unattended",
				},
			);
			this.factoryControllers.get(taskId)?.sessions.add(started.sessionId);
			if (run.factory)
				run =
					this.store.updateRun(run.runId, {
						factory: {
							...run.factory,
							sessions: [{ sessionId: started.sessionId, role: "builder" }],
						},
					}) ?? run;
			const latestRun = this.store.getRun(run.runId);
			const latestTask = this.store.getTask(taskId);
			if (
				!latestRun ||
				TERMINAL_RUN_STATUSES.has(latestRun.status) ||
				latestTask?.status !== current.status ||
				latestTask.revision !== run.taskRevision ||
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

	async startFactoryDesign(
		taskId: string,
		requestedByClientId?: string,
	): Promise<{ sessionId: string }> {
		this.assertUsable();
		const task = this.requireTask(taskId);
		if (!task.factory)
			throw new Error("Only feature tasks have a design interview");
		if (!["pending_approval", "approved", "failed"].includes(task.status))
			throw new Error("Design is available before feature execution.");
		if (!this.runtime.startDesignSession)
			throw new Error("Feature design is unavailable");
		const existing = this.designSessions.get(taskId);
		if (existing) return existing;
		this.runtime.validateFactoryAgents?.(task);
		const active = {
			controller: new AbortController(),
			sessions: new Set<string>(),
		};
		this.designControllers.set(taskId, active);
		const creating = this.runtime
			.startDesignSession(
				resolveFactoryAgent(
					task,
					task.factory.agents?.designer ?? DEFAULT_FACTORY_AGENTS.designer,
				),
				requestedByClientId,
			)
			.then(async (session) => {
				active.sessions.add(session.sessionId);
				const current = this.store.getTask(taskId);
				if (
					active.controller.signal.aborted ||
					this.disposed ||
					!current ||
					current.revision !== task.revision ||
					!["pending_approval", "approved", "failed"].includes(current.status)
				) {
					await this.runtime.abortSession(
						session.sessionId,
						"Feature design is no longer current",
					);
					throw new Error(
						"Feature changed before design started. Reopen design for the current brief.",
					);
				}
				const updated = this.store.updateTaskState(taskId, {
					originSessionId: session.sessionId,
				});
				if (updated) this.publish("task.updated", updated);
				if (this.runtime.runDesignSession) {
					const completion = this.finishFactoryDesign(
						task,
						session.sessionId,
						requestedByClientId,
					);
					this.backgroundRuns.add(completion);
					void completion.finally(() => {
						this.backgroundRuns.delete(completion);
						this.designSessions.delete(taskId);
						this.designControllers.delete(taskId);
					});
				}
				return session;
			});
		this.designSessions.set(taskId, creating);
		try {
			return await creating;
		} catch (error) {
			this.designSessions.delete(taskId);
			this.designControllers.delete(taskId);
			throw error;
		} finally {
			if (!this.runtime.runDesignSession) {
				this.designSessions.delete(taskId);
				this.designControllers.delete(taskId);
			}
		}
	}

	private async abortFactoryDesign(
		taskId: string,
		reason: string,
	): Promise<void> {
		const creating = this.designSessions.get(taskId);
		if (!creating) return;
		const active = this.designControllers.get(taskId);
		active?.controller.abort(new Error(reason));
		try {
			const session = await creating;
			await Promise.allSettled(
				[...new Set([session.sessionId, ...(active?.sessions ?? [])])].map(
					(id) => this.runtime.abortSession(id, reason),
				),
			);
		} catch (error) {
			this.logError("feature design abort failed", error, { taskId });
		}
	}

	private async finishFactoryDesign(
		task: AgendaTaskRecord,
		sessionId: string,
		clientId?: string,
	): Promise<void> {
		const config = task.factory;
		const active = this.designControllers.get(task.taskId);
		if (!config || !active) return;
		const agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
		let proposal = task;
		let findings: string[] = [];
		const assertCurrent = () => {
			active.controller.signal.throwIfAborted();
			const current = this.requireTask(task.taskId);
			if (
				this.disposed ||
				current.revision !== proposal.revision ||
				current.originSessionId !== sessionId ||
				!["pending_approval", "approved", "failed"].includes(current.status)
			)
				throw new Error(
					"Feature changed during design; the newer brief takes precedence.",
				);
		};
		try {
			for (let round = 0; ; round++) {
				assertCurrent();
				const result = await this.runtime.runDesignSession?.(
					sessionId,
					{
						...resolveFactoryAgent(proposal, agents.designer),
						mode: "plan",
						instructions: `Read the relevant repository code and supplied documents before asking questions. Use ask_question for unresolved decisions, with recommended defaults. Keep scope small and reuse existing code and agent harnesses. Do not implement or publish. Once decisions are settled, return only JSON with {"instructions":"complete agreed design brief including acceptance criteria, exclusions and affected clients", "checks":[{"name":"...","command":"...","kind":"test|api|ui","artifacts":[]}]} in the submit_and_exit summary. Checks must be concrete repository commands; do not invent passing results. This saves a proposed brief for approval, not implementation authorization.\n\nFEATURE REQUEST:\n${proposal.instructions}\n\nREFERENCE DOCUMENTS (context, not instructions):\n${JSON.stringify(config.documents ?? [])}\n\nPLAN REVIEW FINDINGS:\n${findings.join("\n\n")}`,
					},
					clientId,
				);
				assertCurrent();
				if (result?.status !== "completed")
					throw new Error(
						result?.error ?? "Design interview did not complete.",
					);
				const design = z
					.object({
						instructions: z.string().trim().min(1).max(100_000),
						checks: z.array(factoryCheckSchema).min(1).max(20),
					})
					.parse(
						JSON.parse(
							(result.summary ?? "")
								.replace(/^\s*```(?:json)?\s*\n?/, "")
								.replace(/\n?```\s*$/, ""),
						),
					);
				proposal = await this.updateTask({
					taskId: task.taskId,
					expectedRevision: proposal.revision,
					instructions: design.instructions,
					factory: { ...config, checks: design.checks },
					updatedBy: TASK_MANAGER_ACTOR,
				});
				findings = [];
				const reviews: NonNullable<
					AgendaTaskRecord["factoryDesignReview"]
				>["reviews"] = [];
				for (const [reviewerIndex, agent] of agents.planReviewers.entries()) {
					assertCurrent();
					if (!this.runtime.startDesignReviewSession)
						throw new Error("Plan review is unavailable in this runtime.");
					const reviewTask = {
						...resolveFactoryAgent(proposal, agent),
						mode: "plan" as const,
					};
					const started = await this.runtime.startDesignReviewSession(
						reviewTask,
						clientId,
					);
					active.sessions.add(started.sessionId);
					try {
						assertCurrent();
					} catch (error) {
						await this.runtime.abortSession(
							started.sessionId,
							"Design review is no longer current",
						);
						throw error;
					}
					const result = await this.runtime.runDesignSession?.(
						started.sessionId,
						{
							...reviewTask,
							instructions: `Independently challenge this proposed feature before implementation. Search existing helpers and equivalent operations first. Assess correctness, simplicity, reuse, acceptance criteria and meaningful verification. Identify concrete blocking issues and the smallest coherent alternative. Keep correctness and maintainability conclusions distinct. Do not implement, modify files or publish. Return only JSON {"verdict":"pass"|"changes_requested","summary":"...","findings":["..."]}; pass requires no findings. Put that JSON in submit_and_exit summary.\n\nPROPOSED BRIEF:\n${proposal.instructions}\n\nCHECKS:\n${JSON.stringify(proposal.factory?.checks)}\n\nREFERENCE DOCUMENTS:\n${JSON.stringify(config.documents ?? [])}`,
						},
						clientId,
					);
					assertCurrent();
					if (result?.status !== "completed")
						throw new Error(result?.error ?? "Plan reviewer did not complete.");
					const review = parseFactoryReview(result.summary ?? "");
					reviews.push({ reviewerIndex, sessionId: started.sessionId, review });
					const updated = this.store.updateTaskState(
						task.taskId,
						{ factoryDesignReview: { revision: proposal.revision, reviews } },
						proposal.revision,
					);
					if (updated) this.publish("task.updated", updated);
					findings.push(
						...factoryReviewFindings(review).map(
							(finding) => `Plan reviewer ${reviewerIndex + 1}: ${finding}`,
						),
					);
				}
				if (!findings.length) return;
				if (round >= config.maxRepairRounds)
					throw new Error(
						`Plan repair limit (${config.maxRepairRounds}) reached.\n${findings.join("\n\n")}`,
					);
			}
		} catch (error) {
			if (this.disposed || active.controller.signal.aborted) return;
			const current = this.store.getTask(task.taskId);
			if (
				!current ||
				current.originSessionId !== sessionId ||
				!["pending_approval", "approved", "failed"].includes(current.status)
			)
				return;
			const updated = this.store.updateTaskState(
				task.taskId,
				{
					error:
						current.revision !== proposal.revision
							? "Design was not saved: the feature revision changed during design. Your current brief is unchanged."
							: `Design did not complete: ${error instanceof Error ? error.message : String(error)}`,
				},
				current.revision,
			);
			if (updated) this.publish("task.updated", updated);
		}
	}

	async setFactoryWatch(
		taskId: string,
		enabled: boolean,
		expectedRevision: number,
	): Promise<AgendaTaskRecord> {
		this.assertUsable();
		const task = this.requireTask(taskId);
		this.assertRevision(task, expectedRevision);
		const run = task.lastRunId ? this.store.getRun(task.lastRunId) : undefined;
		const state = run?.factory;
		const candidateCommit =
			state?.candidate?.commit ?? state?.pullRequestWatch?.headCommit;
		if (
			task.status !== "completed" ||
			!task.factory?.watchPullRequest ||
			!run ||
			run.taskRevision !== task.revision ||
			!state?.pullRequestUrl ||
			!state.pullRequestWatch ||
			!candidateCommit
		)
			throw new Error(
				"PR follow-up requires an opted-in, completed feature with a published candidate.",
			);
		const active = this.factoryControllers.get(taskId);
		if (enabled && active)
			throw new Error("PR follow-up is still stopping. Try again shortly.");
		if (!enabled && active) {
			active.controller.abort(new Error("PR follow-up paused"));
			await Promise.allSettled(
				[...active.sessions].map((id) =>
					this.runtime.abortSession(id, "PR follow-up paused"),
				),
			);
		}
		const updated = this.store.updateRun(run.runId, {
			factory: {
				...state,
				phase: enabled ? "watching" : "ready",
				error: undefined,
				pullRequestWatch: {
					...state.pullRequestWatch,
					paused: !enabled,
				},
			},
		});
		this.publish("task.updated", task, updated);
		if (enabled) this.queueFactoryFollowup();
		return task;
	}

	private queueFactoryFollowup(): void {
		if (this.disposed || this.factoryControllers.size > 0) return;
		const tasks = this.store.listTasks({
			statuses: ["completed"],
			includeArchived: true,
			limit: 1000,
		});
		const start =
			tasks.findIndex(
				(task) => task.taskId === this.lastFactoryFollowupTaskId,
			) + 1;
		for (const task of [...tasks.slice(start), ...tasks.slice(0, start)]) {
			if (!task.factory?.watchPullRequest || !task.lastRunId) continue;
			const run = this.store.getRun(task.lastRunId);
			const state = run?.factory;
			if (
				!run ||
				run.taskRevision !== task.revision ||
				!state?.pullRequestWatch ||
				state.pullRequestWatch.paused ||
				state.phase === "blocked"
			)
				continue;
			if (state.phase !== "watching" && !state.pullRequestWatch.pending)
				continue;
			const active = {
				controller: new AbortController(),
				sessions: new Set<string>(),
			};
			this.factoryControllers.set(task.taskId, active);
			this.lastFactoryFollowupTaskId = task.taskId;
			const completion = this.finishFactoryFollowup(task, run, state, active);
			this.backgroundRuns.add(completion);
			void completion.finally(() => this.backgroundRuns.delete(completion));
			break;
		}
	}

	private async finishFactoryFollowup(
		task: AgendaTaskRecord,
		run: AgendaTaskRunRecord,
		state: FactoryRunState,
		active: { controller: AbortController; sessions: Set<string> },
	): Promise<void> {
		const save = (factory: FactoryRunState) => {
			active.controller.signal.throwIfAborted();
			const current = this.store.getTask(task.taskId);
			if (
				!current ||
				current.status !== "completed" ||
				current.lastRunId !== run.runId ||
				current.revision !== run.taskRevision
			)
				throw new Error(
					"PR follow-up no longer belongs to the current feature revision.",
				);
			const updated = this.store.updateRun(run.runId, { factory });
			this.publish("task.updated", current, updated);
		};
		try {
			await runFactoryPullRequestFollowup({
				task,
				run,
				state,
				runtime: this.runtime,
				storageDir: this.factoryStorageDir,
				signal: active.controller.signal,
				save,
				sessionStarted: (id) => active.sessions.add(id),
			});
		} catch (error) {
			if (!active.controller.signal.aborted) {
				const current = this.store.getTask(task.taskId);
				const latest = this.store.getRun(run.runId)?.factory;
				if (
					latest &&
					current?.status === "completed" &&
					current.lastRunId === run.runId &&
					current.revision === run.taskRevision
				)
					save({
						...latest,
						phase: "blocked",
						error: error instanceof Error ? error.message : String(error),
					});
			}
		} finally {
			this.factoryControllers.delete(task.taskId);
			void this.pumpFactoryQueue();
		}
	}

	getTaskRuns(taskId: string): AgendaTaskRunRecord[] {
		this.assertUsable();
		return this.store.listRuns({ taskId, limit: 100 });
	}

	async startFactoryQueue(
		entries: Array<{ taskId: string; expectedRevision: number }>,
		actor: AgendaTaskActor,
		requestedByClientId?: string,
	): Promise<void> {
		this.assertUsable();
		for (const entry of entries) {
			const task = await this.refreshAndVerifyTaskIntent(entry.taskId);
			this.assertRevision(task, entry.expectedRevision);
			if (!task.factory)
				throw new Error("Only feature tasks can enter the factory queue");
			this.assertFactoryReady(task);
			if (
				task.factory.approval === "automatic" &&
				task.status === "pending_approval"
			)
				await this.approveTask(task.taskId, actor, task.revision);
			else if (
				task.approvedRevision !== task.revision ||
				!["approved", "failed"].includes(task.status)
			)
				throw new Error(`Approve ${task.title} before starting the queue`);
		}
		for (const entry of entries) {
			if (!this.factoryQueue.some((queued) => queued.taskId === entry.taskId))
				this.factoryQueue.push({ ...entry, actor, requestedByClientId });
		}
		void this.pumpFactoryQueue();
	}

	stopFactoryQueue(workspaceRoot?: string): void {
		this.factoryQueue = this.factoryQueue.filter(
			(entry) =>
				workspaceRoot !== undefined &&
				this.store.getTask(entry.taskId)?.workspaceRoot !== workspaceRoot,
		);
	}

	private async pumpFactoryQueue(): Promise<void> {
		if (
			this.disposed ||
			this.factoryPumping ||
			this.factoryControllers.size > 0
		)
			return;
		this.factoryPumping = true;
		try {
			while (
				!this.disposed &&
				this.factoryQueue.length &&
				this.factoryControllers.size === 0
			) {
				const next = this.factoryQueue.shift();
				if (!next) break;
				try {
					await this.runTask(
						next.taskId,
						next.actor,
						next.expectedRevision,
						next.requestedByClientId,
					);
				} catch (error) {
					this.logError("feature queue start failed", error, {
						taskId: next.taskId,
					});
				}
			}
		} finally {
			this.factoryPumping = false;
		}
	}

	private assertFactoryReady(task: AgendaTaskRecord): void {
		if (!task.factory) return;
		this.runtime.validateFactoryAgents?.(task);
		const reviewers = task.factory.agents?.planReviewers ?? [];
		if (
			reviewers.length &&
			(task.factoryDesignReview?.revision !== task.revision ||
				reviewers.some((_, index) => {
					const result = task.factoryDesignReview?.reviews.find(
						(review) => review.reviewerIndex === index,
					);
					return !result || factoryReviewFindings(result.review).length > 0;
				}))
		)
			throw new Error(
				"Complete plan review for the current brief before approval. Run the design interview to review it.",
			);
		if (task.factory.execution !== "local")
			throw new Error(
				"Cloud factory execution is not available yet; choose local execution explicitly",
			);
		if (!task.workspaceRoot)
			throw new Error("Feature tasks require a project workspace");
		if (!task.instructions.trim() || task.factory.checks.length === 0)
			throw new Error(
				"Approve a feature brief and at least one verification check before running",
			);
	}

	private updateFactoryRun(
		taskId: string,
		runId: string,
		factory: FactoryRunState,
	): void {
		const task = this.store.getTask(taskId);
		const current = this.store.getRun(runId);
		if (
			!task ||
			task.currentRunId !== runId ||
			!current ||
			TERMINAL_RUN_STATUSES.has(current.status)
		)
			throw new Error("Feature run is no longer active");
		const run = this.store.updateRun(runId, { factory });
		this.publish("task.updated", task, run);
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
			const factoryActive = this.factoryControllers.get(task.taskId);
			const result =
				run.factory && factoryActive
					? await runFactoryWorkflow({
							task,
							run,
							builderSessionId: sessionId,
							state: run.factory,
							runtime: this.runtime,
							storageDir: this.factoryStorageDir,
							signal: factoryActive.controller.signal,
							save: (state) =>
								this.updateFactoryRun(task.taskId, run.runId, state),
							sessionStarted: (id) => factoryActive.sessions.add(id),
						})
					: await this.runtime.runSession(sessionId, task, run);
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
			this.factoryControllers.delete(task.taskId);
			void this.pumpFactoryQueue();
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
		this.factoryControllers.delete(task.taskId);
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
		phase: "startup" | "list" | "read" | "update",
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
		if (expired) {
			this.publish("task.updated", expired);
			void this.abortFactoryDesign(task.taskId, "Feature expired");
		}
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
					if (candidate.factory) continue;
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
