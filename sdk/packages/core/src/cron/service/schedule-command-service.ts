import { realpathSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
	ScheduleRecord,
} from "@cline/shared";
import { createSessionId, readHubScheduleMode } from "@cline/shared";
import type { HubConnectionAuthority } from "../../hub/server/command-transport";
import type { HubScheduleService } from "./schedule-service";

interface ScheduleCommandScope {
	workspaceRoot: string;
	cwd: string;
	crossWorkspace: boolean;
}

/**
 * Cross-workspace access is granted only when the connection authority allows
 * it (token-authenticated clients, which may already bind any workspace at
 * registration time) AND the command explicitly asks for it. Workspace-bound
 * clients (e.g. local browser origins) stay scoped regardless of the payload.
 */
function spansAllWorkspaces(
	envelope: HubCommandEnvelope,
	scope: ScheduleCommandScope,
): boolean {
	return scope.crossWorkspace && envelope.payload?.allWorkspaces === true;
}

function scopedCwd(workspaceRoot: string, value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const cwd = resolve(workspaceRoot, value);
	if (!pathWithin(workspaceRoot, cwd)) {
		throw new Error("schedule cwd is outside the client workspace scope");
	}
	return cwd;
}

function requestedWorkspaceRoot(
	payload: Record<string, unknown>,
): string | undefined {
	return typeof payload.workspaceRoot === "string" &&
		payload.workspaceRoot.trim()
		? resolve(payload.workspaceRoot.trim())
		: undefined;
}

function pathWithin(workspaceRoot: string, candidate: string): boolean {
	const path = relative(workspaceRoot, candidate);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Mirrors the store's default page size for filtered listings. */
const DEFAULT_LIST_LIMIT = 200;

/**
 * Canonicalize a path that may no longer exist: realpath the deepest existing
 * ancestor and reattach the missing remainder, so a removed workspace that was
 * reached through a symlinked ancestor (e.g. `/var` vs `/private/var`) still
 * canonicalizes to the same identity as its stored form.
 */
function canonicalizeThroughExistingAncestor(resolved: string): string {
	let prefix = resolved;
	let suffix = "";
	for (;;) {
		try {
			const canonicalPrefix = realpathSync.native(prefix);
			return suffix ? join(canonicalPrefix, suffix) : canonicalPrefix;
		} catch {
			const parent = dirname(prefix);
			// Even the filesystem root failed to resolve; keep the input.
			if (parent === prefix) return resolved;
			suffix = suffix ? join(basename(prefix), suffix) : basename(prefix);
			prefix = parent;
		}
	}
}

/**
 * Stored workspace roots mix canonical (realpath) and merely resolved forms,
 * so workspace filters compare canonical forms on both sides. Removed
 * workspaces canonicalize through their deepest existing ancestor, and case
 * folds on Windows, where lexically different paths can name the same
 * directory.
 */
function comparableWorkspacePath(value: string): string {
	const canonical = canonicalizeThroughExistingAncestor(resolve(value.trim()));
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

/** Per-request memo so large listings canonicalize each distinct root once. */
function memoizedComparableWorkspacePath(): (value: string) => string {
	const cache = new Map<string, string>();
	return (value) => {
		const cached = cache.get(value);
		if (cached !== undefined) return cached;
		const computed = comparableWorkspacePath(value);
		cache.set(value, computed);
		return computed;
	};
}

function okReply(
	envelope: HubCommandEnvelope,
	payload?: Record<string, unknown>,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: true,
		payload,
	};
}

function errorReply(
	envelope: HubCommandEnvelope,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId ?? createSessionId("hubreq_"),
		ok: false,
		error: { code, message },
	};
}

export class HubScheduleCommandService {
	constructor(private readonly schedules: HubScheduleService) {}

