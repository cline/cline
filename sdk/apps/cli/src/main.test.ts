import { fstatSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Real `fstatSync`: used when tests stub only stdin (fd 0); throwing for every fd breaks imports and session I/O. */
const fsActual = vi.hoisted(() => ({
	realFstatSync: null as null | typeof import("node:fs").fstatSync,
}));
vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	fsActual.realFstatSync = actual.fstatSync;
	return { ...actual, fstatSync: vi.fn(actual.fstatSync) };
});

const originalArgv = [...process.argv];
const originalStdinIsTTY = process.stdin.isTTY;
const mockState = vi.hoisted(() => ({
	runAgentImports: 0,
	runInteractiveImports: 0,
	runAgentCalls: 0,
}));
const authMocks = vi.hoisted(() => ({
	ensureOAuthProviderApiKey: vi.fn(),
	getPersistedProviderApiKey: vi.fn(() => undefined),
	isOAuthProvider: vi.fn(() => false),
	normalizeProviderId: vi.fn((providerId?: string) => providerId ?? "cline"),
	parseAuthCommandArgs: vi.fn(),
	runAuthCommand: vi.fn(),
}));
const providerSettingsMocks = vi.hoisted(() => ({
	getLastUsedProviderSettings: vi.fn<() => unknown>(() => undefined),
	getProviderSettings: vi.fn<(providerId: string) => unknown>(() => undefined),
	saveProviderSettings: vi.fn<(settings: unknown, options?: unknown) => void>(
		() => {},
	),
}));
const sessionMocks = vi.hoisted(() => ({
	deleteSession: vi.fn(),
	listSessions: vi.fn(async () => []),
	updateSession: vi.fn(),
}));
const llmMocks = vi.hoisted(() => ({
	resolveProviderConfig: vi.fn(async (): Promise<unknown> => undefined),
}));
const promptMocks = vi.hoisted(() => ({
	resolveSystemPrompt: vi.fn(async () => "system prompt"),
}));
const kanbanMocks = vi.hoisted(() => ({
	launchKanban: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
	runAgent: vi.fn(async () => {
		mockState.runAgentCalls += 1;
	}),
	runInteractive: vi.fn(),
}));
const historyMocks = vi.hoisted(() => ({
	runHistoryList: vi.fn<() => Promise<number | string>>(async () => 0),
	runHistoryDelete: vi.fn(async () => 0),
	runHistoryExport: vi.fn(async () => 0),
	runHistoryUpdate: vi.fn(async () => 0),
}));
const loggingMocks = vi.hoisted(() => ({
	createCliLoggerAdapter: vi.fn(() => ({
		core: {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		},
		runtimeConfig: undefined,
	})),
	flushCliLoggerAdapters: vi.fn(),
}));
const hubRuntimeMocks = vi.hoisted(() => ({
	ensureCliHubServer: vi.fn(async () => "ws://127.0.0.1:25463"),
}));

function forcePromptModeInput() {
	Object.defineProperty(process.stdin, "isTTY", {
		value: true,
		configurable: true,
	});
	vi.mocked(fstatSync).mockImplementation((fd, ...rest) => {
		if (fd === 0) {
			throw new Error("stdin not piped");
		}
		const real = fsActual.realFstatSync;
		if (!real) {
			throw new Error("node:fs fstatSync mock not initialized");
		}
		return real(fd, ...rest) as
			| import("node:fs").Stats
			| import("node:fs").BigIntStats;
	});
}

