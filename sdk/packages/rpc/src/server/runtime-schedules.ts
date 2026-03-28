import type {
	CreateScheduleInput,
	SchedulerService,
	UpdateScheduleInput,
} from "@clinebot/scheduler";
import { fromProtoStruct } from "../proto/serde";
import {
	parseJsonArrayString,
	safeString,
	scheduleExecutionToMessage,
	scheduleToMessage,
} from "./helpers";
import type {
	CreateScheduleRequest,
	CreateScheduleResponse,
	DeleteScheduleRequest,
	DeleteScheduleResponse,
	GetActiveScheduledExecutionsRequest,
	GetActiveScheduledExecutionsResponse,
	GetScheduleRequest,
	GetScheduleResponse,
	GetScheduleStatsRequest,
	GetScheduleStatsResponse,
	GetUpcomingScheduledRunsRequest,
	GetUpcomingScheduledRunsResponse,
	ListScheduleExecutionsRequest,
	ListScheduleExecutionsResponse,
	ListSchedulesRequest,
	ListSchedulesResponse,
	PauseScheduleRequest,
	PauseScheduleResponse,
	ProtoActiveScheduledExecution,
	ProtoUpcomingScheduledRun,
	ResumeScheduleRequest,
	ResumeScheduleResponse,
	TriggerScheduleNowRequest,
	TriggerScheduleNowResponse,
	UpdateScheduleRequest,
	UpdateScheduleResponse,
} from "./proto-types";

export class RuntimeScheduleService {
	constructor(private readonly scheduler?: SchedulerService) {}

	public createSchedule(
		request: CreateScheduleRequest,
	): CreateScheduleResponse {
		const scheduler = this.requireScheduler();
		const input: CreateScheduleInput = {
			name: safeString(request.name).trim(),
			cronPattern: safeString(request.cronPattern).trim(),
			prompt: safeString(request.prompt),
			provider: safeString(request.provider).trim(),
			model: safeString(request.model).trim(),
			mode: safeString(request.mode).trim() === "plan" ? "plan" : "act",
			workspaceRoot: safeString(request.workspaceRoot).trim() || undefined,
			cwd: safeString(request.cwd).trim() || undefined,
			systemPrompt: safeString(request.systemPrompt) || undefined,
			maxIterations: request.hasMaxIterations
				? Math.floor(request.maxIterations ?? 0)
				: undefined,
			timeoutSeconds: request.hasTimeoutSeconds
				? Math.floor(request.timeoutSeconds ?? 0)
				: undefined,
			maxParallel:
				typeof request.maxParallel === "number" && request.maxParallel > 0
					? Math.floor(request.maxParallel)
					: 1,
			enabled: request.enabled !== false,
			createdBy: safeString(request.createdBy).trim() || undefined,
			tags: parseJsonArrayString(safeString(request.tagsJson)),
			metadata: fromProtoStruct(request.metadata),
		};
		if (
			!input.name ||
			!input.cronPattern ||
			!input.prompt.trim() ||
			!input.provider ||
			!input.model
		) {
			throw new Error(
				"name, cronPattern, prompt, provider, and model are required",
			);
		}
		const created = scheduler.createSchedule(input);
		return { schedule: scheduleToMessage(created) };
	}

