import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
			allWorkspaces: true,
			limit: 100,
			enabled: undefined,
			tags: undefined,
		});
	});

	it("lists schedules across all workspaces and filters with --workspace", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const inWorkspace = {
			scheduleId: "sched_a",
			name: "daily-issue-summary",
			workspaceRoot: "/Users/someone/project-a",
		};
		const elsewhere = {
			scheduleId: "sched_b",
			name: "daily-pr-summary",
			workspaceRoot: "/Users/someone/project-b",
		};
		mockHubClientCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [inWorkspace, elsewhere] },
		});

		const output: string[] = [];
		const code = await runScheduleCommand(
			[
				"list",
				"--json",
				"--workspace",
				"/Users/someone/project-b",
				"--address",
				"127.0.0.1:25463",
			],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
		);

		expect(code).toBe(0);
		// The hub query spans every workspace, and fetches wide so the global
		// limit cannot truncate away this workspace's matches before the
		// client-side --workspace filter runs.
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.list",
			expect.objectContaining({ allWorkspaces: true, limit: 10_000 }),
		);
		expect(JSON.parse(output.join("\n"))).toEqual([elsewhere]);
	});

	it("applies --limit after the --workspace filter", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const matchA = {
			scheduleId: "sched_a",
			name: "match-a",
			workspaceRoot: "/Users/someone/project-b",
		};
		const matchB = {
			scheduleId: "sched_b",
			name: "match-b",
			workspaceRoot: "/Users/someone/project-b",
		};
		mockHubClientCommand.mockResolvedValue({
			ok: true,
			payload: {
				schedules: [
					{
						scheduleId: "sched_other",
						name: "other",
						workspaceRoot: "/Users/someone/project-a",
					},
					matchA,
					matchB,
				],
			},
		});

		const output: string[] = [];
		const code = await runScheduleCommand(
			[
				"list",
				"--json",
				"--limit",
				"1",
				"--workspace",
				"/Users/someone/project-b",
				"--address",
				"127.0.0.1:25463",
			],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith(
			"schedule.list",
			expect.objectContaining({ limit: 10_000 }),
		);
		expect(JSON.parse(output.join("\n"))).toEqual([matchA]);
	});

	it("matches --workspace across symlinked path forms", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const root = join(tmpdir(), `cline-cli-schedule-links-${Date.now()}`);
		const realWorkspace = join(root, "real-workspace");
		const linkedWorkspace = join(root, "linked-workspace");
		await mkdir(realWorkspace, { recursive: true });
		await symlink(realWorkspace, linkedWorkspace, "dir");
		try {
			const schedule = {
				scheduleId: "sched_real",
				name: "daily-summary",
				workspaceRoot: realWorkspace,
			};
			mockHubClientCommand.mockResolvedValue({
				ok: true,
				payload: { schedules: [schedule] },
			});

			const output: string[] = [];
			const code = await runScheduleCommand(
				[
					"list",
					"--json",
					"--workspace",
					linkedWorkspace,
					"--address",
					"127.0.0.1:25463",
				],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: () => {},
				},
			);

			expect(code).toBe(0);
			expect(JSON.parse(output.join("\n"))).toEqual([schedule]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("sends allWorkspaces on id-addressed schedule commands", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockHubClientCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_a" } },
		});

		const code = await runScheduleCommand(
			["pause", "sched_a", "--address", "127.0.0.1:25463"],
			{
				writeln: () => {},
				writeErr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(mockHubClientCommand).toHaveBeenCalledWith("schedule.disable", {
			allWorkspaces: true,
			scheduleId: "sched_a",
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

describe("runScheduleCommand local client across workspaces", () => {
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.CLINE_CRON_DB_PATH;
	});

	it("lists schedules created for another workspace without a hub address", async () => {
		const root = join(tmpdir(), `cline-cli-schedules-${Date.now()}`);
		const workspaceA = join(root, "workspace-a");
		await mkdir(workspaceA, { recursive: true });
		process.env.CLINE_CRON_DB_PATH = join(root, "cron.db");
		try {
			const created = await runScheduleCommand(
				[
					"create",
					"daily-issue-summary",
					"--cron",
					"0 7 * * *",
					"--prompt",
					"Summarize new issues.",
					"--workspace",
					workspaceA,
					"--provider",
					"cline",
					"--model",
					"cline/test-model",
					"--disabled",
				],
				{
					writeln: () => {},
					writeErr: () => {},
				},
			);
			expect(created).toBe(0);

			// The list runs from this test process's cwd, which is not
			// workspace-a. The schedule must still appear, matching how the
			// desktop Schedules page shows every schedule on the machine.
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
			expect(errors).toEqual([]);
			expect(code).toBe(0);
			const schedules = JSON.parse(output.join("\n")) as Array<{
				name?: string;
				workspaceRoot?: string;
			}>;
			expect(schedules).toHaveLength(1);
			expect(schedules[0]).toMatchObject({
				name: "daily-issue-summary",
				workspaceRoot: workspaceA,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
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
				allWorkspaces: true,
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