	public async handleCommand(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority,
	): Promise<HubReplyEnvelope> {
		try {
			const scope = this.resolveScope(authority);
			switch (envelope.command) {
				case "schedule.create":
					return okReply(envelope, {
						schedule: this.schedules.createSchedule(
							this.toCreateInput(
								envelope.payload ?? {},
								scope,
								spansAllWorkspaces(envelope, scope),
							),
						),
					});
				case "schedule.list": {
					const enabled =
						typeof envelope.payload?.enabled === "boolean"
							? envelope.payload.enabled
							: undefined;
					const limit =
						typeof envelope.payload?.limit === "number"
							? envelope.payload.limit
							: undefined;
					const tags = Array.isArray(envelope.payload?.tags)
						? (envelope.payload?.tags as string[])
						: undefined;
					const requestedRoot = spansAllWorkspaces(envelope, scope)
						? requestedWorkspaceRoot(envelope.payload ?? {})
						: undefined;
					if (requestedRoot) {
						// Filter before applying the limit — a limited global
						// listing could otherwise truncate away every match for
						// the requested workspace.
						const wanted = comparableWorkspacePath(requestedRoot);
						const comparable = memoizedComparableWorkspacePath();
						return okReply(envelope, {
							schedules: this.schedules
								.listSchedules({
									enabled,
									tags,
									limit: Number.MAX_SAFE_INTEGER,
								})
								.filter(
									(schedule) => comparable(schedule.workspaceRoot) === wanted,
								)
								.slice(0, limit ?? DEFAULT_LIST_LIMIT),
						});
					}
					return okReply(envelope, {
						schedules: this.schedules.listSchedules({
							enabled,
							limit,
							tags,
							workspaceRoot: spansAllWorkspaces(envelope, scope)
								? undefined
								: scope.workspaceRoot,
						}),
					});
				}
				case "schedule.get":
					return okReply(envelope, {
						schedule: this.requireScopedSchedule(envelope, scope),
					});
				case "schedule.update": {
					const current = this.requireScopedSchedule(envelope, scope);
					return okReply(envelope, {
						schedule: this.schedules.updateSchedule(
							current.scheduleId,
							this.toUpdateInput(
								envelope.payload ?? {},
								scope,
								current,
								spansAllWorkspaces(envelope, scope),
							),
						),
					});
				}
				case "schedule.delete":
					return okReply(envelope, {
						deleted: this.schedules.deleteSchedule(
							this.requireScopedSchedule(envelope, scope).scheduleId,
						),
					});
				case "schedule.enable":
					return okReply(envelope, {
						schedule: this.schedules.resumeSchedule(
							this.requireScopedSchedule(envelope, scope).scheduleId,
						),
					});
				case "schedule.disable":
					return okReply(envelope, {
						schedule: this.schedules.pauseSchedule(
							this.requireScopedSchedule(envelope, scope).scheduleId,
						),
					});
				case "schedule.trigger":
					return okReply(envelope, {
						execution:
							envelope.payload?.wait === false
								? this.schedules.triggerScheduleNowDetached(
										this.requireScopedSchedule(envelope, scope).scheduleId,
									)
								: await this.schedules.triggerScheduleNow(
										this.requireScopedSchedule(envelope, scope).scheduleId,
									),
					});
				case "schedule.list_executions":
					return okReply(envelope, {
						executions: this.listScopedExecutions(envelope, scope),
					});
				case "schedule.stats":
					return okReply(envelope, {
						stats: this.schedules.getScheduleStats(
							this.requireScopedSchedule(envelope, scope).scheduleId,
						),
					});
				case "schedule.active": {
					const executions = this.schedules.getActiveExecutions();
					if (spansAllWorkspaces(envelope, scope)) {
						return okReply(envelope, { executions });
					}
					const scheduleIds = this.scopedScheduleIds(scope);
					return okReply(envelope, {
						executions: executions.filter((execution) =>
							scheduleIds.has(execution.scheduleId),
						),
					});
				}
				case "schedule.upcoming": {
					const runs = this.schedules.getUpcomingRuns(
						typeof envelope.payload?.limit === "number"
							? envelope.payload.limit
							: undefined,
					);
					if (spansAllWorkspaces(envelope, scope)) {
						return okReply(envelope, { runs });
					}
					const scheduleIds = this.scopedScheduleIds(scope);
					return okReply(envelope, {
						runs: runs.filter((run) => scheduleIds.has(run.scheduleId)),
					});
				}
				default:
					return errorReply(
						envelope,
						"unsupported_command",
						`Unsupported hub schedule command: ${envelope.command}`,
					);
			}
		} catch (error) {
			return errorReply(
				envelope,
				"schedule_command_failed",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private resolveScope(
		authority: HubConnectionAuthority | undefined,
	): ScheduleCommandScope {
		const context = authority?.workspaceContext;
		if (!authority?.clientId || !context?.workspaceRoot?.trim()) {
			throw new Error(
				"schedule commands require a registered workspace client",
			);
		}
		const workspaceRoot = resolve(context.workspaceRoot);
		const cwd = resolve(context.cwd?.trim() || workspaceRoot);
		if (!pathWithin(workspaceRoot, cwd)) {
			throw new Error("client cwd is outside its workspace scope");
		}
		return {
			workspaceRoot,
			cwd,
			crossWorkspace: authority.crossWorkspace === true,
		};
	}

	private requireScopedSchedule(
		envelope: HubCommandEnvelope,
		scope: ScheduleCommandScope,
	) {
		const scheduleId = String(envelope.payload?.scheduleId ?? "").trim();
		const schedule = scheduleId
			? this.schedules.getSchedule(scheduleId)
			: undefined;
		if (
			!schedule ||
			(!spansAllWorkspaces(envelope, scope) &&
				resolve(schedule.workspaceRoot) !== scope.workspaceRoot)
		) {
			throw new Error("schedule does not exist in this workspace");
		}
		return schedule;
	}

	private scopedScheduleIds(scope: ScheduleCommandScope): Set<string> {
		return new Set(
			this.schedules
				.listSchedules({ workspaceRoot: scope.workspaceRoot })
				.map((schedule) => schedule.scheduleId),
		);
	}

	private listScopedExecutions(
		envelope: HubCommandEnvelope,
		scope: ScheduleCommandScope,
	) {
		const requestedScheduleId =
			typeof envelope.payload?.scheduleId === "string"
				? envelope.payload.scheduleId.trim()
				: undefined;
		if (requestedScheduleId) {
			this.requireScopedSchedule(envelope, scope);
		}
		const executions = this.schedules.listScheduleExecutions({
			scheduleId: requestedScheduleId,
			status:
				typeof envelope.payload?.status === "string"
					? (envelope.payload.status as never)
					: undefined,
			limit:
				typeof envelope.payload?.limit === "number"
					? envelope.payload.limit
					: undefined,
		});
		if (spansAllWorkspaces(envelope, scope)) {
			return executions;
		}
		const scheduleIds = this.scopedScheduleIds(scope);
		return executions.filter((execution) =>
			scheduleIds.has(execution.scheduleId),
		);
	}

	private toCreateInput(
		payload: Record<string, unknown>,
		scope: ScheduleCommandScope,
		allWorkspaces: boolean,
	): HubScheduleCreateInput {
		const mode = readHubScheduleMode(payload, "yolo");
		const modelSelection =
			payload.modelSelection &&
			typeof payload.modelSelection === "object" &&
			!Array.isArray(payload.modelSelection)
				? (payload.modelSelection as HubScheduleCreateInput["modelSelection"])
				: payload.provider && payload.model
					? {
							providerId: String(payload.provider),
							modelId: String(payload.model),
						}
					: undefined;
		const workspaceRoot =
			(allWorkspaces ? requestedWorkspaceRoot(payload) : undefined) ??
			scope.workspaceRoot;
		const { allWorkspaces: _allWorkspaces, ...rest } = payload;
		return {
			...(rest as unknown as HubScheduleCreateInput),
			modelSelection,
			mode,
			workspaceRoot,
			cwd:
				scopedCwd(workspaceRoot, payload.cwd) ??
				(workspaceRoot === scope.workspaceRoot ? scope.cwd : workspaceRoot),
		};
	}

	private toUpdateInput(
		payload: Record<string, unknown>,
		scope: ScheduleCommandScope,
		current: ScheduleRecord,
		allWorkspaces: boolean,
	): HubScheduleUpdateInput {
		const mode = readHubScheduleMode(payload);
		const modelSelection =
			payload.modelSelection &&
			typeof payload.modelSelection === "object" &&
			!Array.isArray(payload.modelSelection)
				? (payload.modelSelection as HubScheduleUpdateInput["modelSelection"])
				: payload.provider || payload.model
					? {
							providerId:
								typeof payload.provider === "string" ? payload.provider : "",
							modelId: typeof payload.model === "string" ? payload.model : "",
						}
					: undefined;
		// Cross-workspace updates keep (or explicitly move) the schedule's own
		// workspace; scoped updates pin it to the connection workspace.
		const workspaceRoot = allWorkspaces
			? (requestedWorkspaceRoot(payload) ?? resolve(current.workspaceRoot))
			: scope.workspaceRoot;
		const { allWorkspaces: _allWorkspaces, ...rest } = payload;
		return {
			...(rest as unknown as HubScheduleUpdateInput),
			modelSelection,
			...(mode === undefined ? {} : { mode }),
			workspaceRoot,
			...(Object.hasOwn(payload, "cwd")
				? {
						cwd:
							payload.cwd === null
								? workspaceRoot
								: (scopedCwd(workspaceRoot, payload.cwd) ??
									(workspaceRoot === scope.workspaceRoot
										? scope.cwd
										: workspaceRoot)),
					}
				: {}),
		};
	}
}