	public getSchedule(request: GetScheduleRequest): GetScheduleResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const schedule = scheduler.getSchedule(scheduleId);
		return schedule ? { schedule: scheduleToMessage(schedule) } : {};
	}

	public listSchedules(request: ListSchedulesRequest): ListSchedulesResponse {
		const scheduler = this.requireScheduler();
		const schedules = scheduler.listSchedules({
			enabled: request.hasEnabled ? request.enabled === true : undefined,
			limit:
				typeof request.limit === "number" && request.limit > 0
					? Math.floor(request.limit)
					: undefined,
			tags: parseJsonArrayString(safeString(request.tagsJson)),
		});
		return {
			schedules: schedules.map((item) => scheduleToMessage(item)),
		};
	}

	public updateSchedule(
		request: UpdateScheduleRequest,
	): UpdateScheduleResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const updates: UpdateScheduleInput = {};
		if (request.hasName) {
			updates.name = safeString(request.name);
		}
		if (request.hasCronPattern) {
			updates.cronPattern = safeString(request.cronPattern);
		}
		if (request.hasPrompt) {
			updates.prompt = safeString(request.prompt);
		}
		if (request.hasProvider) {
			updates.provider = safeString(request.provider);
		}
		if (request.hasModel) {
			updates.model = safeString(request.model);
		}
		if (request.hasMode) {
			updates.mode =
				safeString(request.mode).trim() === "plan" ? "plan" : "act";
		}
		if (request.hasWorkspaceRoot) {
			updates.workspaceRoot = safeString(request.workspaceRoot);
		}
		if (request.hasCwd) {
			updates.cwd = safeString(request.cwd);
		}
		if (request.hasSystemPrompt) {
			updates.systemPrompt = safeString(request.systemPrompt);
		}
		if (request.clearMaxIterations) {
			updates.maxIterations = null;
		} else if (request.hasMaxIterations) {
			updates.maxIterations = Math.floor(request.maxIterations ?? 0);
		}
		if (request.clearTimeoutSeconds) {
			updates.timeoutSeconds = null;
		} else if (request.hasTimeoutSeconds) {
			updates.timeoutSeconds = Math.floor(request.timeoutSeconds ?? 0);
		}
		if (request.hasMaxParallel) {
			updates.maxParallel = Math.floor(request.maxParallel ?? 1);
		}
		if (request.hasEnabled) {
			updates.enabled = request.enabled === true;
		}
		if (request.clearCreatedBy) {
			updates.createdBy = null;
		} else if (request.hasCreatedBy) {
			updates.createdBy = safeString(request.createdBy);
		}
		if (request.hasTagsJson) {
			updates.tags = parseJsonArrayString(safeString(request.tagsJson)) ?? [];
		}
		if (request.hasMetadata) {
			updates.metadata = fromProtoStruct(request.metadata) ?? {};
		}
		const updated = scheduler.updateSchedule(scheduleId, updates);
		return {
			updated: updated !== undefined,
			schedule: updated ? scheduleToMessage(updated) : undefined,
		};
	}

	public deleteSchedule(
		request: DeleteScheduleRequest,
	): DeleteScheduleResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		return { deleted: scheduler.deleteSchedule(scheduleId) };
	}

	public pauseSchedule(request: PauseScheduleRequest): PauseScheduleResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const updated = scheduler.pauseSchedule(scheduleId);
		return {
			updated: updated !== undefined,
			schedule: updated ? scheduleToMessage(updated) : undefined,
		};
	}

	public resumeSchedule(
		request: ResumeScheduleRequest,
	): ResumeScheduleResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const updated = scheduler.resumeSchedule(scheduleId);
		return {
			updated: updated !== undefined,
			schedule: updated ? scheduleToMessage(updated) : undefined,
		};
	}

	public async triggerScheduleNow(
		request: TriggerScheduleNowRequest,
	): Promise<TriggerScheduleNowResponse> {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const execution = await scheduler.triggerScheduleNow(scheduleId);
		return execution
			? {
					execution: scheduleExecutionToMessage(execution),
				}
			: {};
	}

	public listScheduleExecutions(
		request: ListScheduleExecutionsRequest,
	): ListScheduleExecutionsResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim() || undefined;
		const status = safeString(request.status).trim() || undefined;
		const executions = scheduler.listScheduleExecutions({
			scheduleId,
			status:
				status === "pending" ||
				status === "running" ||
				status === "success" ||
				status === "failed" ||
				status === "timeout" ||
				status === "aborted"
					? status
					: undefined,
			limit:
				typeof request.limit === "number" && request.limit > 0
					? Math.floor(request.limit)
					: undefined,
		});
		return {
			executions: executions.map((item) => scheduleExecutionToMessage(item)),
		};
	}

	public getScheduleStats(
		request: GetScheduleStatsRequest,
	): GetScheduleStatsResponse {
		const scheduler = this.requireScheduler();
		const scheduleId = safeString(request.scheduleId).trim();
		if (!scheduleId) {
			throw new Error("scheduleId is required");
		}
		const stats = scheduler.getScheduleStats(scheduleId);
		return {
			totalRuns: stats.totalRuns,
			successRate: stats.successRate,
			avgDurationSeconds: stats.avgDurationSeconds,
			lastFailure: stats.lastFailure
				? scheduleExecutionToMessage(stats.lastFailure)
				: undefined,
		};
	}

	public getActiveScheduledExecutions(
		_request: GetActiveScheduledExecutionsRequest,
	): GetActiveScheduledExecutionsResponse {
		const scheduler = this.requireScheduler();
		const executions: ProtoActiveScheduledExecution[] = scheduler
			.getActiveExecutions()
			.map((item) => ({
				executionId: item.executionId,
				scheduleId: item.scheduleId,
				sessionId: item.sessionId,
				startedAt: item.startedAt,
				timeoutAt: item.timeoutAt ?? "",
			}));
		return { executions };
	}

	public getUpcomingScheduledRuns(
		request: GetUpcomingScheduledRunsRequest,
	): GetUpcomingScheduledRunsResponse {
		const scheduler = this.requireScheduler();
		const limit =
			typeof request.limit === "number" && request.limit > 0
				? Math.floor(request.limit)
				: 20;
		const runs: ProtoUpcomingScheduledRun[] = scheduler
			.getUpcomingRuns(limit)
			.map((item) => ({
				scheduleId: item.scheduleId,
				name: item.name,
				nextRunAt: item.nextRunAt,
			}));
		return { runs };
	}

	private requireScheduler(): SchedulerService {
		if (!this.scheduler) {
			throw new Error("scheduler service is not configured");
		}
		return this.scheduler;
	}
}
