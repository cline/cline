import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionManagerMocks = vi.hoisted(() => ({
	start: vi.fn(),
	send: vi.fn(),
	stop: vi.fn(),
	dispose: vi.fn(),
	abort: vi.fn(),
	getAccumulatedUsage: vi.fn(),
}));

const hookMocks = vi.hoisted(() => ({
	createRuntimeHooks: vi.fn(),
	runtimeHooks: {
		hooks: undefined,
		shutdown: vi.fn(),
	},
}));

const outputMocks = vi.hoisted(() => ({
	writeln: vi.fn(),
	writeErr: vi.fn(),
	emitJsonLine: vi.fn(),
	getActiveCliSession: vi.fn(() => undefined),
	setActiveCliSession: vi.fn(),
	formatUsd: vi.fn(() => "$0"),
	c: { dim: "", reset: "" },
}));

vi.mock("@clinebot/core", () => ({
	prewarmFileIndex: vi.fn(),
	SessionSource: {
		CLI: "cli",
	},
}));

vi.mock("../utils/approval", () => ({
	askQuestionInTerminal: vi.fn(),
	requestToolApproval: vi.fn(),
	submitAndExitInTerminal: vi.fn(),
}));

vi.mock("../utils/events", () => ({
	handleEvent: vi.fn(),
	handleTeamEvent: vi.fn(),
}));

vi.mock("../utils/hooks", () => ({
	createRuntimeHooks: hookMocks.createRuntimeHooks,
}));

vi.mock("../utils/output", () => outputMocks);

vi.mock("../utils/session", () => ({
	createDefaultCliSessionManager: vi.fn(async () => sessionManagerMocks),
}));

vi.mock("./active-runtime", () => ({
	setActiveRuntimeAbort: vi.fn(),
}));

vi.mock("./format", () => ({
	describeAbortSource: vi.fn(() => "aborted"),
	resolveMistakeLimitDecision: vi.fn(),
}));

vi.mock("./interactive-welcome", () => ({
	resolveClineWelcomeLine: vi.fn(async () => undefined),
}));

vi.mock("./prompt", () => ({
	buildUserInputMessage: vi.fn(async () => "prompt"),
}));

vi.mock("./session-events", () => ({
	subscribeToAgentEvents: vi.fn(() => () => {}),
}));

describe("runAgent", () => {
	const originalExitCode = process.exitCode;

	beforeEach(() => {
		process.exitCode = undefined;
		sessionManagerMocks.start.mockReset();
		sessionManagerMocks.send.mockReset();
		sessionManagerMocks.stop.mockReset();
		sessionManagerMocks.dispose.mockReset();
		sessionManagerMocks.abort.mockReset();
		sessionManagerMocks.getAccumulatedUsage.mockReset();
		hookMocks.runtimeHooks.shutdown.mockReset();
		hookMocks.createRuntimeHooks.mockReturnValue(hookMocks.runtimeHooks);
		outputMocks.writeErr.mockReset();
		outputMocks.writeln.mockReset();
		outputMocks.emitJsonLine.mockReset();
		outputMocks.setActiveCliSession.mockReset();
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
		vi.clearAllMocks();
	});

	it("does not fail an aborted run when teardown hooks throw", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
			transcriptPath: "/tmp/transcript.jsonl",
			hookPath: "/tmp/hooks.jsonl",
			messagesPath: "/tmp/messages.json",
			manifest: {
				session_id: "session-1",
			},
			result: {
				text: "aborted",
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: undefined,
				},
				messages: [],
				toolCalls: [],
				iterations: 0,
				finishReason: "aborted",
				model: {
					id: "gemini",
					provider: "openrouter",
					info: {},
				},
				startedAt,
				endedAt,
				durationMs: 1000,
			},
		});
		sessionManagerMocks.stop.mockRejectedValue(new Error("stop failed"));
		sessionManagerMocks.dispose.mockRejectedValue(new Error("dispose failed"));
		hookMocks.runtimeHooks.shutdown.mockRejectedValue(
			new Error("hook shutdown failed"),
		);

		const { runAgent } = await import("./run-agent");

		await expect(
			runAgent("test prompt", {
				cwd: process.cwd(),
				enableAgentTeams: false,
				enableSpawnAgent: false,
				enableTools: [],
				execution: {
					maxConsecutiveMistakes: 3,
				},
				logger: undefined,
				maxIterations: 10,
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				showTimings: false,
				showUsage: false,
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).not.toBe(1);
		expect(outputMocks.writeErr).not.toHaveBeenCalledWith(
			"hook shutdown failed",
		);
	});
});