vi.mock("./runtime/run-agent", () => {
	mockState.runAgentImports += 1;
	return {
		runAgent: runtimeMocks.runAgent,
	};
});
vi.mock("./runtime/run-interactive", () => {
	mockState.runInteractiveImports += 1;
	return {
		runInteractive: runtimeMocks.runInteractive,
	};
});
vi.mock("./utils/session", () => sessionMocks);
vi.mock("@clinebot/core", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/core")>("@clinebot/core");
	return {
		...actual,
		resolveProviderConfig: llmMocks.resolveProviderConfig,
		createTeamName: vi.fn(() => "team-test"),
		createUserInstructionConfigWatcher: vi.fn(() =>
			actual.createUserInstructionConfigWatcher({
				skills: { directories: [] },
				rules: { directories: [] },
				workflows: { directories: [] },
			}),
		),
		loadRulesForSystemPromptFromWatcher: vi.fn(() => []),
		ProviderSettingsManager: class {
			getLastUsedProviderSettings() {
				return providerSettingsMocks.getLastUsedProviderSettings();
			}
			getProviderSettings(providerId: string) {
				return providerSettingsMocks.getProviderSettings(providerId);
			}
			saveProviderSettings(settings: unknown, options?: unknown) {
				providerSettingsMocks.saveProviderSettings(settings, options);
			}
		},
	};
});
vi.mock("./utils/provider-auth", () => authMocks);
vi.mock("./runtime/prompt", () => ({
	resolveSystemPrompt: promptMocks.resolveSystemPrompt,
}));
vi.mock("./commands/kanban", () => kanbanMocks);
vi.mock("./commands/history", () => historyMocks);
vi.mock("./logging/adapter", () => loggingMocks);
vi.mock("./utils/hub-runtime", () => hubRuntimeMocks);

