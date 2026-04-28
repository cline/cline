import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockSendHubCommand = vi.hoisted(() => vi.fn());
const mockEnsureCliHubServer = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/core", () => ({
	sendHubCommand: mockSendHubCommand,
}));

vi.mock("../utils/hub-runtime", () => ({
	ensureCliHubServer: mockEnsureCliHubServer,
	parseHubEndpointOverride: (rawAddress: string | undefined) => {
		const trimmed = rawAddress?.trim();
		if (!trimmed) {
			return {};
		}
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `ws://${trimmed}`,
		);
		return {
			host: parsed.hostname || undefined,
			port: parsed.port ? Number(parsed.port) : undefined,
			pathname:
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname
					: undefined,
		};
	},
}));

async function runScheduleCommand(
	args: string[],
	io: { writeln: (text?: string) => void; writeErr: (text: string) => void },
): Promise<number> {
	let exitCode = 0;
	const cmd = createScheduleCommand(io, (code) => {
		exitCode = code;
	});
	await cmd.parseAsync(args, { from: "user" });
	return exitCode;
}

describe("runScheduleCommand list output", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('prints "No schedules found." for empty non-json list output', async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["list"], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["No schedules found."]);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "clite-schedule",
				command: "schedule.list",
				payload: {
					limit: 100,
					enabled: undefined,
					tags: undefined,
				},
			},
		);
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["list", "--json"], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["[]"]);
		expect(mockSendHubCommand).toHaveBeenCalled();
	});
});

describe("runScheduleCommand import", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("preserves exported modelSelection providerId/modelId values", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const sourcePath = join(
			tmpdir(),
			`clite-schedule-import-${Date.now()}.json`,
		);
		await writeFile(
			sourcePath,
			JSON.stringify({
				name: "Daily Review",
				cronPattern: "0 9 * * *",
				prompt: "review status",
				workspaceRoot: "/tmp/workspace",
				modelSelection: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				},
			}),
			"utf8",
		);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["import", sourcePath], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(['{\n  "scheduleId": "sched_123"\n}']);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "clite-schedule",
				command: "schedule.create",
				payload: expect.objectContaining({
					provider: "anthropic",
					model: "claude-sonnet-4-6",
				}),
			},
		);
	});
});

describe("runScheduleCommand export", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("writes JSON content to the --to file path", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		const scheduleRecord = {
			scheduleId: "sched_abc",
			name: "Daily Review",
			cronPattern: "0 9 * * *",
			prompt: "review status",
			workspaceRoot: "/tmp/workspace",
		};
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: scheduleRecord },
		});

		const targetPath = join(
			tmpdir(),
			`clite-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.json`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["export", "sched_abc", "--to", targetPath],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(output).toEqual([`Exported schedule sched_abc to ${targetPath}`]);

			const written = await readFile(targetPath, "utf8");
			expect(written).toBe(JSON.stringify(scheduleRecord, null, 2));
			expect(mockSendHubCommand).toHaveBeenCalledWith(
				{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
				{
					clientId: "clite-schedule",
					command: "schedule.get",
					payload: { scheduleId: "sched_abc" },
				},
			);
		} finally {
			await rm(targetPath, { force: true });
		}
	});

	it("writes YAML content when --to has a non-json extension", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		const scheduleRecord = {
			scheduleId: "sched_yaml",
			name: "Weekly Sync",
			cronPattern: "0 9 * * 1",
		};
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: scheduleRecord },
		});

		const targetPath = join(
			tmpdir(),
			`clite-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.yaml`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["export", "sched_yaml", "--to", targetPath],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(output).toEqual([`Exported schedule sched_yaml to ${targetPath}`]);

			const yaml = await import("yaml");
			const written = await readFile(targetPath, "utf8");
			expect(written).toBe(yaml.stringify(scheduleRecord));
		} finally {
			await rm(targetPath, { force: true });
		}
	});
});
