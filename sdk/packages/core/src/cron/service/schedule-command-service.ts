import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import type { HubScheduleService } from "./schedule-service";

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
	): Promise<HubReplyEnvelope> {
		try {
			switch (envelope.command) {
				case "schedule.create":
					return okReply(envelope, {
						schedule: this.schedules.createSchedule(
							this.toCreateInput(envelope.payload ?? {}),
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
						}),
					});
				case "schedule.get":
					return okReply(envelope, {
						schedule: this.schedules.getSchedule(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.update":
					return okReply(envelope, {
						schedule: this.schedules.updateSchedule(
							String(envelope.payload?.scheduleId ?? ""),
							this.toUpdateInput(envelope.payload ?? {}),
						),
					});
				case "schedule.delete":
					return okReply(envelope, {
						deleted: this.schedules.deleteSchedule(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.enable":
					return okReply(envelope, {
						schedule: this.schedules.resumeSchedule(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.disable":
					return okReply(envelope, {
						schedule: this.schedules.pauseSchedule(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.trigger":
					return okReply(envelope, {
						execution: await this.schedules.triggerScheduleNow(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.list_executions":
					return okReply(envelope, {
						executions: this.schedules.listScheduleExecutions({
							scheduleId:
								typeof envelope.payload?.scheduleId === "string"
									? envelope.payload.scheduleId
									: undefined,
							status:
								typeof envelope.payload?.status === "string"
									? (envelope.payload.status as never)
									: undefined,
							limit:
								typeof envelope.payload?.limit === "number"
									? envelope.payload.limit
									: undefined,
						}),
					});
				case "schedule.stats":
					return okReply(envelope, {
						stats: this.schedules.getScheduleStats(
							String(envelope.payload?.scheduleId ?? ""),
						),
					});
				case "schedule.active":
					return okReply(envelope, {
						executions: this.schedules.getActiveExecutions(),
					});
				case "schedule.upcoming":
					return okReply(envelope, {
						runs: this.schedules.getUpcomingRuns(
							typeof envelope.payload?.limit === "number"
								? envelope.payload.limit
								: undefined,
						),
					});
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

	private toCreateInput(
		payload: Record<string, unknown>,
	): HubScheduleCreateInput {
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
		};
	}

	private toUpdateInput(
		payload: Record<string, unknown>,
	): HubScheduleUpdateInput {
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
		};
	}
}
