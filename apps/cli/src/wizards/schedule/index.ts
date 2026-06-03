import * as p from "@clack/prompts";
import {
	ensureSchedulerHub,
	type HubScheduleClient,
} from "../../commands/schedule/client";
import { resolveAddress } from "../../commands/schedule/common";
import { CRON_PRESETS } from "./cron-presets";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

interface ScheduleRecord {
	scheduleId: string;
	name: string;
	cronPattern: string;
	prompt: string;
	enabled: boolean;
	nextRunAt?: number;
}

interface ExecutionRecord {
	executionId: string;
	scheduleId: string;
	status: string;
	triggeredAt?: number;
	startedAt?: number;
	endedAt?: number;
	tokensUsed?: number;
	costUsd?: number;
}

interface ScheduleStats {
	totalRuns: number;
	successRate: number;
	avgDurationSeconds: number;
	lastFailure?: { errorMessage?: string };
}

interface UpcomingRun {
	name: string;
	nextRunAt: number;
}

function formatSchedule(s: ScheduleRecord): string {
	const status = s.enabled ? "enabled" : "paused";
	const next = s.nextRunAt
		? `next: ${new Date(s.nextRunAt).toLocaleString()}`
		: "";
	return `${s.name} (${s.cronPattern}) [${status}]${next ? ` ${next}` : ""}`;
}

async function pickSchedule(
	client: HubScheduleClient,
	message: string,
): Promise<string | null> {
	const schedules = (await client.listSchedules({})) as ScheduleRecord[];
	if (!schedules || schedules.length === 0) {
		p.log.warn("No schedules found");
		return null;
	}

	const choice = await p.select({
		message,
		options: schedules.map((s) => ({
			value: s.scheduleId,
			label: s.name,
			hint: `${s.cronPattern} [${s.enabled ? "enabled" : "paused"}]`,
		})),
	});

	if (isCancel(choice)) return null;
	return choice as string;
}

async function actionCreate(client: HubScheduleClient): Promise<void> {
	const name = await p.text({
		message: "Schedule name",
		placeholder: "nightly-cleanup",
		validate: (v) => {
			if (!v?.trim()) return "Name is required";
			return undefined;
		},
	});
	if (isCancel(name)) return;

	const cronChoice = await p.select({
		message: "How often should it run?",
		options: CRON_PRESETS.map((preset) => ({
			value: preset.value,
			label: preset.label,
			hint: preset.hint,
		})),
	});
	if (isCancel(cronChoice)) return;

	let cronPattern = cronChoice as string;
	if (cronPattern === "__custom__") {
		const custom = await p.text({
			message: "Cron expression (minute hour day month weekday)",
			placeholder: "0 */6 * * *",
			validate: (v) => {
				if (!v?.trim()) return "Cron expression is required";
				const parts = v.trim().split(/\s+/);
				if (parts.length !== 5)
					return "Must be 5 fields: minute hour day month weekday";
				return undefined;
			},
		});
		if (isCancel(custom)) return;
		cronPattern = (custom as string).trim();
	}

	const prompt = await p.text({
		message: "What should Cline do?",
		placeholder: "Review open PRs and post summaries",
		validate: (v) => {
			if (!v?.trim()) return "Prompt is required";
			return undefined;
		},
	});
	if (isCancel(prompt)) return;

	const workspace = await p.text({
		message: "Workspace path",
		placeholder: process.cwd(),
		initialValue: process.cwd(),
		validate: (v) => {
			if (!v?.trim()) return "Workspace path is required";
			return undefined;
		},
	});
	if (isCancel(workspace)) return;

	const mode = await p.select({
		message: "Agent mode",
		options: [
			{ value: "act", label: "Act", hint: "execute tasks" },
			{ value: "plan", label: "Plan", hint: "plan only" },
		],
		initialValue: "act",
	});
	if (isCancel(mode)) return;

	const wantAdvanced = await p.confirm({
		message: "Configure advanced options?",
		initialValue: false,
	});
	if (isCancel(wantAdvanced)) return;

	let provider: string | undefined;
	let model: string | undefined;
	let systemPrompt: string | undefined;
	let timeout: number | undefined;
	let maxIterations: number | undefined;
	let tags: string[] | undefined;

	if (wantAdvanced) {
		const advanced = await p.group({
			provider: () =>
				p.text({
					message: "Provider",
					placeholder: "leave empty for default",
				}),
			model: () =>
				p.text({
					message: "Model",
					placeholder: "leave empty for default",
				}),
			systemPrompt: () =>
				p.text({
					message: "System prompt override",
					placeholder: "leave empty for default",
				}),
			timeout: () =>
				p.text({
					message: "Timeout in seconds",
					placeholder: "leave empty for no timeout",
				}),
			maxIterations: () =>
				p.text({
					message: "Max iterations",
					placeholder: "leave empty for unlimited",
				}),
			tags: () =>
				p.text({
					message: "Tags (comma-separated)",
					placeholder: "cleanup, nightly",
				}),
		});
		if (isCancel(advanced)) return;

		provider = advanced.provider?.trim() || undefined;
		model = advanced.model?.trim() || undefined;
		systemPrompt = advanced.systemPrompt?.trim() || undefined;
		if (advanced.timeout?.trim()) {
			const n = Number.parseInt(advanced.timeout.trim(), 10);
			if (n > 0) timeout = n;
		}
		if (advanced.maxIterations?.trim()) {
			const n = Number.parseInt(advanced.maxIterations.trim(), 10);
			if (n > 0) maxIterations = n;
		}
		if (advanced.tags?.trim()) {
			tags = advanced.tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
		}
	}

	const created = (await client.createSchedule({
		name: (name as string).trim(),
		cronPattern,
		prompt: (prompt as string).trim(),
		provider: provider ?? "cline",
		model: model ?? "openai/gpt-5.3-codex",
		mode: (mode as string) === "plan" ? "plan" : "act",
		workspaceRoot: (workspace as string).trim(),
		systemPrompt,
		maxIterations,
		timeoutSeconds: timeout,
		maxParallel: 1,
		enabled: true,
		tags,
	})) as ScheduleRecord | undefined;

	if (!created) {
		p.log.error("Failed to create schedule");
		return;
	}

	p.log.success(`Created: ${created.name} (${created.scheduleId})`);
	if (created.nextRunAt) {
		p.log.info(`Next run: ${new Date(created.nextRunAt).toLocaleString()}`);
	}
}

