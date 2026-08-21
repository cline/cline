import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
} from "@cline/shared";
import { createSessionId, readHubScheduleMode } from "@cline/shared";
import type { HubConnectionAuthority } from "../../hub/server/command-transport";
import type { HubScheduleService } from "./schedule-service";

interface ScheduleCommandScope {
	workspaceRoot: string;
	cwd: string;
}

function scopedCwd(
	scope: ScheduleCommandScope,
	value: unknown,
): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const cwd = resolve(scope.workspaceRoot, value);
	if (!pathWithin(scope.workspaceRoot, cwd)) {
		throw new Error("schedule cwd is outside the client workspace scope");
	}
	return cwd;
}

function pathWithin(workspaceRoot: string, candidate: string): boolean {
	const path = relative(workspaceRoot, candidate);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
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
							this.toCreateInput(envelope.payload ?? {}, scope),
						),
					});
				case "schedule.list":
					return okReply(envelope, {
						schedules: this.schedules.listSchedules({
							enabled:
								typeof envelope.payload?.enabled === "boolean"
									? envelope.payload.enabled
									: undefined,
							limit:
								typeof envelope.payload?.limit === "number"
									? envelope.payload.limit
									: undefined,
							tags: Array.isArray(envelope.payload?.tags)
								? (envelope.payload?.tags as string[])
								: undefined,
							workspaceRoot: scope.workspaceRoot,
						}),
					});
				case "schedule.get":
					return okReply(envelope, {
						schedule: this.requireScopedSchedule(envelope, scope),
					});
				case "schedule.update":
					return okReply(envelope, {
						schedule: this.schedules.updateSchedule(
							this.requireScopedSchedule(envelope, scope).scheduleId,
							this.toUpdateInput(envelope.payload ?? {}, scope),
						),
					});
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
					const scheduleIds = this.scopedScheduleIds(scope);
					return okReply(envelope, {
						executions: this.schedules
							.getActiveExecutions()
							.filter((execution) => scheduleIds.has(execution.scheduleId)),
					});
				}
				case "schedule.upcoming": {
					const scheduleIds = this.scopedScheduleIds(scope);
					return okReply(envelope, {
						runs: this.schedules
							.getUpcomingRuns(
								typeof envelope.payload?.limit === "number"
									? envelope.payload.limit
									: undefined,
							)
							.filter((run) => scheduleIds.has(run.scheduleId)),
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
		return { workspaceRoot, cwd };
	}

	private requireScopedSchedule(
		envelope: HubCommandEnvelope,
		scope: ScheduleCommandScope,
	) {
		const scheduleId = String(envelope.payload?.scheduleId ?? "").trim();
		const schedule = scheduleId
			? this.schedules.getSchedule(scheduleId)
			: undefined;
		if (!schedule || resolve(schedule.workspaceRoot) !== scope.workspaceRoot) {
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
		const scheduleIds = this.scopedScheduleIds(scope);
		return this.schedules
			.listScheduleExecutions({
				scheduleId: requestedScheduleId,
				status:
					typeof envelope.payload?.status === "string"
						? (envelope.payload.status as never)
						: undefined,
				limit:
					typeof envelope.payload?.limit === "number"
						? envelope.payload.limit
						: undefined,
			})
			.filter((execution) => scheduleIds.has(execution.scheduleId));
	}

	private toCreateInput(
		payload: Record<string, unknown>,
		scope: ScheduleCommandScope,
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
		return {
			...(payload as unknown as HubScheduleCreateInput),
			modelSelection,
			mode,
			workspaceRoot: scope.workspaceRoot,
			cwd: scopedCwd(scope, payload.cwd) ?? scope.cwd,
		};
	}

	private toUpdateInput(
		payload: Record<string, unknown>,
		scope: ScheduleCommandScope,
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
		return {
			...(payload as unknown as HubScheduleUpdateInput),
			modelSelection,
			...(mode === undefined ? {} : { mode }),
			workspaceRoot: scope.workspaceRoot,
			...(Object.hasOwn(payload, "cwd")
				? {
						cwd:
							payload.cwd === null
								? scope.workspaceRoot
								: (scopedCwd(scope, payload.cwd) ?? scope.cwd),
					}
				: {}),
		};
	}
}
