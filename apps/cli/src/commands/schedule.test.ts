import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockHubClientCommand = vi.hoisted(() => vi.fn());
const mockNodeHubClientCtor = vi.hoisted(() => vi.fn());
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
		NodeHubClient: class {
			command = mockHubClientCommand;

			constructor(options: Record<string, unknown>) {
				mockNodeHubClientCtor(options);
			}

			async connect(): Promise<void> {}

			close(): void {}
		},
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
		mockHubClientCommand.mockResolvedValue({
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
		// Schedule commands are workspace-scoped: the hub client must register
		// with a workspace context (and the hub auth token) before commanding.
		expect(mockNodeHubClientCtor).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				workspaceRoot: process.cwd(),
				cwd: process.cwd(),
				authToken: "test-token",
			}),
		);
		expect(mockHubClientCommand).toHaveBeenCalledWith("schedule.list", {
			limit: 100,
			enabled: undefined,
			tags: undefined,
		});
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockResolvedValue({
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
		expect(mockHubClientCommand).toHaveBeenCalled();
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
		mockHubClientCommand.mockResolvedValue({
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
		expect(mockNodeHubClientCtor).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				workspaceRoot: "/tmp/workspace",
				cwd: "/tmp/workspace",
				authToken: "test-token",
			}),
		);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.create",
			expect.objectContaining({
				provider: "anthropic",
				model: "claude-sonnet-4-6",
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
		mockHubClientCommand.mockResolvedValue({
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
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.create",
			expect.objectContaining({
				provider: "anthropic",
				model: "claude-sonnet-4-6",
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
		expect(mockHubClientCommand).not.toHaveBeenCalled();
	});

	it("maps --delivery-bot to delivery.userName", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_delivery" } },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"create",
				"Daily summary",
				"--cron",
				"0 9 * * *",
				"--prompt",
				"Summarize yesterday",
				"--workspace",
				"/tmp/workspace",
				"--delivery-adapter",
				"telegram",
				"--delivery-bot",
				"my_bot",
				"--delivery-thread",
				"telegram:123456789",
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
		expect(output).toEqual(['{\n  "scheduleId": "sched_delivery"\n}']);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.create",
			expect.objectContaining({
				metadata: {
					delivery: {
						adapter: "telegram",
						threadId: "telegram:123456789",
						userName: "my_bot",
					},
				},
			}),
		);
	});

	const createArgs = [
		"create",
		"Daily summary",
		"--cron",
		"0 9 * * *",
		"--prompt",
		"Summarize yesterday",
		"--workspace",
		"/tmp/workspace",
	];

	it.each([
		{
			name: "flags without a chat",
			args: ["--delivery-adapter", "telegram", "--delivery-bot", "my_bot"],
			errors: [
				"schedule delivery needs --delivery-thread <id>: send /whereami in the chat to get it",
			],
		},
		{
			name: "flags without an adapter",
			args: ["--delivery-thread", "telegram:123456789"],
			errors: [
				"schedule delivery needs --delivery-adapter <name>, such as telegram or slack",
			],
		},
		{
			name: "a flag adapter no connector answers to",
			args: [
				"--delivery-adapter",
				"telgram",
				"--delivery-thread",
				"telegram:123456789",
			],
			errors: [
				'--delivery-adapter <name> is "telgram"; use one of: discord, gchat, linear, slack, telegram, whatsapp',
			],
		},
		{
			name: "JSON without a chat",
			args: ["--metadata-json", '{"delivery":{"adapter":"telegram"}}'],
			errors: [
				"schedule delivery needs --metadata-json delivery.threadId: send /whereami in the chat to get it",
			],
		},
		{
			name: "JSON with fields of the wrong type",
			args: [
				"--metadata-json",
				'{"delivery":{"adapter":"telegram","threadId":123}}',
			],
			errors: ["--metadata-json delivery.threadId must be a string"],
		},
		{
			name: "a JSON delivery that isn't an object",
			args: ["--metadata-json", '{"delivery":"telegram"}'],
			errors: [
				"--metadata-json delivery must be an object, or null to remove the delivery",
			],
		},
		{
			name: "a JSON thread and a flag adapter no connector answers to",
			args: [
				"--metadata-json",
				'{"delivery":{"threadId":"telegram:123456789"}}',
				"--delivery-adapter",
				"telgram",
			],
			errors: [
				'--delivery-adapter <name> is "telgram"; use one of: discord, gchat, linear, slack, telegram, whatsapp',
			],
		},
		{
			name: "a JSON adapter no connector answers to, and no chat in either",
			args: [
				"--metadata-json",
				'{"delivery":{"adapter":"telgram"}}',
				"--delivery-bot",
				"my_bot",
			],
			errors: [
				'--metadata-json delivery.adapter is "telgram"; use one of: discord, gchat, linear, slack, telegram, whatsapp',
				"schedule delivery needs --delivery-thread <id>: send /whereami in the chat to get it",
			],
		},
	])("rejects $name before contacting the hub", async ({ args, errors }) => {
		const written: string[] = [];
		const code = await runScheduleCommand([...createArgs, ...args], {
			writeln: () => {},
			writeErr: (text: string) => {
				written.push(text);
			},
		});

		expect(code).toBe(1);
		expect(written).toEqual([errors.join("\n")]);
		expect(mockEnsureCliHubServer).not.toHaveBeenCalled();
		expect(mockHubClientCommand).not.toHaveBeenCalled();
	});

	it("adds a flag to a JSON delivery", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_delivery" } },
		});

		const code = await runScheduleCommand(
			[
				...createArgs,
				"--metadata-json",
				'{"owner":"ops","delivery":{"adapter":"slack","bindingKey":"C1"}}',
				"--delivery-bot",
				"my_bot",
				"--address",
				"127.0.0.1:25463",
			],
			{ writeln: () => {}, writeErr: () => {} },
		);

		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.create",
			expect.objectContaining({
				metadata: {
					owner: "ops",
					delivery: { adapter: "slack", bindingKey: "C1", userName: "my_bot" },
				},
			}),
		);
	});

	it.each([
		["--autonomous"],
		["--no-autonomous"],
		["--idle-timeout", "60"],
		["--poll-interval", "5"],
		["--delivery-channel", "C123"],
	])("rejects %s, which no schedule run reads", async (...flag: string[]) => {
		await expect(
			runScheduleCommand(
				[
					"create",
					"Health check",
					"--cron",
					"0 */6 * * *",
					"--prompt",
					"Run tests",
					"--workspace",
					"/tmp/workspace",
					...flag,
				],
				{ writeln: () => {}, writeErr: () => {} },
			),
		).rejects.toThrow(`unknown option '${flag[0]}'`);
		expect(mockHubClientCommand).not.toHaveBeenCalled();
	});
});