async function actionList(client: HubScheduleClient): Promise<void> {
	const schedules = (await client.listSchedules({})) as ScheduleRecord[];
	if (!schedules || schedules.length === 0) {
		p.log.info("No schedules configured");
		return;
	}
	for (const s of schedules) {
		p.log.info(formatSchedule(s));
		p.log.message(`  ID: ${s.scheduleId}`);
		p.log.message(
			`  Prompt: ${s.prompt.slice(0, 80)}${s.prompt.length > 80 ? "..." : ""}`,
		);
	}
}

async function actionPause(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to pause");
	if (!id) return;
	const result = (await client.pauseSchedule(id)) as ScheduleRecord | undefined;
	if (result) {
		p.log.success(`Paused: ${result.name}`);
	} else {
		p.log.error("Failed to pause schedule");
	}
}

async function actionResume(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to resume");
	if (!id) return;
	const result = (await client.resumeSchedule(id)) as
		| ScheduleRecord
		| undefined;
	if (result) {
		p.log.success(`Resumed: ${result.name}`);
		if (result.nextRunAt) {
			p.log.info(`Next run: ${new Date(result.nextRunAt).toLocaleString()}`);
		}
	} else {
		p.log.error("Failed to resume schedule");
	}
}

async function actionTrigger(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to trigger now");
	if (!id) return;
	const execution = (await client.triggerScheduleNow(id)) as
		| ExecutionRecord
		| undefined;
	if (execution) {
		p.log.success(`Triggered: ${execution.executionId}`);
	} else {
		p.log.error("Failed to trigger schedule");
	}
}

async function actionDelete(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to delete");
	if (!id) return;

	const confirm = await p.confirm({
		message: "Are you sure you want to delete this schedule?",
		initialValue: false,
	});
	if (isCancel(confirm) || !confirm) return;

	const deleted = await client.deleteSchedule(id);
	if (deleted) {
		p.log.success("Schedule deleted");
	} else {
		p.log.error("Failed to delete schedule");
	}
}

async function actionHistory(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to view history");
	if (!id) return;

	const executions = (await client.listScheduleExecutions({
		scheduleId: id,
		limit: 20,
	})) as ExecutionRecord[];
	if (!executions || executions.length === 0) {
		p.log.info("No execution history");
		return;
	}
	for (const exec of executions) {
		const duration =
			exec.startedAt && exec.endedAt
				? `${((new Date(exec.endedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000).toFixed(0)}s`
				: "";
		const tokens = exec.tokensUsed != null ? `${exec.tokensUsed} tokens` : "";
		const cost = exec.costUsd != null ? `$${exec.costUsd.toFixed(4)}` : "";
		const details = [duration, tokens, cost].filter(Boolean).join(" / ");
		const time = exec.triggeredAt
			? new Date(exec.triggeredAt).toLocaleString()
			: "";
		p.log.info(`${time} [${exec.status}]${details ? ` ${details}` : ""}`);
	}
}

