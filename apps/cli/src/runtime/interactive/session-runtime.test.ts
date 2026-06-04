import type {
	AgentEvent,
	ProviderSettingsManager,
	TeamEvent,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/core";
import { SessionNotFoundError } from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";

const {
	mockCreateCliCore,
	mockCreateRuntimeHooks,
	mockLoadInteractiveResumeMessages,
	mockSetActiveCliSession,
} = vi.hoisted(() => ({
	mockCreateCliCore: vi.fn(),
	mockCreateRuntimeHooks: vi.fn(),
	mockLoadInteractiveResumeMessages: vi.fn(),
	mockSetActiveCliSession: vi.fn(),
}));

vi.mock("../../session/session", () => ({
	createCliCore: mockCreateCliCore,
}));

vi.mock("../../utils/hooks", () => ({
	createRuntimeHooks: mockCreateRuntimeHooks,
}));

vi.mock("../../utils/output", () => ({
	setActiveCliSession: mockSetActiveCliSession,
}));

vi.mock("../../utils/resume", () => ({
	loadInteractiveResumeMessages: mockLoadInteractiveResumeMessages,
}));

vi.mock("../../utils/approval", () => ({
	submitAndExitInTerminal: vi.fn(),
}));

vi.mock("../active-runtime", () => ({
	markAbortInProgress: vi.fn(),
}));

vi.mock("../session-events", () => ({
	subscribeToAgentEvents: vi.fn(() => vi.fn()),
	subscribeToPendingPromptEvents: vi.fn(() => vi.fn()),
}));

import { createInteractiveSessionRuntime } from "./session-runtime";

function makeConfig(): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		cwd: "/tmp/work",
		workspaceRoot: "/tmp/work",
	};
}