describe("runScheduleCommand update", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("adds a bot to an existing delivery and keeps its thread", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockImplementation(async (command: string) =>
			command === "schedule.get"
				? {
						ok: true,
						payload: {
							schedule: {
								scheduleId: "sched_1",
								metadata: {
									delivery: {
										adapter: "telegram",
										threadId: "telegram:123456789",
									},
								},
							},
						},
					}
				: { ok: true, payload: { schedule: { scheduleId: "sched_1" } } },
		);

		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"update",
				"sched_1",
				"--delivery-bot",
				"my_bot",
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

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.update",
			expect.objectContaining({
				metadata: {
					delivery: {
						adapter: "telegram",
						threadId: "telegram:123456789",
						userName: "my_bot",
					},
				},
			}),
		);
	});

	it("rejects a bot for a schedule that has no delivery thread", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockImplementation(async (command: string) =>
			command === "schedule.get"
				? {
						ok: true,
						payload: { schedule: { scheduleId: "sched_1", metadata: {} } },
					}
				: { ok: true, payload: { schedule: { scheduleId: "sched_1" } } },
		);

		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"update",
				"sched_1",
				"--delivery-adapter",
				"telegram",
				"--delivery-bot",
				"my_bot",
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
			"schedule delivery needs --delivery-thread <id>: send /whereami in the chat to get it",
		]);
		expect(mockHubClientCommand).not.toHaveBeenCalledWith(
			"schedule.update",
			expect.anything(),
		);
	});

	async function updateWithStoredMetadata(
		storedMetadata: Record<string, unknown>,
		metadataJson: string,
	): Promise<{ code: number; errors: string[] }> {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockImplementation(async (command: string) =>
			command === "schedule.get"
				? {
						ok: true,
						payload: {
							schedule: { scheduleId: "sched_1", metadata: storedMetadata },
						},
					}
				: { ok: true, payload: { schedule: { scheduleId: "sched_1" } } },
		);
		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"update",
				"sched_1",
				"--metadata-json",
				metadataJson,
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
		return { code, errors };
	}

	it("keeps a stored delivery without a thread when the JSON doesn't set delivery", async () => {
		const { code, errors } = await updateWithStoredMetadata(
			{ delivery: { adapter: "telegram", userName: "my_bot" } },
			'{"owner":"ops"}',
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.update",
			expect.objectContaining({
				metadata: {
					delivery: { adapter: "telegram", userName: "my_bot" },
					owner: "ops",
				},
			}),
		);
	});

	it("rejects a JSON delivery that replaces a working one without a thread", async () => {
		const { code, errors } = await updateWithStoredMetadata(
			{ delivery: { adapter: "telegram", threadId: "telegram:123456789" } },
			'{"delivery":{"adapter":"telegram"}}',
		);

		expect(code).toBe(1);
		expect(errors).toEqual([
			"schedule delivery needs --metadata-json delivery.threadId: send /whereami in the chat to get it",
		]);
		expect(mockHubClientCommand).not.toHaveBeenCalledWith(
			"schedule.update",
			expect.anything(),
		);
	});

	it("removes the delivery when the JSON sets it to null", async () => {
		const { code, errors } = await updateWithStoredMetadata(
			{
				delivery: { adapter: "telegram", threadId: "telegram:123456789" },
				owner: "ops",
			},
			'{"delivery":null}',
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.update",
			expect.objectContaining({
				metadata: { delivery: null, owner: "ops" },
			}),
		);
	});
});

