import { sendHubCommand } from "@clinebot/hub";
import { ensureCliHubServer } from "../../utils/hub-runtime";
import type { CommandIo } from "./types";

export function parseHubAddress(address: string | undefined): {
	host?: string;
	port?: number;
	pathname?: string;
} {
	const trimmed = address?.trim();
	if (!trimmed) {
		return {};
	}
	const [host, portRaw] = trimmed.split(":", 2);
	const port = Number.parseInt(portRaw ?? "", 10);
	return {
		host: host?.trim() || undefined,
		port: Number.isInteger(port) ? port : undefined,
	};
}

export class HubScheduleClient {
	constructor(
		private readonly endpoint: {
			host?: string;
			port?: number;
			pathname?: string;
		},
	) {}

	close(): void {}

	private async command(
		command: string,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const reply = await sendHubCommand(this.endpoint, {
			clientId: "clite-schedule",
			command: command as never,
			payload,
		});
		if (!reply.ok) {
			throw new Error(reply.error?.message ?? `hub command failed: ${command}`);
		}
		return (reply.payload ?? {}) as Record<string, unknown>;
	}

	async getActiveScheduledExecutions() {
		return (await this.command("schedule.active")).executions;
	}

	async createSchedule(payload: Record<string, unknown>) {
		return (await this.command("schedule.create", payload)).schedule;
	}

	async deleteSchedule(scheduleId: string) {
		return (
			(await this.command("schedule.delete", { scheduleId })).deleted === true
		);
	}

	async getSchedule(scheduleId: string) {
		return (await this.command("schedule.get", { scheduleId })).schedule;
	}

	async listScheduleExecutions(payload: Record<string, unknown>) {
		return (await this.command("schedule.list_executions", payload)).executions;
	}

	async listSchedules(payload: Record<string, unknown>) {
		return (await this.command("schedule.list", payload)).schedules;
	}

	async pauseSchedule(scheduleId: string) {
		return (await this.command("schedule.disable", { scheduleId })).schedule;
	}

	async resumeSchedule(scheduleId: string) {
		return (await this.command("schedule.enable", { scheduleId })).schedule;
	}

	async getScheduleStats(scheduleId: string) {
		return (await this.command("schedule.stats", { scheduleId })).stats;
	}

	async triggerScheduleNow(scheduleId: string) {
		return (await this.command("schedule.trigger", { scheduleId })).execution;
	}

	async getUpcomingScheduledRuns(limit: number) {
		return (await this.command("schedule.upcoming", { limit })).runs;
	}

	async updateSchedule(scheduleId: string, payload: Record<string, unknown>) {
		return (
			await this.command("schedule.update", {
				scheduleId,
				...payload,
			})
		).schedule;
	}
}

export async function ensureSchedulerHub(
	address: string | undefined,
	workspaceRoot: string,
	io: CommandIo,
): Promise<{
	ok: boolean;
	client: HubScheduleClient;
}> {
	try {
		const endpoint = parseHubAddress(address);
		await ensureCliHubServer(workspaceRoot, endpoint);
		return {
			ok: true,
			client: new HubScheduleClient(endpoint),
		};
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return {
			ok: false,
			client: new HubScheduleClient({}),
		};
	}
}