function makeChatCommandState(config: Config): ChatCommandState {
	return {
		enableTools: config.enableTools,
		autoApproveTools: config.defaultToolAutoApprove,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
}

function makeSwitchToActModeTool(): AgentTool {
	return {
		name: "switch_to_act_mode",
		description: "Switch to act mode",
		inputSchema: { type: "object", properties: {} },
		execute: () => ({ ok: true }),
	};
}

function makeManager() {
	let startCount = 0;
	const start = vi.fn(async (_input?: unknown) => {
		startCount += 1;
		const sessionId = `session-${startCount}`;
		return {
			sessionId,
			manifest: {
				session_id: sessionId,
			},
		};
	});
	return {
		start,
		stop: vi.fn(async () => {}),
		send: vi.fn(),
		getAccumulatedUsage: vi.fn(),
		abort: vi.fn(),
		dispose: vi.fn(),
		get: vi.fn(),
		readMessages: vi.fn(async (): Promise<Message[]> => []),
		readTranscript: vi.fn(),
		ingestHookEvent: vi.fn(),
		subscribe: vi.fn(),
		updateSessionModel: vi.fn(),
		pendingPrompts: {
			update: vi.fn(),
		},
		restore: vi.fn(),
	};
}

function makeTurnResult() {
	return {
		text: "ok",
		usage: { inputTokens: 0, outputTokens: 0 },
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed" as const,
		model: { id: "openai/gpt-5.3-codex", provider: "cline" },
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:00.100Z"),
		durationMs: 100,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function makeRuntime(
	manager: ReturnType<typeof makeManager>,
	options: { resumeSessionId?: string } = {},
) {
	mockCreateCliCore.mockResolvedValue(manager);
	const config = makeConfig();
	return createInteractiveSessionRuntime({
		config,
		providerSettingsManager: {} as ProviderSettingsManager,
		resumeSessionId: options.resumeSessionId,
		chatCommandState: makeChatCommandState(config),
		requestToolApproval: async (
			_request: ToolApprovalRequest,
		): Promise<ToolApprovalResult> => ({ approved: true }),
		askQuestionRef: { current: null },
		resolveMistakeLimitDecision: undefined,
		switchToActModeTool: makeSwitchToActModeTool(),
		onAgentEvent: (_event: AgentEvent) => {},
		onTeamEvent: (_event: TeamEvent) => {},
		onPendingPrompts: () => {},
		onPendingPromptSubmitted: () => {},
	});
}

describe("createInteractiveSessionRuntime", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateRuntimeHooks.mockReturnValue({
			hooks: undefined,
			shutdown: vi.fn(async () => {}),
		});
		mockLoadInteractiveResumeMessages.mockResolvedValue([]);
	});

	it("defers creating the replacement session after a new-session reset", async () => {
		const manager = makeManager();
		const runtime = makeRuntime(manager);

		await runtime.ensureReady();
		expect(manager.start).toHaveBeenCalledOnce();
		expect(runtime.getActiveSessionId()).toBe("session-1");

		await runtime.resetForNewSession();

		expect(manager.stop).toHaveBeenCalledWith("session-1");
		expect(manager.start).toHaveBeenCalledOnce();
		expect(runtime.getActiveSessionId()).toBe("");
		expect(mockSetActiveCliSession).toHaveBeenLastCalledWith(undefined);

		await runtime.ensureReady();

		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(runtime.getActiveSessionId()).toBe("session-2");
	});

	it("starts fresh after resetting an initially resumed session", async () => {
		const manager = makeManager();
		const runtime = makeRuntime(manager, {
			resumeSessionId: "resumed-session",
		});

		await runtime.ensureReady();

		expect(mockLoadInteractiveResumeMessages).toHaveBeenNthCalledWith(
			1,
			manager,
			"resumed-session",
		);
		expect(manager.start).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				config: expect.objectContaining({
					sessionId: "resumed-session",
				}),
			}),
		);

		await runtime.resetForNewSession();
		await runtime.ensureReady();

		expect(mockLoadInteractiveResumeMessages).toHaveBeenNthCalledWith(
			2,
			manager,
			undefined,
		);
		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(manager.start).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				config: expect.not.objectContaining({
					sessionId: "resumed-session",
				}),
			}),
		);
	});

	it("keeps explicit empty restarts eager for config-driven restarts", async () => {
		const manager = makeManager();
		const runtime = makeRuntime(manager);

		await runtime.ensureReady();
		await runtime.restartEmpty();

		expect(manager.stop).toHaveBeenCalledWith("session-1");
		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(runtime.getActiveSessionId()).toBe("session-2");
	});

	it("recovers and retries when the active interactive session disappeared", async () => {
		const manager = makeManager();
		const messages = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "hi" }],
			},
		];
		manager.readMessages.mockResolvedValue(messages);
		manager.send
			.mockRejectedValueOnce(new SessionNotFoundError("session-1"))
			.mockResolvedValueOnce(makeTurnResult());
		const runtime = makeRuntime(manager);

		await runtime.ensureReady();
		const result = await runtime.sendCurrentTurn({
			prompt: "second hi",
			mode: "act",
		});

		expect(result?.finishReason).toBe("completed");
		expect(manager.readMessages).toHaveBeenCalledWith("session-1");
		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(manager.start).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				initialMessages: messages,
			}),
		);
		expect(manager.send).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ sessionId: "session-1" }),
		);
		expect(manager.send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ sessionId: "session-2" }),
		);
		expect(runtime.getActiveSessionId()).toBe("session-2");
	});

	it("waits for missing-session recovery before cleanup disposes the manager", async () => {
		const manager = makeManager();
		const recoveryRead = deferred<Message[]>();
		manager.readMessages
			.mockImplementationOnce(() => recoveryRead.promise)
			.mockResolvedValue([]);
		manager.get.mockResolvedValue(undefined);
		manager.getAccumulatedUsage.mockResolvedValue(undefined);
		manager.send.mockRejectedValueOnce(new SessionNotFoundError("session-1"));
		const runtime = makeRuntime(manager);

		await runtime.ensureReady();
		const sendPromise = runtime
			.sendCurrentTurn({
				prompt: "second hi",
				mode: "act",
			})
			.catch((error) => error);
		await vi.waitFor(() => {
			expect(manager.readMessages).toHaveBeenCalledWith("session-1");
		});

		let cleanupSettled = false;
		const cleanupPromise = runtime.cleanup().finally(() => {
			cleanupSettled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(cleanupSettled).toBe(false);
		expect(manager.get).not.toHaveBeenCalled();
		expect(manager.dispose).not.toHaveBeenCalled();

		recoveryRead.resolve([]);
		await cleanupPromise;
		const sendError = await sendPromise;

		expect(sendError).toBeInstanceOf(SessionNotFoundError);
		expect(manager.dispose).toHaveBeenCalledWith("cli_interactive_shutdown");
	});
});
