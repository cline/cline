import { afterEach, describe, expect, it, vi } from "vitest";

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
const loggingMocks = vi.hoisted(() => ({
	createCliLoggerAdapter: vi.fn(() => ({
		core: undefined,
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
vi.mock("@clinebot/core/node", () => ({
	createTeamName: vi.fn(() => "team-test"),
	createUserInstructionConfigWatcher: vi.fn(() => ({
		start: vi.fn(async () => {}),
		stop: vi.fn(() => {}),
	})),
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
}));
vi.mock("./commands/auth", () => authMocks);
vi.mock("@clinebot/llms", () => ({
	LlmsProviders: {
		resolveProviderConfig: llmMocks.resolveProviderConfig,
	},
}));
vi.mock("./runtime/prompt", () => ({
	resolveSystemPrompt: promptMocks.resolveSystemPrompt,
}));
vi.mock("./commands/history", () => historyMocks);
vi.mock("./logging/adapter", () => loggingMocks);

describe("runCli lightweight command dispatch", () => {
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
});