async function actionStats(client: HubScheduleClient): Promise<void> {
	const id = await pickSchedule(client, "Select schedule to view stats");
	if (!id) return;

	const stats = (await client.getScheduleStats(id)) as ScheduleStats;
	p.log.info(`Total runs: ${stats.totalRuns}`);
	p.log.info(`Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
	p.log.info(`Avg duration: ${stats.avgDurationSeconds.toFixed(0)}s`);
	if (stats.lastFailure) {
		p.log.warn(
			`Last failure: ${stats.lastFailure.errorMessage ?? "unknown error"}`,
		);
	}
}

async function actionActive(client: HubScheduleClient): Promise<void> {
	const active = (await client.getActiveScheduledExecutions()) as
		| ExecutionRecord[]
		| undefined;
	if (!active || active.length === 0) {
		p.log.info("No active executions");
		return;
	}
	for (const exec of active) {
		const started = exec.startedAt
			? new Date(exec.startedAt).toLocaleString()
			: "";
		p.log.info(
			`${exec.executionId} (schedule: ${exec.scheduleId}) started ${started}`,
		);
	}
}

async function actionUpcoming(client: HubScheduleClient): Promise<void> {
	const upcoming = (await client.getUpcomingScheduledRuns(10)) as
		| UpcomingRun[]
		| undefined;
	if (!upcoming || upcoming.length === 0) {
		p.log.info("No upcoming runs");
		return;
	}
	for (const run of upcoming) {
		const time = new Date(run.nextRunAt).toLocaleString();
		p.log.info(`${run.name} - ${time}`);
	}
}

export async function runScheduleWizard(): Promise<number> {
	p.intro("Scheduled Tasks");

	const s = p.spinner();
	s.start("Connecting to hub server...");

	const address = resolveAddress(process.env.CLINE_HUB_ADDRESS);
	const ensured = await ensureSchedulerHub(address, process.cwd(), {
		writeln: (text?: string) => {
			process.stdout.write(`${text ?? ""}\n`);
		},
		writeErr: (text: string) => {
			process.stderr.write(`${text}\n`);
		},
	});
	if (!ensured.ok) {
		s.stop("Failed to connect to hub server");
		p.log.error(
			"Schedules require the hub server. Start it with: cline hub start",
		);
		p.outro("Failed");
		return 1;
	}
	s.stop("Connected");

	const client = ensured.client;

	try {
		let keepGoing = true;
		while (keepGoing) {
			const action = await p.select({
				message: "What would you like to do?",
				options: [
					{
						value: "create",
						label: "Create new schedule",
						hint: "set up a recurring task",
					},
					{
						value: "list",
						label: "List schedules",
						hint: "view all configured schedules",
					},
					{
						value: "upcoming",
						label: "Upcoming runs",
						hint: "see what runs next",
					},
					{
						value: "active",
						label: "Active executions",
						hint: "see what is running now",
					},
					{
						value: "trigger",
						label: "Trigger now",
						hint: "run a schedule immediately",
					},
					{
						value: "pause",
						label: "Pause schedule",
					},
					{
						value: "resume",
						label: "Resume schedule",
					},
					{
						value: "history",
						label: "Execution history",
						hint: "view past runs",
					},
					{
						value: "stats",
						label: "Statistics",
						hint: "success rate, duration, etc.",
					},
					{
						value: "delete",
						label: "Delete schedule",
					},
					{
						value: "exit",
						label: "Exit",
					},
				],
			});

			if (isCancel(action) || action === "exit") {
				keepGoing = false;
				continue;
			}

			try {
				switch (action) {
					case "create":
						await actionCreate(client);
						break;
					case "list":
						await actionList(client);
						break;
					case "pause":
						await actionPause(client);
						break;
					case "resume":
						await actionResume(client);
						break;
					case "trigger":
						await actionTrigger(client);
						break;
					case "delete":
						await actionDelete(client);
						break;
					case "history":
						await actionHistory(client);
						break;
					case "stats":
						await actionStats(client);
						break;
					case "active":
						await actionActive(client);
						break;
					case "upcoming":
						await actionUpcoming(client);
						break;
				}
			} catch (err) {
				p.log.error(err instanceof Error ? err.message : String(err));
			}
		}

		p.outro("Done");
		return 0;
	} finally {
		client.close();
	}
}
