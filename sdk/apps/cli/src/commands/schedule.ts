import { readFile } from "node:fs/promises";
import { getRpcServerHealth, RpcSessionClient } from "@clinebot/rpc";
import { Command } from "commander";
import { runRpcEnsureCommand } from "./rpc";

interface CommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

function parseList(raw: string | undefined): string[] | undefined {
	if (!raw) {
		return undefined;
	}
	const out = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return out.length > 0 ? out : undefined;
}

function parseJsonObjectFlag(
	raw: string | undefined,
): Record<string, unknown> | undefined {
	if (!raw?.trim()) {
		return undefined;
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("metadata JSON must be an object");
	}
	return parsed as Record<string, unknown>;
}

function mergeScheduleDeliveryMetadata(
	base: Record<string, unknown> | undefined,
	delivery: {
		deliveryAdapter?: string;
		deliveryThread?: string;
		deliveryChannel?: string;
		deliveryBot?: string;
	},
): Record<string, unknown> | undefined {
	const adapter = delivery.deliveryAdapter?.trim();
	const threadId = delivery.deliveryThread?.trim();
	const channelId = delivery.deliveryChannel?.trim();
	const userName = delivery.deliveryBot?.trim();
	if (!adapter && !threadId && !channelId && !userName) {
		return base;
	}
	const next = { ...(base ?? {}) };
	const existingDelivery =
		next.delivery &&
		typeof next.delivery === "object" &&
		!Array.isArray(next.delivery)
			? (next.delivery as Record<string, unknown>)
			: {};
	next.delivery = {
		...existingDelivery,
		...(adapter ? { adapter } : {}),
		...(threadId ? { threadId } : {}),
		...(channelId ? { channelId } : {}),
		...(userName ? { userName } : {}),
	};
	return next;
}

function mergeScheduleAutonomousMetadata(
	base: Record<string, unknown> | undefined,
	autonomous: {
		autonomous?: true;
		noAutonomous?: true;
		idleTimeout?: string;
		pollInterval?: string;
	},
): Record<string, unknown> | undefined {
	const autonomousEnabled = !!autonomous.autonomous;
	const autonomousDisabled = !!autonomous.noAutonomous;
	const idleTimeoutSeconds = autonomous.idleTimeout;
	const pollIntervalSeconds = autonomous.pollInterval;
	if (
		!autonomousEnabled &&
		!autonomousDisabled &&
		!idleTimeoutSeconds &&
		!pollIntervalSeconds
	) {
		return base;
	}
	const next = { ...(base ?? {}) };
	const existingAutonomous =
		next.autonomous &&
		typeof next.autonomous === "object" &&
		!Array.isArray(next.autonomous)
			? (next.autonomous as Record<string, unknown>)
			: {};
	next.autonomous = {
		...existingAutonomous,
		...(autonomousEnabled ? { enabled: true } : {}),
		...(autonomousDisabled ? { enabled: false } : {}),
		...(idleTimeoutSeconds
			? { idleTimeoutSeconds: toPositiveInt(idleTimeoutSeconds, 60) }
			: {}),
		...(pollIntervalSeconds
			? { pollIntervalSeconds: toPositiveInt(pollIntervalSeconds, 5) }
			: {}),
	};
	return next;
}

function hasMetadataPatchOpts(opts: Record<string, unknown>): boolean {
	return (
		!!opts.metadataJson ||
		!!opts.deliveryAdapter ||
		!!opts.deliveryThread ||
		!!opts.deliveryChannel ||
		!!opts.deliveryBot ||
		!!opts.autonomous ||
		!!opts.noAutonomous ||
		!!opts.idleTimeout ||
		!!opts.pollInterval
	);
}

function mergeScheduleMetadata(
	base: Record<string, unknown> | undefined,
	opts: {
		deliveryAdapter?: string;
		deliveryThread?: string;
		deliveryChannel?: string;
		deliveryBot?: string;
		autonomous?: true;
		noAutonomous?: true;
		idleTimeout?: string;
		pollInterval?: string;
	},
): Record<string, unknown> | undefined {
	return mergeScheduleAutonomousMetadata(
		mergeScheduleDeliveryMetadata(base, opts),
		opts,
	);
}

