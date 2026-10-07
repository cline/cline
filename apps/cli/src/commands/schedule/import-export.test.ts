import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	registerScheduleExportCommand,
	registerScheduleImportCommand,
} from "./import-export";

const client = vi.hoisted(() => ({
	getSchedule: vi.fn(),
	createSchedule: vi.fn(),
	close: vi.fn(),
}));

vi.mock("./client", () => ({
	ensureSchedulerHub: vi.fn(async () => ({ ok: true, client })),
}));

vi.mock("./model-selection", () => ({
	resolveScheduleModelSelection: vi.fn(
		(selection: { provider?: string; model?: string }) => selection,
	),
}));

describe("schedule import/export execution settings", () => {
	let directory: string;
	const io = { writeln: vi.fn(), writeErr: vi.fn() };
	const fail = vi.fn();
	const record = {
		scheduleId: "sched_original",
		name: "Daily review",
		cronPattern: "0 9 * * *",
		prompt: "Review status",
		workspaceRoot: "/workspace",
		modelSelection: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
	};

	async function run(args: string[]): Promise<void> {
		const schedule = new Command();
		registerScheduleExportCommand(schedule, io, fail, (handler) => handler);
		registerScheduleImportCommand(schedule, io, fail, (handler) => handler);
		await schedule.parseAsync(args, { from: "user" });
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		directory = await mkdtemp(join(tmpdir(), "cline-schedule-roundtrip-"));
		client.createSchedule.mockResolvedValue({ scheduleId: "sched_imported" });
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it.each([
		{ extension: "json", timezone: "America/New_York", maxIterations: 3 },
		{ extension: "yaml", timezone: "Asia/Tokyo", maxIterations: 7 },
	])("preserves $timezone and maxIterations=$maxIterations through a $extension round trip", async ({
		extension,
		timezone,
		maxIterations,
	}) => {
		client.getSchedule.mockResolvedValue({
			...record,
			timezone,
			maxIterations,
		});
		const path = join(directory, `schedule.${extension}`);
		await run(["export", record.scheduleId, "--to", path]);
		await run(["import", path]);

		expect(fail).not.toHaveBeenCalled();
		expect(io.writeErr).not.toHaveBeenCalled();
		expect(client.createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ timezone, maxIterations }),
		);
		expect(client.close).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			extension: "json",
			label: "disabled capabilities",
			runtimeOptions: {
				enableTools: false,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: false,
			},
		},
		{
			extension: "yaml",
			label: "disabled capabilities",
			runtimeOptions: {
				enableTools: false,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: false,
			},
		},
		{
			extension: "json",
			label: "mixed capabilities and additional settings",
			runtimeOptions: {
				enableTools: true,
				enableSpawn: false,
				enableTeams: true,
				autoApproveTools: false,
				thinking: false,
				checkpointEnabled: false,
				systemPrompt: "Keep the scheduled run focused.",
			},
		},
		{
			extension: "yaml",
			label: "mixed capabilities and additional settings",
			runtimeOptions: {
				enableTools: false,
				enableSpawn: true,
				enableTeams: false,
				autoApproveTools: true,
				thinking: true,
				checkpointEnabled: false,
				systemPrompt: "Keep the scheduled run focused.",
			},
		},
	])("preserves runtimeOptions with $label through a $extension round trip", async ({
		extension,
		runtimeOptions,
	}) => {
		client.getSchedule.mockResolvedValue({ ...record, runtimeOptions });
		const path = join(directory, `schedule.${extension}`);
		await run(["export", record.scheduleId, "--to", path]);
		await run(["import", path]);

		expect(fail).not.toHaveBeenCalled();
		expect(io.writeErr).not.toHaveBeenCalled();
		expect(client.createSchedule).toHaveBeenCalledTimes(1);
		expect(client.createSchedule.mock.calls[0]?.[0].runtimeOptions).toEqual(
			runtimeOptions,
		);
		expect(client.close).toHaveBeenCalledTimes(2);
	});

	it.each([
		null,
		[],
		false,
		"disabled",
	])("ignores a non-object runtimeOptions value: %j", async (runtimeOptions) => {
		const path = join(directory, "schedule.json");
		await writeFile(path, JSON.stringify({ ...record, runtimeOptions }));
		await run(["import", path]);

		expect(fail).not.toHaveBeenCalled();
		expect(client.createSchedule).toHaveBeenCalledTimes(1);
		expect(
			client.createSchedule.mock.calls[0]?.[0].runtimeOptions,
		).toBeUndefined();
	});

	it("accepts the snake_case iteration limit from imported files", async () => {
		const path = join(directory, "schedule.json");
		await writeFile(
			path,
			JSON.stringify({
				...record,
				timezone: "Europe/London",
				max_iterations: 5,
			}),
		);
		await run(["import", path]);

		expect(fail).not.toHaveBeenCalled();
		expect(client.createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ timezone: "Europe/London", maxIterations: 5 }),
		);
	});

	it("prefers the exported camelCase iteration limit when both forms exist", async () => {
		const path = join(directory, "schedule.json");
		await writeFile(
			path,
			JSON.stringify({ ...record, maxIterations: 3, max_iterations: 9 }),
		);
		await run(["import", path]);

		expect(client.createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({ maxIterations: 3 }),
		);
	});

	it("keeps legacy files without these settings eligible for service defaults", async () => {
		const path = join(directory, "legacy.json");
		await writeFile(path, JSON.stringify(record));
		await run(["import", path]);

		expect(fail).not.toHaveBeenCalled();
		expect(io.writeErr).not.toHaveBeenCalled();
		expect(client.createSchedule).toHaveBeenCalledTimes(1);
		const input = client.createSchedule.mock.calls[0]?.[0];
		expect(input.timezone).toBeUndefined();
		expect(input.maxIterations).toBeUndefined();
		expect(input.runtimeOptions).toBeUndefined();
	});
});
