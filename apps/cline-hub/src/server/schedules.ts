import {
	createLocalHubScheduleRuntimeHandlers,
	HubScheduleCommandService,
	HubScheduleService,
} from "@cline/core";
import { asTrimmedString, toPositiveInt } from "./utils";

let scheduleService: HubScheduleService | undefined;
let scheduleCommands: HubScheduleCommandService | undefined;

function getCommands(): HubScheduleCommandService {
	if (!scheduleService || !scheduleCommands) {
		scheduleService = new HubScheduleService({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		scheduleCommands = new HubScheduleCommandService(scheduleService);
	}
	return scheduleCommands;
}

async function clientCommand(
	hubCommand: string,
	payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const reply = await getCommands().handleCommand({
		version: "v1",
		clientId: "cline-hub-schedules",
		command: hubCommand as never,
		payload,
	});
	if (!reply.ok) {
		throw new Error(
			reply.error?.message ?? `hub command failed: ${hubCommand}`,
		);
	}
	return (reply.payload ?? {}) as Record<string, unknown>;
}

export async function handleRoutineScheduleCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	if (command === "list_routine_schedules") {
		const [schedules, activeExecutions, upcomingRuns] = await Promise.all([
			clientCommand("schedule.list", {
				limit: toPositiveInt(args?.limit) ?? 200,
			}),
			clientCommand("schedule.active"),
			clientCommand("schedule.upcoming", { limit: 30 }),
		]);
		const scheduleRows = Array.isArray(schedules.schedules)
			? schedules.schedules
			: [];
		const lastExecutions = await Promise.all(
			scheduleRows.map(async (schedule) => {
				const scheduleId = asTrimmedString(
					(schedule as Record<string, unknown>).scheduleId,
				);
				if (!scheduleId) return undefined;
				const reply = await clientCommand("schedule.list_executions", {
					scheduleId,
					limit: 1,
				});
				return Array.isArray(reply.executions)
					? reply.executions[0]
					: undefined;
			}),
		);
		return {
			schedules: scheduleRows,
			activeExecutions: activeExecutions.executions ?? [],
			upcomingRuns: upcomingRuns.runs ?? [],
			lastExecutions: lastExecutions.filter(Boolean),
		};
	}

	if (command === "create_routine_schedule") {
		const name = asTrimmedString(args?.name);
		const cronPattern = asTrimmedString(args?.cron_pattern);
		const prompt = asTrimmedString(args?.prompt);
		const routineWorkspaceRoot = asTrimmedString(args?.workspace_root);
		if (!name || !cronPattern || !prompt || !routineWorkspaceRoot) {
			throw new Error(
				"createSchedule requires name, cron_pattern, prompt, and workspace_root",
			);
		}
		const created = await clientCommand("schedule.create", {
			name,
			cronPattern,
			prompt,
			modelSelection: {
				providerId: asTrimmedString(args?.provider) ?? "cline",
				modelId: asTrimmedString(args?.model) ?? "openai/gpt-5.3-codex",
			},
			mode: args?.mode === "plan" ? "plan" : "act",
			workspaceRoot: routineWorkspaceRoot,
			cwd: asTrimmedString(args?.cwd),
			systemPrompt: asTrimmedString(args?.system_prompt),
			maxIterations: toPositiveInt(args?.max_iterations),
			timeoutSeconds: toPositiveInt(args?.timeout_seconds),
			maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
			enabled: args?.enabled !== false,
			tags:
				Array.isArray(args?.tags) && args.tags.length > 0
					? (args.tags as string[])
							.map((v) => v.trim())
							.filter((v) => v.length > 0)
					: undefined,
		});
		return { schedule: created.schedule ?? null };
	}

	const scheduleId = asTrimmedString(args?.schedule_id);
	if (!scheduleId) throw new Error(`${command} requires schedule_id`);
	if (command === "update_routine_schedule") {
		const name = asTrimmedString(args?.name);
		const cronPattern = asTrimmedString(args?.cron_pattern);
		const prompt = asTrimmedString(args?.prompt);
		const routineWorkspaceRoot = asTrimmedString(args?.workspace_root);
		if (!name || !cronPattern || !prompt || !routineWorkspaceRoot) {
			throw new Error(
				"updateSchedule requires schedule_id, name, cron_pattern, prompt, and workspace_root",
			);
		}
		const reply = await clientCommand("schedule.update", {
			scheduleId,
			name,
			cronPattern,
			prompt,
			modelSelection: {
				providerId: asTrimmedString(args?.provider) ?? "cline",
				modelId: asTrimmedString(args?.model) ?? "openai/gpt-5.3-codex",
			},
			mode: args?.mode === "plan" ? "plan" : "act",
			workspaceRoot: routineWorkspaceRoot,
			cwd: asTrimmedString(args?.cwd) ?? null,
			systemPrompt:
				args?.system_prompt === null
					? null
					: asTrimmedString(args?.system_prompt),
			maxIterations:
				args?.max_iterations === null
					? null
					: toPositiveInt(args?.max_iterations),
			timeoutSeconds:
				args?.timeout_seconds === null
					? null
					: toPositiveInt(args?.timeout_seconds),
			maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
			enabled: args?.enabled !== false,
			tags: Array.isArray(args?.tags)
				? (args.tags as string[])
						.map((v) => v.trim())
						.filter((v) => v.length > 0)
				: [],
		});
		return { schedule: reply.schedule ?? null };
	}
	if (command === "pause_routine_schedule") {
		const reply = await clientCommand("schedule.disable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "resume_routine_schedule") {
		const reply = await clientCommand("schedule.enable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "trigger_routine_schedule") {
		const existing = await clientCommand("schedule.get", { scheduleId });
		if (!existing.schedule)
			throw new Error(`schedule not found: ${scheduleId}`);
		const reply = await clientCommand("schedule.trigger", {
			scheduleId,
			wait: false,
		});
		return { execution: reply.execution ?? null };
	}
	if (command === "delete_routine_schedule") {
		const reply = await clientCommand("schedule.delete", { scheduleId });
		return { deleted: reply.deleted === true };
	}
	throw new Error(`unsupported routine schedule command: ${command}`);
}
