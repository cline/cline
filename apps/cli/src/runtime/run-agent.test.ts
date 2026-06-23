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

const sessionEventsMocks = vi.hoisted(() => ({
	listener: undefined as ((event: unknown) => void) | undefined,
	subscribeToAgentEvents: vi.fn(
		(_: unknown, listener: (event: unknown) => void) => {
			sessionEventsMocks.listener = listener;
			return () => {};
		},
	),
}));

const CLINE_PASS_SUBSCRIPTION_URL =
	"https://app.cline.bot/dashboard/subscription?personal=true";
const CLINE_PASS_SUBSCRIPTION_MESSAGE = `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${CLINE_PASS_SUBSCRIPTION_URL}`;
const CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_MESSAGE =
	"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass";

vi.mock("@cline/core", () => ({
	getClineOrgIndividualInferenceSubscriptionMessage: () =>
		CLINE_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_MESSAGE,
	getClinePassSubscriptionUrl: () => CLINE_PASS_SUBSCRIPTION_URL,
	isClineNotSubscribedError: (error: unknown) =>
		error instanceof Error && error.name === "ClineNotSubscribedError",
	isClineNotSubscribedMessage: (text: string) =>
		text
			.toLowerCase()
			.includes("the user is not subscribed to required model plan"),
	isClineOrgIndividualInferenceSubscriptionError: (error: unknown) =>
		error instanceof Error &&
		error.name === "ClineOrgIndividualInferenceSubscriptionError",
	isClineOrgIndividualInferenceSubscriptionMessage: (text: string) =>
		text
			.toLowerCase()
			.includes(
				"organization accounts cannot use individual model inference subscriptions",
			),
	prewarmFileIndex: vi.fn(async () => undefined),
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
	subscribeToAgentEvents: sessionEventsMocks.subscribeToAgentEvents,
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
		sessionEventsMocks.listener = undefined;
		sessionEventsMocks.subscribeToAgentEvents.mockClear();
		vi.unstubAllGlobals();
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
				finishReason: "completed",
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
					mode: "act",
					modelId: "google/gemini-3-flash-preview",
					outputMode: "text",
					providerId: "openrouter",
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
		const startInput = sessionManagerMocks.start.mock.calls[0]?.[0] as
			| { localRuntime?: Record<string, unknown> }
			| undefined;
		expect(startInput?.localRuntime).toEqual(
			expect.objectContaining({
				onTeamRestored: expect.any(Function),
			}),
		);
		expect(startInput?.localRuntime).not.toHaveProperty(
			"userInstructionService",
		);
	});

	it("registers CLI capability factory through the CLI core facade", async () => {
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
				finishReason: "completed",
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
		const { createCliCore } = await import("../session/session");
		const {
			askQuestionInTerminal,
			requestToolApproval,
			submitAndExitInTerminal,
		} = await import("../utils/approval");

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
				mode: "act",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(createCliCore).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: {
					toolExecutors: {
						askQuestion: askQuestionInTerminal,
						submit: submitAndExitInTerminal,
					},
					requestToolApproval,
				},
			}),
		);
	});

	it("provides submit_and_exit for one-shot yolo runs", async () => {
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
				finishReason: "completed",
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
		const { createCliCore } = await import("../session/session");
		const {
			askQuestionInTerminal,
			requestToolApproval,
			submitAndExitInTerminal,
		} = await import("../utils/approval");

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
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(createCliCore).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: {
					toolExecutors: {
						askQuestion: askQuestionInTerminal,
						submit: submitAndExitInTerminal,
					},
					requestToolApproval,
				},
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
				finishReason: "completed",
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
				mode: "act",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
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
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
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
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};

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
				logger,
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
		expect(logger.error).toHaveBeenCalledWith("CLI task run failed", {
			error: expect.any(Error),
		});
		expect(outputMocks.writeErr).toHaveBeenCalledWith("Missing API key");
	});

	it("renders ClinePass subscription errors with friendly copy when startup throws", async () => {
		const error = new Error(CLINE_PASS_SUBSCRIPTION_MESSAGE);
		error.name = "ClineNotSubscribedError";
		sessionManagerMocks.start.mockRejectedValue(error);

		const { runAgent } = await import("./run-agent");

		await expect(
			runAgent("test prompt", {
				cwd: process.cwd(),
				enableAgentTeams: false,
				enableSpawnAgent: false,
				enableTools: [],
				execution: { maxConsecutiveMistakes: 3 },
				logger: undefined,
				mode: "yolo",
				modelId: "premium-model",
				outputMode: "text",
				providerId: "cline-pass",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
		expect(outputMocks.writeErr).toHaveBeenCalledWith(
			CLINE_PASS_SUBSCRIPTION_MESSAGE,
		);
	});

	it("emits JSON error lines for non-completed results", async () => {
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
				text: 'Missing API key for provider "cline".',
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "error",
				model: {
					id: "anthropic/claude-sonnet-4.6",
					provider: "cline",
					info: {},
				},
				startedAt,
				endedAt,
				durationMs: 1000,
			},
		});
		sessionManagerMocks.getAccumulatedUsage.mockResolvedValue(undefined);

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
				mode: "yolo",
				modelId: "anthropic/claude-sonnet-4.6",
				outputMode: "json",
				providerId: "cline",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
		expect(outputMocks.writeErr).toHaveBeenCalledWith(
			'Missing API key for provider "cline".',
		);
	});

	it("renders ClinePass subscription errors with friendly copy for failed results", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: { session_id: "session-1" },
			result: {
				text: CLINE_PASS_SUBSCRIPTION_MESSAGE,
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "error",
				model: { id: "premium-model", provider: "cline-pass", info: {} },
				startedAt,
				endedAt,
				durationMs: 1000,
			},
		});
		sessionManagerMocks.getAccumulatedUsage.mockResolvedValue(undefined);

		const { runAgent } = await import("./run-agent");

		await expect(
			runAgent("test prompt", {
				cwd: process.cwd(),
				enableAgentTeams: false,
				enableSpawnAgent: false,
				enableTools: [],
				execution: { maxConsecutiveMistakes: 3 },
				logger: undefined,
				mode: "yolo",
				modelId: "premium-model",
				outputMode: "text",
				providerId: "cline-pass",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
		expect(outputMocks.writeErr).toHaveBeenCalledWith(
			CLINE_PASS_SUBSCRIPTION_MESSAGE,
		);
	});

	it("surfaces post-run bookkeeping failures after a completed result", async () => {
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
				text: "completed text",
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
				finishReason: "completed",
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
		sessionManagerMocks.getAccumulatedUsage.mockRejectedValue(
			new Error("usage lookup failed"),
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
				logger: {
					log: vi.fn(),
				},
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
		expect(outputMocks.writeErr).toHaveBeenCalledWith("usage lookup failed");
	});

	it("sets a failing exit code when the run result finishes with an error", async () => {
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
				text: "",
				usage: {
					inputTokens: 1,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: undefined,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "error",
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
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(1);
	});

	it("does not append thinking stats to non-verbose text output", async () => {
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
				text: "completed text",
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
				finishReason: "completed",
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
				mode: "yolo",
				modelId: "google/gemini-3-flash-preview",
				outputMode: "text",
				providerId: "openrouter",
				systemPrompt: "system",
				thinking: true,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(process.exitCode).toBe(0);
		expect(outputMocks.writeln).not.toHaveBeenCalledWith(
			expect.stringContaining("[thinking]"),
		);
	});

	it("omits verbose estimated cost for subscription-backed providers", async () => {
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
				text: "completed text",
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.25,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "completed",
				model: {
					id: "gpt-5.4",
					provider: "openai-codex",
					info: {},
				},
				startedAt,
				endedAt,
				durationMs: 1000,
			},
		});
		sessionManagerMocks.getAccumulatedUsage.mockResolvedValue({
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.25,
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
				mode: "yolo",
				modelId: "gpt-5.4",
				outputMode: "text",
				providerId: "openai-codex",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: true,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		expect(outputMocks.writeln).not.toHaveBeenCalledWith(
			expect.stringContaining("est. cost"),
		);
	});

	it("zeros Cline free model costs in JSON results and agent events", async () => {
		const startedAt = new Date("2026-03-22T00:00:00.000Z");
		const endedAt = new Date("2026-03-22T00:00:01.000Z");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						free: [{ id: "deepseek/deepseek-v4-flash" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);
		sessionManagerMocks.start.mockResolvedValue({
			sessionId: "session-1",
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: {
				session_id: "session-1",
			},
			result: {
				text: "completed text",
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.25,
				},
				messages: [],
				toolCalls: [],
				iterations: 1,
				finishReason: "completed",
				model: {
					id: "deepseek/deepseek-v4-flash",
					provider: "cline",
					info: {},
				},
				startedAt,
				endedAt,
				durationMs: 1000,
			},
		});
		sessionManagerMocks.getAccumulatedUsage.mockResolvedValue({
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.25,
			},
			aggregateUsage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.25,
			},
		});

		const { runAgent } = await import("./run-agent");
		const { handleEvent } = await import("../utils/events");

		await expect(
			runAgent("test prompt", {
				baseUrl: "https://cline.test/api/v1",
				cwd: process.cwd(),
				enableAgentTeams: false,
				enableSpawnAgent: false,
				enableTools: [],
				execution: {
					maxConsecutiveMistakes: 3,
				},
				logger: undefined,
				mode: "yolo",
				modelId: "deepseek/deepseek-v4-flash",
				outputMode: "json",
				providerId: "cline",
				systemPrompt: "system",
				thinking: false,
				toolPolicies: { "*": { autoApprove: true } },
				verbose: false,
				workspaceRoot: process.cwd(),
			} as never),
		).resolves.toBeUndefined();

		const runResult = outputMocks.emitJsonLine.mock.calls.find(
			([, payload]) =>
				(payload as { type?: string } | undefined)?.type === "run_result",
		)?.[1] as
			| {
					usage?: { totalCost?: number };
					aggregateUsage?: { totalCost?: number };
			  }
			| undefined;
		expect(runResult?.usage?.totalCost).toBe(0);
		expect(runResult?.aggregateUsage?.totalCost).toBe(0);

		sessionEventsMocks.listener?.({
			type: "usage",
			inputTokens: 1,
			outputTokens: 1,
			cost: 0.25,
			totalCost: 0.25,
		});

		expect(handleEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "usage",
				cost: 0,
				totalCost: 0,
			}),
			expect.any(Object),
		);
	});
});
