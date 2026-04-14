import type { ClineGatewayClient } from "../proto/generated/cline/rpc/v1/ClineGateway";
import type { CreateScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/CreateScheduleResponse";
import type { DeleteScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/DeleteScheduleResponse";
import type { GetActiveScheduledExecutionsResponse__Output } from "../proto/generated/cline/rpc/v1/GetActiveScheduledExecutionsResponse";
import type { GetScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/GetScheduleResponse";
import type { GetScheduleStatsResponse__Output } from "../proto/generated/cline/rpc/v1/GetScheduleStatsResponse";
import type { GetUpcomingScheduledRunsResponse__Output } from "../proto/generated/cline/rpc/v1/GetUpcomingScheduledRunsResponse";
import type { ListScheduleExecutionsResponse__Output } from "../proto/generated/cline/rpc/v1/ListScheduleExecutionsResponse";
import type { ListSchedulesResponse__Output } from "../proto/generated/cline/rpc/v1/ListSchedulesResponse";
import type { PauseScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/PauseScheduleResponse";
import type { ResumeScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/ResumeScheduleResponse";
import type { TriggerScheduleNowResponse__Output } from "../proto/generated/cline/rpc/v1/TriggerScheduleNowResponse";
import type { UpcomingScheduledRun__Output } from "../proto/generated/cline/rpc/v1/UpcomingScheduledRun";
import type { UpdateScheduleRequest } from "../proto/generated/cline/rpc/v1/UpdateScheduleRequest";
import type { UpdateScheduleResponse__Output } from "../proto/generated/cline/rpc/v1/UpdateScheduleResponse";
import { toProtoStruct } from "../proto/serde";
import type { RpcScheduleExecution, RpcScheduleRecord } from "../types";
import { fromSchedule, fromScheduleExecution } from "./serde";
import { unary } from "./unary";

export class ScheduleClient {
	constructor(private readonly client: ClineGatewayClient) {}

	async createSchedule(input: {
		name: string;
		cronPattern: string;
		prompt: string;
		provider: string;
		model: string;
		mode?: "act" | "plan" | "yolo";
		workspaceRoot?: string;
		cwd?: string;
		systemPrompt?: string;
		maxIterations?: number;
		timeoutSeconds?: number;
		maxParallel?: number;
		enabled?: boolean;
		createdBy?: string;
		tags?: string[];
		metadata?: Record<string, unknown>;
	}): Promise<RpcScheduleRecord | undefined> {
		const response = await unary<CreateScheduleResponse__Output>((callback) => {
			this.client.CreateSchedule(
				{
					name: input.name,
					cronPattern: input.cronPattern,
					prompt: input.prompt,
					provider: input.provider,
					model: input.model,
					mode: input.mode ?? "act",
					workspaceRoot: input.workspaceRoot,
					cwd: input.cwd,
					systemPrompt: input.systemPrompt,
					maxIterations: input.maxIterations ?? 0,
					hasMaxIterations: typeof input.maxIterations === "number",
					timeoutSeconds: input.timeoutSeconds ?? 0,
					hasTimeoutSeconds: typeof input.timeoutSeconds === "number",
					maxParallel: input.maxParallel ?? 1,
					enabled: input.enabled ?? true,
					createdBy: input.createdBy,
					tagsJson: input.tags ? JSON.stringify(input.tags) : "",
					metadata: toProtoStruct(input.metadata),
				},
				callback,
			);
		});
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	async getSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await unary<GetScheduleResponse__Output>((callback) => {
			this.client.GetSchedule({ scheduleId }, callback);
		});
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	async listSchedules(input?: {
		limit?: number;
		enabled?: boolean;
		tags?: string[];
	}): Promise<RpcScheduleRecord[]> {
		const response = await unary<ListSchedulesResponse__Output>((callback) => {
			this.client.ListSchedules(
				{
					limit: input?.limit ?? 100,
					hasEnabled: typeof input?.enabled === "boolean",
					enabled: input?.enabled ?? false,
					tagsJson: input?.tags ? JSON.stringify(input.tags) : "",
				},
				callback,
			);
		});
		return (response.schedules ?? []).map((s) => fromSchedule(s));
	}

	async updateSchedule(
		scheduleId: string,
		updates: {
			name?: string;
			cronPattern?: string;
			prompt?: string;
			provider?: string;
			model?: string;
			mode?: "act" | "plan" | "yolo";
			workspaceRoot?: string;
			cwd?: string;
			systemPrompt?: string;
			maxIterations?: number | null;
			timeoutSeconds?: number | null;
			maxParallel?: number;
			enabled?: boolean;
			createdBy?: string | null;
			tags?: string[];
			metadata?: Record<string, unknown>;
		},
	): Promise<RpcScheduleRecord | undefined> {
		const request: UpdateScheduleRequest = { scheduleId };
		if (updates.name !== undefined) {
			request.hasName = true;
			request.name = updates.name;
		}
		if (updates.cronPattern !== undefined) {
			request.hasCronPattern = true;
			request.cronPattern = updates.cronPattern;
		}
		if (updates.prompt !== undefined) {
			request.hasPrompt = true;
			request.prompt = updates.prompt;
		}
		if (updates.provider !== undefined) {
			request.hasProvider = true;
			request.provider = updates.provider;
		}
		if (updates.model !== undefined) {
			request.hasModel = true;
			request.model = updates.model;
		}
		if (updates.mode !== undefined) {
			request.hasMode = true;
			request.mode = updates.mode;
		}
		if (updates.workspaceRoot !== undefined) {
			request.hasWorkspaceRoot = true;
			request.workspaceRoot = updates.workspaceRoot;
		}
		if (updates.cwd !== undefined) {
			request.hasCwd = true;
			request.cwd = updates.cwd;
		}
		if (updates.systemPrompt !== undefined) {
			request.hasSystemPrompt = true;
			request.systemPrompt = updates.systemPrompt;
		}
		if (updates.maxIterations === null) {
			request.clearMaxIterations = true;
		} else if (updates.maxIterations !== undefined) {
			request.hasMaxIterations = true;
			request.maxIterations = updates.maxIterations;
		}
		if (updates.timeoutSeconds === null) {
			request.clearTimeoutSeconds = true;
		} else if (updates.timeoutSeconds !== undefined) {
			request.hasTimeoutSeconds = true;
			request.timeoutSeconds = updates.timeoutSeconds;
		}
		if (updates.maxParallel !== undefined) {
			request.hasMaxParallel = true;
			request.maxParallel = updates.maxParallel;
		}
		if (updates.enabled !== undefined) {
			request.hasEnabled = true;
			request.enabled = updates.enabled;
		}
		if (updates.createdBy === null) {
			request.clearCreatedBy = true;
		} else if (updates.createdBy !== undefined) {
			request.hasCreatedBy = true;
			request.createdBy = updates.createdBy;
		}
		if (updates.tags !== undefined) {
			request.hasTagsJson = true;
			request.tagsJson = JSON.stringify(updates.tags);
		}
		if (updates.metadata !== undefined) {
			request.hasMetadata = true;
			request.metadata = toProtoStruct(updates.metadata);
		}

		const response = await unary<UpdateScheduleResponse__Output>((callback) => {
			this.client.UpdateSchedule(request, callback);
		});
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	async deleteSchedule(scheduleId: string): Promise<boolean> {
		const response = await unary<DeleteScheduleResponse__Output>((callback) => {
			this.client.DeleteSchedule({ scheduleId }, callback);
		});
		return response.deleted === true;
	}

	async pauseSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await unary<PauseScheduleResponse__Output>((callback) => {
			this.client.PauseSchedule({ scheduleId }, callback);
		});
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	async resumeSchedule(
		scheduleId: string,
	): Promise<RpcScheduleRecord | undefined> {
		const response = await unary<ResumeScheduleResponse__Output>((callback) => {
			this.client.ResumeSchedule({ scheduleId }, callback);
		});
		return response.schedule ? fromSchedule(response.schedule) : undefined;
	}

	async triggerScheduleNow(
		scheduleId: string,
	): Promise<RpcScheduleExecution | undefined> {
		const response = await unary<TriggerScheduleNowResponse__Output>(
			(callback) => {
				this.client.TriggerScheduleNow({ scheduleId }, callback);
			},
		);
		return response.execution
			? fromScheduleExecution(response.execution)
			: undefined;
	}

	async listScheduleExecutions(input: {
		scheduleId?: string;
		status?: string;
		limit?: number;
	}): Promise<RpcScheduleExecution[]> {
		const response = await unary<ListScheduleExecutionsResponse__Output>(
			(callback) => {
				this.client.ListScheduleExecutions(
					{
						scheduleId: input.scheduleId,
						status: input.status,
						limit: input.limit ?? 50,
					},
					callback,
				);
			},
		);
		return (response.executions ?? []).map((item) =>
			fromScheduleExecution(item),
		);
	}

	async getScheduleStats(scheduleId: string): Promise<{
		totalRuns: number;
		successRate: number;
		avgDurationSeconds: number;
		lastFailure?: RpcScheduleExecution;
	}> {
		const response = await unary<GetScheduleStatsResponse__Output>(
			(callback) => {
				this.client.GetScheduleStats({ scheduleId }, callback);
			},
		);
		return {
			totalRuns: Number(response.totalRuns ?? 0),
			successRate: Number(response.successRate ?? 0),
			avgDurationSeconds: Number(response.avgDurationSeconds ?? 0),
			lastFailure: response.lastFailure
				? fromScheduleExecution(response.lastFailure)
				: undefined,
		};
	}

	async getActiveScheduledExecutions(): Promise<
		Array<{
			executionId: string;
			scheduleId: string;
			sessionId: string;
			startedAt: string;
			timeoutAt?: string;
		}>
	> {
		const response = await unary<GetActiveScheduledExecutionsResponse__Output>(
			(callback) => {
				this.client.GetActiveScheduledExecutions({}, callback);
			},
		);
		return (response.executions ?? []).map((item) => ({
			executionId: item.executionId ?? "",
			scheduleId: item.scheduleId ?? "",
			sessionId: item.sessionId ?? "",
			startedAt: item.startedAt ?? "",
			timeoutAt: item.timeoutAt?.trim() || undefined,
		}));
	}

	async getUpcomingScheduledRuns(
		limit = 20,
	): Promise<Array<{ scheduleId: string; name: string; nextRunAt: string }>> {
		const response = await unary<GetUpcomingScheduledRunsResponse__Output>(
			(callback) => {
				this.client.GetUpcomingScheduledRuns({ limit }, callback);
			},
		);
		return (response.runs ?? []).map((item: UpcomingScheduledRun__Output) => ({
			scheduleId: item.scheduleId ?? "",
			name: item.name ?? "",
			nextRunAt: item.nextRunAt ?? "",
		}));
	}
}