describe("runCli lightweight command dispatch", () => {
	afterEach(() => {
		process.exitCode = undefined;
	});

	beforeEach(() => {
		process.exitCode = undefined;
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;
		mockState.runAgentCalls = 0;
		historyMocks.runHistoryList.mockReset();
		historyMocks.runHistoryList.mockResolvedValue(0);
		historyMocks.runHistoryDelete.mockReset();
		historyMocks.runHistoryDelete.mockResolvedValue(0);
		historyMocks.runHistoryExport.mockReset();
		historyMocks.runHistoryExport.mockResolvedValue(0);
		historyMocks.runHistoryUpdate.mockReset();
		historyMocks.runHistoryUpdate.mockResolvedValue(0);
		runtimeMocks.runAgent.mockReset();
		runtimeMocks.runAgent.mockImplementation(async () => {
			mockState.runAgentCalls += 1;
		});
		runtimeMocks.runInteractive.mockReset();
		hubRuntimeMocks.ensureCliHubServer.mockReset();
		hubRuntimeMocks.ensureCliHubServer.mockResolvedValue(
			"ws://127.0.0.1:25463",
		);
		llmMocks.resolveProviderConfig.mockReset();
		llmMocks.resolveProviderConfig.mockResolvedValue(undefined);
		authMocks.ensureOAuthProviderApiKey.mockReset();
		authMocks.getPersistedProviderApiKey.mockReset();
		authMocks.getPersistedProviderApiKey.mockReturnValue(undefined);
		authMocks.isOAuthProvider.mockReset();
		authMocks.isOAuthProvider.mockReturnValue(false);
		authMocks.normalizeProviderId.mockReset();
		authMocks.normalizeProviderId.mockImplementation(
			(providerId?: string) => providerId ?? "cline",
		);
		authMocks.parseAuthCommandArgs.mockReset();
		authMocks.runAuthCommand.mockReset();
		providerSettingsMocks.getLastUsedProviderSettings.mockReset();
		providerSettingsMocks.getLastUsedProviderSettings.mockReturnValue(
			undefined,
		);
		providerSettingsMocks.getProviderSettings.mockReset();
		providerSettingsMocks.getProviderSettings.mockReturnValue(undefined);
		providerSettingsMocks.saveProviderSettings.mockReset();
		kanbanMocks.launchKanban.mockReset();
		kanbanMocks.launchKanban.mockResolvedValue(0);
		// CI: fd 0 is often a pipe with no EOF. If routing ever falls through to agent bootstrap,
		// `main` can block forever in `for await (process.stdin)` (see `!process.stdin.isTTY && …`).
		// Mark stdin as a TTY so that path is skipped in unit tests (real piped-input behavior is
		// covered elsewhere). `forcePromptModeInput()` in agent tests still tightens fstat on fd 0.
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
	});

	afterEach(() => {
		process.argv = [...originalArgv];
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalStdinIsTTY,
			configurable: true,
		});
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("does not load runtime modules for history json listing", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;

		process.argv = ["bun", "src/index.ts", "history", "--json"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(process.exitCode).toBe(0);
		expect(mockState.runAgentImports).toBe(0);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("exits gracefully for handled command errors", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;

		process.argv = ["bun", "src/index.ts", "history", "delete"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(process.exitCode).toBe(0);
		expect(mockState.runAgentImports).toBe(0);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("does not load runtime modules for history export", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;

		process.argv = ["bun", "src/index.ts", "history", "export", "sess_1"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(process.exitCode).toBe(0);
		expect(historyMocks.runHistoryExport).toHaveBeenCalledWith(
			"sess_1",
			undefined,
			"text",
			expect.any(Object),
		);
		expect(mockState.runAgentImports).toBe(0);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("does not load interactive runtime for single-prompt mode", async () => {
		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runAgent).toHaveBeenCalledTimes(1);
		expect(mockState.runAgentImports).toBe(1);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("does not force chat view for default interactive mode", async () => {
		process.argv = ["bun", "src/index.ts"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			undefined,
			expect.objectContaining({
				initialView: undefined,
			}),
		);
	});

	it("does not start OAuth before onboarding in interactive mode", async () => {
		authMocks.isOAuthProvider.mockReturnValue(true);
		authMocks.normalizeProviderId.mockReturnValue("cline");
		authMocks.getPersistedProviderApiKey.mockReturnValue(undefined);
		authMocks.ensureOAuthProviderApiKey.mockClear();
		process.argv = ["bun", "src/index.ts", "-i"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(authMocks.ensureOAuthProviderApiKey).not.toHaveBeenCalled();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline",
				apiKey: "",
			}),
			expect.anything(),
			undefined,
			expect.any(Object),
		);
	});

	it("loads live catalog models for default interactive model selection", async () => {
		llmMocks.resolveProviderConfig.mockResolvedValue({
			knownModels: {
				"live-only-model": {
					id: "live-only-model",
					name: "Live Only Model",
				},
			},
		});
		process.argv = ["bun", "src/index.ts"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(llmMocks.resolveProviderConfig).toHaveBeenCalledWith("cline", {
			loadLatestOnInit: true,
			loadPrivateOnAuth: true,
			failOnError: false,
		});
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.objectContaining({
				knownModels: expect.objectContaining({
					"live-only-model": expect.objectContaining({
						name: "Live Only Model",
					}),
				}),
			}),
			expect.anything(),
			undefined,
			expect.any(Object),
		);
	});

	it("passes a positional prompt into TUI mode for startup submission", async () => {
		process.argv = ["bun", "src/index.ts", "sup", "-i"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(llmMocks.resolveProviderConfig).toHaveBeenCalledWith("cline", {
			loadLatestOnInit: true,
			loadPrivateOnAuth: true,
			failOnError: false,
		});
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			undefined,
			expect.objectContaining({
				initialPrompt: "sup",
				initialView: undefined,
			}),
		);
	});

	it("uses the bundled catalog path for single-prompt runs", async () => {
		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(llmMocks.resolveProviderConfig).toHaveBeenCalledWith(
			"cline",
			undefined,
		);
		expect(runtimeMocks.runAgent).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).not.toHaveBeenCalled();
	});

	it("applies --autoapprove as a runtime policy without changing the config default", async () => {
		process.argv = ["bun", "src/index.ts", "--autoapprove", "false"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultToolAutoApprove: true,
				toolPolicies: {
					"*": { autoApprove: false },
				},
			}),
			expect.anything(),
			undefined,
			expect.any(Object),
		);
	});

	it("forces chat view when resuming a session", async () => {
		process.argv = ["bun", "src/index.ts", "--id", "sess_123"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			"sess_123",
			expect.objectContaining({
				initialView: "chat",
			}),
		);
	});

	it("forces chat view when resuming from history picker", async () => {
		historyMocks.runHistoryList.mockImplementationOnce(
			async () => "sess_from_history",
		);
		process.argv = ["bun", "src/index.ts", "history"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			"sess_from_history",
			expect.objectContaining({
				initialPrompt: undefined,
				initialView: "chat",
			}),
		);
	});

	it("does not pass non-Cline provider settings as Cline account options", async () => {
		providerSettingsMocks.getLastUsedProviderSettings.mockReturnValue({
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "openai/gpt-5",
		});
		providerSettingsMocks.getProviderSettings.mockReturnValue({
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "openai/gpt-5",
		});
		authMocks.normalizeProviderId.mockImplementation(
			(providerId?: string) => providerId ?? "openrouter",
		);
		process.argv = ["bun", "src/index.ts"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			undefined,
			expect.objectContaining({
				clineApiBaseUrl: undefined,
				clineProviderSettings: undefined,
			}),
		);
	});

	it("passes Cline provider settings as Cline account options", async () => {
		const clineSettings = {
			provider: "cline",
			baseUrl: "https://api.example.test",
			model: "anthropic/claude-sonnet-4.6",
		};
		providerSettingsMocks.getLastUsedProviderSettings.mockReturnValue(
			clineSettings,
		);
		providerSettingsMocks.getProviderSettings.mockReturnValue(clineSettings);
		authMocks.normalizeProviderId.mockImplementation(
			(providerId?: string) => providerId ?? "cline",
		);
		process.argv = ["bun", "src/index.ts"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runInteractive).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runInteractive).toHaveBeenCalledWith(
			expect.any(Object),
			expect.anything(),
			undefined,
			expect.objectContaining({
				clineApiBaseUrl: "https://api.example.test",
				clineProviderSettings: clineSettings,
			}),
		);
	});

	it("launches kanban and exits before loading runtime modules", async () => {
		process.argv = ["bun", "src/index.ts", "kanban"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(kanbanMocks.launchKanban).toHaveBeenCalledTimes(1);
		expect(mockState.runAgentImports).toBe(0);
		expect(mockState.runInteractiveImports).toBe(0);
		expect(process.exitCode).toBe(0);
	});

	it("prints an install hint when kanban is missing", async () => {
		const stderrWrite = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		kanbanMocks.launchKanban.mockImplementation(async () => {
			process.stderr.write(
				'kanban is not installed. Install it with "npm i -g kanban"\n',
			);
			return 1;
		});
		process.argv = ["bun", "src/index.ts", "kanban"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(stderrWrite).toHaveBeenCalledWith(
			expect.stringContaining(
				'kanban is not installed. Install it with "npm i -g kanban"',
			),
		);
		expect(process.exitCode).toBe(1);
	});

	it("skips hub prewarm for yolo runs", async () => {
		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "--yolo", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runAgent).toHaveBeenCalledTimes(1);
		expect(hubRuntimeMocks.ensureCliHubServer).not.toHaveBeenCalled();
	});

	it("rewrites /team prompts and enables teams in single-prompt mode", async () => {
		runtimeMocks.runAgent.mockClear();

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "/team", "find", "the", "bug"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runAgent).toHaveBeenCalledTimes(1);
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			'<user_command slash="team">spawn a team of agents for the following task: find the bug</user_command>',
			expect.objectContaining({
				enableAgentTeams: true,
				teamName: undefined,
			}),
			expect.anything(),
		);
	});

	it("shows /team usage in single-prompt mode when no task is provided", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();
		const stdoutWrite = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "/team"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(0);
		expect(stdoutWrite).toHaveBeenCalledWith(
			expect.stringContaining("Usage: /team <task description>"),
		);
	});

	it("enables thinking when reasoning effort is provided", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();

		forcePromptModeInput();
		process.argv = [
			"bun",
			"src/index.ts",
			"--reasoning-effort",
			"high",
			"hello",
		];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({
				thinking: true,
				reasoningEffort: "high",
			}),
			expect.anything(),
		);
	});

	it("maps --thinking to medium effort", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "--thinking", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({
				compaction: {
					enabled: true,
				},
				thinking: true,
				reasoningEffort: "medium",
			}),
			expect.anything(),
		);
	});

	it("enables compaction by default for prompt runs", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({
				compaction: {
					enabled: true,
				},
			}),
			expect.anything(),
		);
	});

	it("does not fail fast for headless json mode with an OAuth provider", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();
		authMocks.isOAuthProvider.mockReturnValue(true);
		authMocks.normalizeProviderId.mockReturnValue("cline");
		authMocks.getPersistedProviderApiKey.mockReturnValue(undefined);
		authMocks.ensureOAuthProviderApiKey.mockClear();

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "--json", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(authMocks.ensureOAuthProviderApiKey).not.toHaveBeenCalled();
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({
				outputMode: "json",
				apiKey: "",
				providerId: "cline",
			}),
			expect.anything(),
		);
	});

	it("does not fail fast for headless json mode with a non-OAuth provider", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();
		authMocks.isOAuthProvider.mockReturnValue(false);
		authMocks.normalizeProviderId.mockReturnValue("anthropic");
		authMocks.getPersistedProviderApiKey.mockReturnValue(undefined);
		authMocks.ensureOAuthProviderApiKey.mockClear();

		forcePromptModeInput();
		process.argv = ["bun", "src/index.ts", "--json", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(authMocks.ensureOAuthProviderApiKey).not.toHaveBeenCalled();
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({
				outputMode: "json",
				apiKey: "",
				providerId: "anthropic",
			}),
			expect.anything(),
		);
	});
});