function isJsonPath(path: string): boolean {
	return path.toLowerCase().endsWith(".json");
}

function parseMode(raw: string | undefined): "act" | "plan" | undefined {
	if (raw === "act" || raw === "plan") {
		return raw;
	}
	return undefined;
}

async function ensureSchedulerRpc(
	address: string,
	io: CommandIo,
): Promise<{ ok: boolean; address: string }> {
	const current = await getRpcServerHealth(address);
	if (current?.running) {
		return { ok: true, address };
	}
	let ensuredAddress = address;
	const code = await runRpcEnsureCommand(
		{ address, json: true },
		(text) => {
			if (!text) {
				return;
			}
			try {
				const parsed = JSON.parse(text) as { address?: string };
				if (typeof parsed.address === "string" && parsed.address.trim()) {
					ensuredAddress = parsed.address.trim();
				}
			} catch {
				// ignore non-JSON lines
			}
		},
		io.writeErr,
	);
	if (code !== 0) {
		return { ok: false, address };
	}
	return { ok: true, address: ensuredAddress };
}

function emitJsonOrText(json: boolean, io: CommandIo, value: unknown): void {
	if (json) {
		io.writeln(JSON.stringify(value));
		return;
	}
	if (typeof value === "string") {
		io.writeln(value);
		return;
	}
	io.writeln(JSON.stringify(value, null, 2));
}

function toPositiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

function resolveAddress(address: string | undefined): string {
	return (address ?? process.env.CLINE_RPC_ADDRESS ?? "127.0.0.1:4317").trim();
}

function addSharedOptions(cmd: Command): Command {
	return cmd
		.option("--address <host:port>", "RPC server address")
		.option("--json", "Output as JSON");
}

function addDeliveryOptions(cmd: Command): Command {
	return cmd
		.option("--delivery-adapter <name>", "Delivery adapter name")
		.option("--delivery-bot <name>", "Delivery bot user name")
		.option("--delivery-channel <id>", "Delivery channel ID")
		.option("--delivery-thread <id>", "Delivery thread ID");
}

function addAutonomousOptions(cmd: Command): Command {
	return cmd
		.option("--autonomous", "Enable autonomous mode")
		.option("--no-autonomous", "Disable autonomous mode")
		.option("--idle-timeout <seconds>", "Autonomous idle timeout in seconds")
		.option("--poll-interval <seconds>", "Autonomous poll interval in seconds");
}

