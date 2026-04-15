import { fstatSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
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
const sessionMocks = vi.hoisted(() => ({
	deleteSession: vi.fn(),
	listSessions: vi.fn(async () => []),
	updateSession: vi.fn(),
}));
const llmMocks = vi.hoisted(() => ({
	resolveProviderConfig: vi.fn(async () => undefined),
}));
const promptMocks = vi.hoisted(() => ({
	resolveSystemPrompt: vi.fn(async () => "system prompt"),
}));
const runtimeMocks = vi.hoisted(() => ({
	runAgent: vi.fn(async () => {
		mockState.runAgentCalls += 1;
	}),
	runInteractive: vi.fn(),
}));
const historyMocks = vi.hoisted(() => ({
	runHistoryList: vi.fn(async () => 0),
	runHistoryDelete: vi.fn(async () => 0),
	runHistoryUpdate: vi.fn(async () => 0),
}));
const checkpointMocks = vi.hoisted(() => ({
	runCheckpointStatus: vi.fn(async () => 0),
	runCheckpointList: vi.fn(async () => 0),
	runCheckpointRestore: vi.fn(async () => 0),
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
		Llms: {
			...actual.Llms,
			resolveProviderConfig: llmMocks.resolveProviderConfig,
		},
		createTeamName: vi.fn(() => "team-test"),
		createUserInstructionConfigWatcher: vi.fn(
			() =>
				({
					start: vi.fn(async () => {}),
					stop: vi.fn(() => {}),
				}) as any,
		),
		loadRulesForSystemPromptFromWatcher: vi.fn(() => []),
		ProviderSettingsManager: class {
			getLastUsedProviderSettings() {
				return undefined;
			}
			getProviderSettings() {
				return undefined;
			}
			saveProviderSettings() {}
		},
	};
});
vi.mock("./commands/auth", () => authMocks);
vi.mock("./runtime/prompt", () => ({
	resolveSystemPrompt: promptMocks.resolveSystemPrompt,
}));
vi.mock("./commands/history", () => historyMocks);
vi.mock("./commands/checkpoint", () => checkpointMocks);
vi.mock("./logging/adapter", () => loggingMocks);

describe("runCli lightweight command dispatch", () => {
	afterEach(() => {
		process.exitCode = undefined;
	});

	beforeEach(() => {
		process.exitCode = undefined;
		historyMocks.runHistoryList.mockReset();
		historyMocks.runHistoryList.mockResolvedValue(0);
		historyMocks.runHistoryDelete.mockReset();
		historyMocks.runHistoryDelete.mockResolvedValue(0);
		historyMocks.runHistoryUpdate.mockReset();
		historyMocks.runHistoryUpdate.mockResolvedValue(0);
		checkpointMocks.runCheckpointStatus.mockReset();
		checkpointMocks.runCheckpointStatus.mockResolvedValue(0);
		checkpointMocks.runCheckpointList.mockReset();
		checkpointMocks.runCheckpointList.mockResolvedValue(0);
		checkpointMocks.runCheckpointRestore.mockReset();
		checkpointMocks.runCheckpointRestore.mockResolvedValue(0);
		runtimeMocks.runAgent.mockReset();
		runtimeMocks.runAgent.mockImplementation(async () => {
			mockState.runAgentCalls += 1;
		});
		runtimeMocks.runInteractive.mockReset();
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

	it("does not load runtime modules for checkpoint status json listing", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;

		process.argv = ["bun", "src/index.ts", "checkpoint", "--json", "status"];

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

	it("does not load interactive runtime for single-prompt mode", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;
		mockState.runAgentCalls = 0;

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		process.argv = ["bun", "src/index.ts", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(mockState.runAgentImports).toBe(1);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("rewrites /team prompts and enables teams in single-prompt mode", async () => {
		mockState.runAgentCalls = 0;
		runtimeMocks.runAgent.mockClear();

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		process.argv = ["bun", "src/index.ts", "/team", "find", "the", "bug"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(runtimeMocks.runAgent).toHaveBeenCalledWith(
			'<user_command slash="team">spawn a team of agents for the following task: find the bug</user_command>',
			expect.objectContaining({
				enableAgentTeams: true,
				teamName: "team-test",
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
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
		} as any);
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
		} as any);
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
		} as any);
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