describe("stdinHasPipedInput", () => {
	const originalIsTTY = process.stdin.isTTY;

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			configurable: true,
		});
		vi.mocked(fstatSync).mockRestore();
	});

	it("returns false when stdin is a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		const { stdinHasPipedInput } = await import("./main");
		expect(stdinHasPipedInput()).toBe(false);
	});

	it("returns true when stdin is a FIFO (pipe)", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: undefined,
			configurable: true,
		});
		vi.mocked(fstatSync).mockReturnValue({
			isFIFO: () => true,
			isFile: () => false,
		} as unknown as ReturnType<typeof fstatSync>);
		const { stdinHasPipedInput } = await import("./main");
		expect(stdinHasPipedInput()).toBe(true);
	});

	it("returns true when stdin is a file", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: undefined,
			configurable: true,
		});
		vi.mocked(fstatSync).mockReturnValue({
			isFIFO: () => false,
			isFile: () => true,
		} as unknown as ReturnType<typeof fstatSync>);
		const { stdinHasPipedInput } = await import("./main");
		expect(stdinHasPipedInput()).toBe(true);
	});

	it("returns false in headless/CI (not TTY, not pipe, not file)", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: undefined,
			configurable: true,
		});
		vi.mocked(fstatSync).mockReturnValue({
			isFIFO: () => false,
			isFile: () => false,
		} as unknown as ReturnType<typeof fstatSync>);
		const { stdinHasPipedInput } = await import("./main");
		expect(stdinHasPipedInput()).toBe(false);
	});

	it("returns false when fstatSync throws", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: undefined,
			configurable: true,
		});
		vi.mocked(fstatSync).mockImplementation(() => {
			throw new Error("EBADF");
		});
		const { stdinHasPipedInput } = await import("./main");
		expect(stdinHasPipedInput()).toBe(false);
	});
});

