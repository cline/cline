import type { Command } from "commander";
import { ensureSchedulerHub } from "./client";
import {
	addAutonomousOptions,
	addDeliveryOptions,
	addSharedOptions,
	emitJsonOrText,
	formatResolvedAddressLabel,
	mergeScheduleMetadata,
	parseJsonObjectFlag,
	parseList,
	resolveAddress,
	toPositiveInt,
} from "./common";
import {
	registerScheduleExportCommand,
	registerScheduleImportCommand,
	registerScheduleUpdateCommand,
} from "./import-export";
import type { CommandIo, ScheduleActionWrapper } from "./types";

export function registerScheduleCommands(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const activeCmd = schedule
		.command("active")
		.description("Show currently active executions");
	addSharedOptions(activeCmd);
	activeCmd.action(
		action(async () => {
			const opts = activeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const active = await client.getActiveScheduledExecutions();
				emitJsonOrText(!!opts.json, io, active);
			} finally {
				client.close();
			}
		}),
	);

	const createCmd = schedule
		.command("create")
		.description("Create a new schedule")
		.argument("<name>", "Schedule name")
		.requiredOption("--cron <pattern>", "Cron pattern")
		.requiredOption("--prompt <text>", "Task prompt")
		.requiredOption("--workspace <path>", "Workspace root path")
		.option("--created-by <name>", "Creator name")
		.option("--cwd <path>", "Working directory")
		.option("--disabled", "Create in disabled state")
		.option("--max-iterations <n>", "Maximum iterations")
		.option("--max-parallel <n>", "Max parallel executions", "1")
		.option("--metadata-json <json>", "Metadata as JSON object")
		.option("--mode <act|plan>", "Execution mode")
		.option("--model <model>", "Model to use", "openai/gpt-5.3-codex")
		.option("--provider <id>", "Provider ID", "cline")
		.option("--system-prompt <text>", "System prompt override")
		.option("--tags <list>", "Comma-separated tags")
		.option("--timeout <seconds>", "Timeout in seconds");
	addDeliveryOptions(createCmd);
	addAutonomousOptions(createCmd);
	addSharedOptions(createCmd);
	createCmd.action(
		action(async (name: string) => {
			const opts = createCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, opts.workspace, io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const metadata = mergeScheduleMetadata(
					parseJsonObjectFlag(opts.metadataJson),
					opts,
				);
				const created = await client.createSchedule({
					name,
					cronPattern: opts.cron,
					prompt: opts.prompt,
					provider: opts.provider,
					model: opts.model,
					mode: opts.mode === "plan" ? "plan" : "act",
					workspaceRoot: opts.workspace,
					cwd: opts.cwd,
					systemPrompt: opts.systemPrompt,
					maxIterations: opts.maxIterations
						? toPositiveInt(opts.maxIterations, 1)
						: undefined,
					timeoutSeconds: opts.timeout
						? toPositiveInt(opts.timeout, 1)
						: undefined,
					maxParallel: toPositiveInt(opts.maxParallel, 1),
					enabled: !opts.disabled,
					createdBy: opts.createdBy,
					tags: parseList(opts.tags),
					metadata,
				});
				if (!created) {
					io.writeErr("failed to create schedule");
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, created);
			} finally {
				client.close();
			}
		}),
	);

	const deleteCmd = schedule
		.command("delete")
		.description("Delete a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(deleteCmd);
	deleteCmd.action(
		action(async (scheduleId: string) => {
			const opts = deleteCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const deleted = await client.deleteSchedule(scheduleId);
				emitJsonOrText(!!opts.json, io, { deleted });
				if (!deleted) fail();
			} finally {
				client.close();
			}
		}),
	);

	const getCmd = schedule
		.command("get")
		.description("Get a schedule by ID")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(getCmd);
	getCmd.action(
		action(async (scheduleId: string) => {
			const opts = getCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.getSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const historyCmd = schedule
		.command("history")
		.description("Show execution history for a schedule")
		.argument("<schedule-id>", "Schedule ID")
		.option("--limit <n>", "Maximum number of results", "20")
		.option("--status <status>", "Filter by execution status");
	addSharedOptions(historyCmd);
	historyCmd.action(
		action(async (scheduleId: string) => {
			const opts = historyCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const executions = await client.listScheduleExecutions({
					scheduleId,
					status: opts.status,
					limit: toPositiveInt(opts.limit, 20),
				});
				emitJsonOrText(!!opts.json, io, executions);
			} finally {
				client.close();
			}
		}),
	);

	const listCmd = schedule
		.command("list")
		.description("List schedules")
		.option("--disabled", "Show only disabled schedules")
		.option("--enabled", "Show only enabled schedules")
		.option("--limit <n>", "Maximum number of results", "100")
		.option("--tags <list>", "Filter by comma-separated tags");
	addSharedOptions(listCmd);
	listCmd.action(
		action(async () => {
			const opts = listCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
				const schedules = await client.listSchedules({
					limit: toPositiveInt(opts.limit, 100),
					enabled,
					tags: parseList(opts.tags),
				});
				if (!opts.json && Array.isArray(schedules) && schedules.length === 0) {
					io.writeln("No schedules found.");
					return;
				}
				emitJsonOrText(!!opts.json, io, schedules);
			} finally {
				client.close();
			}
		}),
	);

	const pauseCmd = schedule
		.command("pause")
		.description("Pause a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(pauseCmd);
	pauseCmd.action(
		action(async (scheduleId: string) => {
			const opts = pauseCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.pauseSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const resumeCmd = schedule
		.command("resume")
		.description("Resume a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(resumeCmd);
	resumeCmd.action(
		action(async (scheduleId: string) => {
			const opts = resumeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.resumeSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const statsCmd = schedule
		.command("stats")
		.description("Show statistics for a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(statsCmd);
	statsCmd.action(
		action(async (scheduleId: string) => {
			const opts = statsCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const stats = await client.getScheduleStats(scheduleId);
				emitJsonOrText(!!opts.json, io, stats);
			} finally {
				client.close();
			}
		}),
	);

	const triggerCmd = schedule
		.command("trigger")
		.description("Trigger a schedule immediately")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(triggerCmd);
	triggerCmd.action(
		action(async (scheduleId: string) => {
			const opts = triggerCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const execution = await client.triggerScheduleNow(scheduleId);
				if (!execution) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, execution);
			} finally {
				client.close();
			}
		}),
	);

	const upcomingCmd = schedule
		.command("upcoming")
		.description("Show upcoming scheduled runs")
		.option("--limit <n>", "Maximum number of results", "20");
	addSharedOptions(upcomingCmd);
	upcomingCmd.action(
		action(async () => {
			const opts = upcomingCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const runs = await client.getUpcomingScheduledRuns(
					toPositiveInt(opts.limit, 20),
				);
				emitJsonOrText(!!opts.json, io, runs);
			} finally {
				client.close();
			}
		}),
	);

	registerScheduleExportCommand(schedule, io, fail, action);
	registerScheduleImportCommand(schedule, io, fail, action);
	registerScheduleUpdateCommand(schedule, io, fail, action);
}