export function createScheduleCommand(
	io: CommandIo,
	setExitCode: (code: number) => void,
): Command {
	let actionExitCode = 0;
	const fail = () => {
		actionExitCode = 1;
	};

	/** Wrap an async action with error handling. */
	function action<T extends unknown[]>(
		fn: (...args: T) => Promise<void>,
	): (...args: T) => Promise<void> {
		return async (...args: T) => {
			try {
				await fn(...args);
			} catch (error) {
				io.writeErr(error instanceof Error ? error.message : String(error));
				fail();
			}
		};
	}

	const schedule = new Command("schedule")
		.description("Create and manage scheduled runs")
		.exitOverride()
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		});

	// --- schedule active ---
	const activeCmd = schedule
		.command("active")
		.description("Show currently active executions");
	addSharedOptions(activeCmd);
	activeCmd.action(
		action(async () => {
			const opts = activeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				const active = await client.getActiveScheduledExecutions();
				emitJsonOrText(!!opts.json, io, active);
			} finally {
				client.close();
			}
		}),
	);

	// --- schedule create ---
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
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule delete ---
	const deleteCmd = schedule
		.command("delete")
		.description("Delete a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(deleteCmd);
	deleteCmd.action(
		action(async (scheduleId: string) => {
			const opts = deleteCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				const deleted = await client.deleteSchedule(scheduleId);
				emitJsonOrText(!!opts.json, io, { deleted });
				if (!deleted) fail();
			} finally {
				client.close();
			}
		}),
	);

	// --- schedule export ---
	const exportCmd = schedule
		.command("export")
		.description("Export a schedule")
		.argument("<schedule-id>", "Schedule ID")
		.option("--to <path>", "Output file path");
	addSharedOptions(exportCmd);
	exportCmd.action(
		action(async (scheduleId: string) => {
			const opts = exportCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				const result = await client.getSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				if (opts.json || (opts.to && isJsonPath(opts.to))) {
					io.writeln(JSON.stringify(result, null, 2));
					return;
				}
				const yaml = await import("yaml");
				io.writeln(yaml.stringify(result));
			} finally {
				client.close();
			}
		}),
	);

	// --- schedule get ---
	const getCmd = schedule
		.command("get")
		.description("Get a schedule by ID")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(getCmd);
	getCmd.action(
		action(async (scheduleId: string) => {
			const opts = getCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule history ---
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
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule import ---
	const importCmd = schedule
		.command("import")
		.description("Import a schedule from file")
		.argument("<path>", "Source file path");
	addSharedOptions(importCmd);
	importCmd.action(
		action(async (sourcePath: string) => {
			const opts = importCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				const sourceRaw = await readFile(sourcePath, "utf8");
				let parsed: Record<string, unknown>;
				if (isJsonPath(sourcePath)) {
					parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
				} else {
					const yaml = await import("yaml");
					parsed = yaml.parse(sourceRaw) as Record<string, unknown>;
				}
				const workspaceRoot = String(
					parsed.workspaceRoot ?? parsed.workspace_root ?? "",
				).trim();
				if (!workspaceRoot) {
					io.writeErr(
						"schedule import requires workspaceRoot/workspace_root in the source file",
					);
					fail();
					return;
				}
				const created = await client.createSchedule({
					name: String(parsed.name ?? "").trim(),
					cronPattern: String(parsed.cronPattern ?? parsed.cron ?? "").trim(),
					prompt: String(parsed.prompt ?? "").trim(),
					provider: String(parsed.provider ?? "cline").trim(),
					model: String(parsed.model ?? "openai/gpt-5.3-codex").trim(),
					mode: parsed.mode === "plan" ? "plan" : "act",
					workspaceRoot,
					cwd: String(parsed.cwd ?? "").trim() || undefined,
					systemPrompt:
						String(parsed.systemPrompt ?? parsed.system_prompt ?? "").trim() ||
						undefined,
					maxIterations:
						typeof parsed.maxIterations === "number"
							? parsed.maxIterations
							: typeof parsed.max_iterations === "number"
								? parsed.max_iterations
								: undefined,
					timeoutSeconds:
						typeof parsed.timeoutSeconds === "number"
							? parsed.timeoutSeconds
							: typeof parsed.timeout_seconds === "number"
								? parsed.timeout_seconds
								: undefined,
					maxParallel:
						typeof parsed.maxParallel === "number"
							? parsed.maxParallel
							: typeof parsed.max_parallel === "number"
								? parsed.max_parallel
								: 1,
					enabled: parsed.enabled !== false,
					createdBy:
						String(parsed.createdBy ?? parsed.created_by ?? "").trim() ||
						undefined,
					tags: Array.isArray(parsed.tags)
						? parsed.tags
								.map((item) => (typeof item === "string" ? item.trim() : ""))
								.filter((item) => item.length > 0)
						: undefined,
					metadata: mergeScheduleMetadata(
						parsed.metadata && typeof parsed.metadata === "object"
							? (parsed.metadata as Record<string, unknown>)
							: undefined,
						opts,
					),
				});
				if (!created) {
					io.writeErr("failed to import schedule");
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, created);
			} finally {
				client.close();
			}
		}),
	);

	// --- schedule list ---
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
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule pause ---
	const pauseCmd = schedule
		.command("pause")
		.description("Pause a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(pauseCmd);
	pauseCmd.action(
		action(async (scheduleId: string) => {
			const opts = pauseCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule resume ---
	const resumeCmd = schedule
		.command("resume")
		.description("Resume a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(resumeCmd);
	resumeCmd.action(
		action(async (scheduleId: string) => {
			const opts = resumeCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule stats ---
	const statsCmd = schedule
		.command("stats")
		.description("Show statistics for a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(statsCmd);
	statsCmd.action(
		action(async (scheduleId: string) => {
			const opts = statsCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				const stats = await client.getScheduleStats(scheduleId);
				emitJsonOrText(!!opts.json, io, stats);
			} finally {
				client.close();
			}
		}),
	);

	// --- schedule trigger ---
	const triggerCmd = schedule
		.command("trigger")
		.description("Trigger a schedule immediately")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(triggerCmd);
	triggerCmd.action(
		action(async (scheduleId: string) => {
			const opts = triggerCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule upcoming ---
	const upcomingCmd = schedule
		.command("upcoming")
		.description("Show upcoming scheduled runs")
		.option("--limit <n>", "Maximum number of results", "20");
	addSharedOptions(upcomingCmd);
	upcomingCmd.action(
		action(async () => {
			const opts = upcomingCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
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

	// --- schedule update ---
	const updateCmd = schedule
		.command("update")
		.description("Update a schedule")
		.argument("<schedule-id>", "Schedule ID")
		.option("--clear-max-iterations", "Clear max iterations")
		.option("--clear-timeout", "Clear timeout")
		.option("--cron <pattern>", "New cron pattern")
		.option("--cwd <path>", "New working directory")
		.option("--disabled", "Disable the schedule")
		.option("--enabled", "Enable the schedule")
		.option("--max-iterations <n>", "New max iterations")
		.option("--max-parallel <n>", "New max parallel executions")
		.option("--metadata-json <json>", "New metadata as JSON object")
		.option("--mode <act|plan>", "New execution mode")
		.option("--model <model>", "New model")
		.option("--name <name>", "New name")
		.option("--pause", "Pause the schedule")
		.option("--prompt <text>", "New prompt")
		.option("--provider <id>", "New provider ID")
		.option("--resume", "Resume the schedule")
		.option("--system-prompt <text>", "New system prompt")
		.option("--tags <list>", "New comma-separated tags")
		.option("--timeout <n>", "New timeout in seconds")
		.option("--workspace <path>", "New workspace root");
	addDeliveryOptions(updateCmd);
	addAutonomousOptions(updateCmd);
	addSharedOptions(updateCmd);
	updateCmd.action(
		action(async (scheduleId: string) => {
			const opts = updateCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerRpc(address, io);
			if (!ensured.ok) {
				io.writeErr(`failed to ensure rpc server at ${address}`);
				fail();
				return;
			}
			const client = new RpcSessionClient({ address: ensured.address });
			try {
				if (opts.pause) {
					const result = await client.pauseSchedule(scheduleId);
					emitJsonOrText(!!opts.json, io, result ?? { updated: false });
					if (!result) fail();
					return;
				}
				if (opts.resume) {
					const result = await client.resumeSchedule(scheduleId);
					emitJsonOrText(!!opts.json, io, result ?? { updated: false });
					if (!result) fail();
					return;
				}
				let metadata: Record<string, unknown> | undefined;
				if (hasMetadataPatchOpts(opts)) {
					const current = await client.getSchedule(scheduleId);
					if (!current) {
						io.writeErr(`schedule not found: ${scheduleId}`);
						fail();
						return;
					}
					const metadataBase = {
						...((current.metadata as Record<string, unknown> | undefined) ??
							{}),
						...(parseJsonObjectFlag(opts.metadataJson) ?? {}),
					};
					metadata = mergeScheduleMetadata(metadataBase, opts);
				}
				const updated = await client.updateSchedule(scheduleId, {
					name: opts.name,
					cronPattern: opts.cron,
					prompt: opts.prompt,
					provider: opts.provider,
					model: opts.model,
					mode: parseMode(opts.mode),
					workspaceRoot: opts.workspace,
					cwd: opts.cwd,
					systemPrompt: opts.systemPrompt,
					maxIterations: opts.maxIterations
						? toPositiveInt(opts.maxIterations, 1)
						: opts.clearMaxIterations
							? null
							: undefined,
					timeoutSeconds: opts.timeout
						? toPositiveInt(opts.timeout, 1)
						: opts.clearTimeout
							? null
							: undefined,
					maxParallel: opts.maxParallel
						? toPositiveInt(opts.maxParallel, 1)
						: undefined,
					enabled: opts.enabled ? true : opts.disabled ? false : undefined,
					tags: opts.tags ? parseList(opts.tags) : undefined,
					metadata,
				});
				if (!updated) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, updated);
			} finally {
				client.close();
			}
		}),
	);

	return schedule;
}