describe("resolveConfigDirArg", () => {
	it("returns undefined when --config is not present", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg([])).toBeUndefined();
		expect(
			resolveConfigDirArg(["auth", "--provider", "openai"]),
		).toBeUndefined();
	});

	it("parses the space-separated form: --config <dir>", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg(["--config", "./mycfg"])).toBe("./mycfg");
		expect(
			resolveConfigDirArg([
				"auth",
				"--config",
				"./mycfg",
				"--provider",
				"openai",
			]),
		).toBe("./mycfg");
	});

	it("parses the equals form: --config=<dir>", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg(["--config=./mycfg"])).toBe("./mycfg");
		expect(
			resolveConfigDirArg(["auth", "--config=./mycfg", "--provider", "openai"]),
		).toBe("./mycfg");
	});

	it("trims surrounding whitespace from the value", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg(["--config", "  ./mycfg  "])).toBe("./mycfg");
		expect(resolveConfigDirArg(["--config=  ./mycfg  "])).toBe("./mycfg");
	});

	it("returns undefined for empty or whitespace-only values", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg(["--config", ""])).toBeUndefined();
		expect(resolveConfigDirArg(["--config", "   "])).toBeUndefined();
		expect(resolveConfigDirArg(["--config="])).toBeUndefined();
		expect(resolveConfigDirArg(["--config=   "])).toBeUndefined();
	});

	it("returns undefined when --config has no following value (space form)", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(resolveConfigDirArg(["--config"])).toBeUndefined();
	});

	it("returns the first occurrence when --config appears multiple times", async () => {
		const { resolveConfigDirArg } = await import("./main");
		expect(
			resolveConfigDirArg(["--config", "./first", "--config", "./second"]),
		).toBe("./first");
		expect(resolveConfigDirArg(["--config=./first", "--config=./second"])).toBe(
			"./first",
		);
	});

	it("does not match unrelated flags that share a prefix", async () => {
		const { resolveConfigDirArg } = await import("./main");
		// e.g. a hypothetical --configure flag must not be picked up.
		expect(resolveConfigDirArg(["--configure", "./foo"])).toBeUndefined();
		expect(resolveConfigDirArg(["--configure=./foo"])).toBeUndefined();
	});
});
