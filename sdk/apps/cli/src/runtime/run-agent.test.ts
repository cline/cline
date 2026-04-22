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

vi.mock("../session/session", () => ({
	createCliCore: vi.fn(async () => sessionManagerMocks),
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
	buildUserInputMessage: vi.fn(async () => ({
		prompt: "prompt",
		userImages: [],
		userFiles: [],
	})),
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
		sessionManagerMocks.stop.mockResolvedValue(undefined);
		sessionManagerMocks.dispose.mockReset();
		sessionManagerMocks.dispose.mockResolvedValue(undefined);
		sessionManagerMocks.abort.mockReset();
		sessionManagerMocks.abort.mockResolvedValue(undefined);
		sessionManagerMocks.getAccumulatedUsage.mockReset();
		hookMocks.runtimeHooks.shutdown.mockReset();
		hookMocks.runtimeHooks.shutdown.mockResolvedValue(undefined);
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

	it("starts the session with normalized user input", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: {
				session_id: "session-1",
			},
			result: {
				text: "ok",
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: undefined,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "stop",
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

		const { runAgent } = await import("./run-agent");

		await expect(
			runAgent(
				'<user_command slash="team">spawn a team of agents for the following task: how is rpc server started?</user_command>',
				{
					cwd: process.cwd(),
					enableAgentTeams: true,
					enableSpawnAgent: false,
					enableTools: [],
					execution: {
						maxConsecutiveMistakes: 3,
					},
					logger: undefined,
					maxIterations: 10,
					mode: "act",
					modelId: "google/gemini-3-flash-preview",
					outputMode: "text",
					providerId: "openrouter",
					showUsage: false,
					systemPrompt: "system",
					thinking: false,
					toolPolicies: { "*": { autoApprove: true } },
					verbose: false,
					workspaceRoot: process.cwd(),
				} as never,
			),
		).resolves.toBeUndefined();

		expect(sessionManagerMocks.start).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "prompt",
			}),
		);
	});

	it("clears a stale failing exit code after a successful run", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		process.exitCode = 1;
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: {
				session_id: "session-1",
			},
			result: {
				text: "ok",
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: undefined,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "stop",
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
				mode: "act",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				showUsage: false,
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(0);
	});

	it("does not fail an aborted run when teardown hooks throw", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
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

	it("sets a failing exit code when session startup throws", async () => {
		sessionManagerMocks.start.mockRejectedValue(new Error("Missing API key"));

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
				logger: {
					log: vi.fn(),
				},
				maxIterations: 10,
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				showUsage: false,
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
	});
});
