import {
	createLocalHubScheduleRuntimeHandlers,
	HubScheduleCommandService,
	HubScheduleService,
	NodeHubClient,
} from "@cline/core";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
} from "../../utils/hub-runtime";
import type { CommandIo } from "./types";

export class HubScheduleClient {
	private hub: Promise<NodeHubClient> | undefined;

	constructor(
		private readonly url: string,
		private readonly workspaceRoot: string,
		private readonly authToken?: string,
	) {}

	close(): void {
		const hub = this.hub;
		this.hub = undefined;
		void hub?.then((client) => client.close()).catch(() => undefined);
	}

	// Schedule commands are authorized against the workspace bound to the
	// connection's client registration, so all commands must share one
	// registered connection instead of fire-and-forget envelopes.
	private connectedHub(): Promise<NodeHubClient> {
		this.hub ??= (async () => {
			const client = new NodeHubClient({
				url: this.url,
				clientType: "cli-schedule",
				displayName: "Cline CLI scheduler",
				workspaceRoot: this.workspaceRoot,
				cwd: this.workspaceRoot,
				authToken: this.authToken,
			});
			try {
				await client.connect();
			} catch (error) {
				client.close();
				this.hub = undefined;
				throw error;
			}
			return client;
		})();
		return this.hub;
	}

	private async command(
		command: string,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const client = await this.connectedHub();
		const reply = await client.command(command as never, payload);
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

export class LocalScheduleClient {
	private readonly service = new HubScheduleService({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
	private readonly commands = new HubScheduleCommandService(this.service);
	constructor(private readonly workspaceRoot: string) {}

	close(): void {
		void this.service.dispose();
	}

	private async command(
		command: string,
		payload?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const reply = await this.commands.handleCommand(
			{
				version: "v1",
				clientId: "cline-schedule-local",
				command: command as never,
				payload,
			},
			{
				clientId: "cline-schedule-local",
				workspaceContext: {
					workspaceRoot: this.workspaceRoot,
					cwd: this.workspaceRoot,
				},
			},
		);
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
	_io: CommandIo,
): Promise<{
	ok: boolean;
	client: HubScheduleClient;
}> {
	if (!address?.trim()) {
		return {
			ok: true,
			client: new LocalScheduleClient(
				workspaceRoot,
			) as unknown as HubScheduleClient,
		};
	}
	try {
		const requestedEndpoint = parseHubEndpointOverride(address);
		const { url: hubUrl, authToken } = await ensureCliHubServer(
			workspaceRoot,
			requestedEndpoint,
		);
		return {
			ok: true,
			client: new HubScheduleClient(hubUrl, workspaceRoot, authToken),
		};
	} catch (_error) {
		return {
			ok: true,
			client: new LocalScheduleClient(
				workspaceRoot,
			) as unknown as HubScheduleClient,
		};
	}
}
