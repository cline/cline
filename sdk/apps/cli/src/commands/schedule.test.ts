import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockSendHubCommand = vi.hoisted(() => vi.fn());
const mockEnsureCliHubServer = vi.hoisted(() => vi.fn());
const mockProviderSettings = vi.hoisted(() => ({
	lastUsed: undefined as { provider?: string; model?: string } | undefined,
	providers: {} as Record<string, { provider?: string; model?: string }>,
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		sendHubCommand: mockSendHubCommand,
		ProviderSettingsManager: class {
			getLastUsedProviderSettings() {
				return mockProviderSettings.lastUsed;
			}

			getProviderSettings(providerId: string) {
				return mockProviderSettings.providers[providerId];
			}
		},
	};
});

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
		mockProviderSettings.lastUsed = undefined;
		mockProviderSettings.providers = {};
	});

	it('prints "No schedules found." for empty non-json list output', async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			["list", "--address", "127.0.0.1:25463"],
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
		expect(output).toEqual(["No schedules found."]);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "cline-schedule",
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
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			["list", "--json", "--address", "127.0.0.1:25463"],
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
		expect(output).toEqual(["[]"]);
		expect(mockSendHubCommand).toHaveBeenCalled();
	});
});

describe("runScheduleCommand create", () => {
	afterEach(() => {
		vi.clearAllMocks();
		mockProviderSettings.lastUsed = undefined;
		mockProviderSettings.providers = {};
	});

	it("uses the last used provider and model when both flags are omitted", async () => {
		mockProviderSettings.lastUsed = {
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		};
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"create",
				"Health check",
				"--cron",
				"0 */6 * * *",
				"--prompt",
				"Run tests",
				"--workspace",
				"/tmp/workspace",
				"--address",
				"127.0.0.1:25463",
			],
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
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			expect.objectContaining({
				clientId: "cline-schedule",
				command: "schedule.create",
				payload: expect.objectContaining({
					provider: "anthropic",
					model: "claude-sonnet-4-6",
				}),
			}),
		);
	});

	it("uses an explicit provider with that provider's configured model", async () => {
		mockProviderSettings.lastUsed = {
			provider: "cline",
			model: "openai/gpt-5.3-codex",
		};
		mockProviderSettings.providers.anthropic = {
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		};
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"create",
				"Health check",
				"--cron",
				"0 */6 * * *",
				"--prompt",
				"Run tests",
				"--workspace",
				"/tmp/workspace",
				"--provider",
				"anthropic",
				"--address",
				"127.0.0.1:25463",
			],
			{
				writeln: () => {},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			expect.objectContaining({
				command: "schedule.create",
				payload: expect.objectContaining({
					provider: "anthropic",
					model: "claude-sonnet-4-6",
				}),
			}),
		);
	});

	it("fails when an explicit provider has no configured model and no model flag", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});

		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"create",
				"Health check",
				"--cron",
				"0 */6 * * *",
				"--prompt",
				"Run tests",
				"--workspace",
				"/tmp/workspace",
				"--provider",
				"anthropic",
				"--address",
				"127.0.0.1:25463",
			],
			{
				writeln: () => {},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(1);
		expect(errors).toEqual([
			'No model is configured for provider "anthropic". Pass --model or save a model for that provider before creating the schedule.',
		]);
		expect(mockSendHubCommand).not.toHaveBeenCalled();
	});
});

describe("runScheduleCommand import", () => {
	afterEach(() => {
		vi.clearAllMocks();
		mockProviderSettings.lastUsed = undefined;
		mockProviderSettings.providers = {};
	});

	it("preserves exported modelSelection providerId/modelId values", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const sourcePath = join(
			tmpdir(),
			`cline-schedule-import-${Date.now()}.json`,
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
		const code = await runScheduleCommand(
			["import", sourcePath, "--address", "127.0.0.1:25463"],
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
		expect(output).toEqual(['{\n  "scheduleId": "sched_123"\n}']);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "cline-schedule",
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
		mockProviderSettings.lastUsed = undefined;
		mockProviderSettings.providers = {};
	});

	it("writes JSON content to the --to file path", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
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
			`cline-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.json`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				[
					"export",
					"sched_abc",
					"--to",
					targetPath,
					"--address",
					"127.0.0.1:25463",
				],
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
					clientId: "cline-schedule",
					command: "schedule.get",
					payload: { scheduleId: "sched_abc" },
				},
			);
		} finally {
			await rm(targetPath, { force: true });
		}
	});

	it("writes YAML content when --to has a non-json extension", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
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
			`cline-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.yaml`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				[
					"export",
					"sched_yaml",
					"--to",
					targetPath,
					"--address",
					"127.0.0.1:25463",
				],
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
