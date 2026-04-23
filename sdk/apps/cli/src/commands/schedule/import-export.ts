import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { ensureSchedulerHub } from "./client";
import {
	addAutonomousOptions,
	addDeliveryOptions,
	addSharedOptions,
	emitJsonOrText,
	formatResolvedAddressLabel,
	hasMetadataPatchOpts,
	isJsonPath,
	mergeScheduleMetadata,
	parseJsonObjectFlag,
	parseList,
	parseMode,
	resolveAddress,
	toPositiveInt,
} from "./common";
import type { CommandIo, ScheduleActionWrapper } from "./types";

function resolveImportedModelSelection(parsed: Record<string, unknown>): {
	provider: string;
	model: string;
} {
	const modelSelection =
		parsed.modelSelection &&
		typeof parsed.modelSelection === "object" &&
		!Array.isArray(parsed.modelSelection)
			? (parsed.modelSelection as Record<string, unknown>)
			: undefined;
	const provider = String(
		modelSelection?.providerId ??
			parsed.providerId ??
			parsed.provider ??
			"cline",
	).trim();
	const model = String(
		modelSelection?.modelId ??
			parsed.modelId ??
			parsed.model ??
			"openai/gpt-5.3-codex",
	).trim();
	return { provider, model };
}

export function registerScheduleExportCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
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
}

export function registerScheduleImportCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const importCmd = schedule
		.command("import")
		.description("Import a schedule from file")
		.argument("<path>", "Source file path");
	addSharedOptions(importCmd);
	importCmd.action(
		action(async (sourcePath: string) => {
			const opts = importCmd.opts();
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
				const { provider, model } = resolveImportedModelSelection(parsed);
				const created = await client.createSchedule({
					name: String(parsed.name ?? "").trim(),
					cronPattern: String(parsed.cronPattern ?? parsed.cron ?? "").trim(),
					prompt: String(parsed.prompt ?? "").trim(),
					provider,
					model,
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
}

export function registerScheduleUpdateCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
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
					const current = (await client.getSchedule(scheduleId)) as
						| { metadata?: Record<string, unknown> }
						| undefined;
					if (!current) {
						io.writeErr(`schedule not found: ${scheduleId}`);
						fail();
						return;
					}
					const metadataBase = {
						...(current.metadata ?? {}),
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
}