describe("runScheduleCommand import", () => {
	afterEach(() => {
		vi.clearAllMocks();
		mockProviderSettings.lastUsed = undefined;
		mockProviderSettings.providers = {};
	});

	it("rejects a file whose delivery has no chat, naming the file and path", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const sourcePath = join(
			tmpdir(),
			`cline-schedule-import-delivery-${Date.now()}.json`,
		);
		await writeFile(
			sourcePath,
			JSON.stringify({
				name: "Daily Review",
				cronPattern: "0 9 * * *",
				prompt: "review status",
				workspaceRoot: "/tmp/workspace",
				modelSelection: { providerId: "anthropic", modelId: "claude" },
				metadata: { delivery: { adapter: "telegram", userName: "my_bot" } },
			}),
			"utf8",
		);

		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["import", sourcePath, "--address", "127.0.0.1:25463"],
				{
					writeln: () => {},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(1);
			expect(errors).toEqual([
				`schedule delivery needs ${sourcePath} metadata.delivery.threadId: send /whereami in the chat to get it`,
			]);
			expect(mockHubClientCommand).not.toHaveBeenCalled();
		} finally {
			await rm(sourcePath, { force: true });
		}
	});

	it("preserves exported modelSelection providerId/modelId values", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockResolvedValue({
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
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.create",
			expect.objectContaining({
				provider: "anthropic",
				model: "claude-sonnet-4-6",
			}),
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
		mockHubClientCommand.mockResolvedValue({
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
			expect(mockHubClientCommand).toHaveBeenCalledWith("schedule.get", {
				scheduleId: "sched_abc",
			});
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
		mockHubClientCommand.mockResolvedValue({
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
