import {
	createSessionCompactionState,
	type ProviderSettingsManager,
	type SessionManifest,
	SessionNotFoundError,
	SessionSource,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCommandState } from "../../utils/chat-commands";
import type { Config } from "../../utils/types";

const createCliCoreMock = vi.hoisted(() => vi.fn());
const compactInteractiveMessagesMock = vi.hoisted(() => vi.fn());
const createRuntimeHooksMock = vi.hoisted(() => vi.fn());
const setActiveCliSessionMock = vi.hoisted(() => vi.fn());
const loadInteractiveResumeMessagesMock = vi.hoisted(() => vi.fn());
const subscribeToAgentEventsMock = vi.hoisted(() => vi.fn());
const subscribeToPendingPromptEventsMock = vi.hoisted(() => vi.fn());
const markAbortInProgressMock = vi.hoisted(() => vi.fn());
const submitAndExitInTerminalMock = vi.hoisted(() => vi.fn());
const createInteractiveExitSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("../../session/session", () => ({
	createCliCore: createCliCoreMock,
}));

vi.mock("../../utils/approval", () => ({
	submitAndExitInTerminal: submitAndExitInTerminalMock,
}));

vi.mock("../../utils/hooks", () => ({
	createRuntimeHooks: createRuntimeHooksMock,
}));

vi.mock("../../utils/output", () => ({
	setActiveCliSession: setActiveCliSessionMock,
}));

vi.mock("../../utils/resume", () => ({
	loadInteractiveResumeMessages: loadInteractiveResumeMessagesMock,
}));

vi.mock("../active-runtime", () => ({
	markAbortInProgress: markAbortInProgressMock,
}));

vi.mock("../session-events", () => ({
	subscribeToAgentEvents: subscribeToAgentEventsMock,
	subscribeToPendingPromptEvents: subscribeToPendingPromptEventsMock,
}));

vi.mock("./compaction", () => ({
	compactInteractiveMessages: compactInteractiveMessagesMock,
}));

vi.mock("./exit-summary", () => ({
	createInteractiveExitSummary: createInteractiveExitSummaryMock,
}));

function createConfig(): Config {
	return {
		providerId: "anthropic",
		modelId: "claude-test",
		apiKey: "",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		verbose: false,
		thinking: false,
		outputMode: "text",
		sandbox: false,
		defaultToolAutoApprove: true,
		toolPolicies: {
			"*": { autoApprove: true },
		},
	};
}

function createChatCommandState(config = createConfig()): ChatCommandState {
	return {
		enableTools: config.enableTools,
		autoApproveTools: config.defaultToolAutoApprove,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
}

function createProviderSettingsManager(): ProviderSettingsManager {
	return {
		getProviderSettings: vi.fn().mockReturnValue(undefined),
	} as unknown as ProviderSettingsManager;
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: 1,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: true,
		provider: "anthropic",
		model: "claude-test",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
	};
}

async function importRuntime() {
	return await import("./session-runtime");
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
			manifest: createManifest(sessionId),
			manifestPath: `/tmp/${sessionId}.json`,
			messagesPath: `/tmp/${sessionId}.messages.json`,
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
		readSessionCompactionState: vi.fn().mockResolvedValue(undefined),
		updateSessionCompactionState: vi.fn(),
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
		model: { id: "claude-test", provider: "anthropic" },
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

async function makeRuntime(
	manager: ReturnType<typeof makeManager>,
	options: {
		config?: Config;
		resumeSessionId?: string;
		resolveToolPolicy?: (toolName: string) => Config["toolPolicies"][string];
	} = {},
) {
	createCliCoreMock.mockResolvedValue(manager);
	const config = options.config ?? createConfig();
	const { createInteractiveSessionRuntime } = await importRuntime();
	return createInteractiveSessionRuntime({
		config,
		providerSettingsManager: createProviderSettingsManager(),
		resumeSessionId: options.resumeSessionId,
		chatCommandState: createChatCommandState(config),
		requestToolApproval: async (
			_request: ToolApprovalRequest,
		): Promise<ToolApprovalResult> => ({ approved: true }),
		resolveToolPolicy:
			options.resolveToolPolicy ?? (() => ({ autoApprove: true })),
		askQuestionRef: { current: null },
		resolveMistakeLimitDecision: undefined,
		switchToActModeTool: makeSwitchToActModeTool(),
				onAgentEvent: vi.fn(),
				onTeamEvent: vi.fn(),
				onPendingPrompts: vi.fn(),
				onPendingPromptSubmitted: vi.fn(),
				getCompactionSidecarEnabled: () => true,
			});
}

describe("createInteractiveSessionRuntime", () => {
	beforeEach(() => {
		createCliCoreMock.mockReset();
		compactInteractiveMessagesMock.mockReset();
		createRuntimeHooksMock.mockReset();
		setActiveCliSessionMock.mockReset();
		loadInteractiveResumeMessagesMock.mockReset();
		subscribeToAgentEventsMock.mockReset();
		subscribeToPendingPromptEventsMock.mockReset();
		markAbortInProgressMock.mockReset();
		submitAndExitInTerminalMock.mockReset();
		createInteractiveExitSummaryMock.mockReset();
		createRuntimeHooksMock.mockReturnValue({
			hooks: undefined,
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		loadInteractiveResumeMessagesMock.mockResolvedValue([]);
		subscribeToAgentEventsMock.mockReturnValue(() => {});
		subscribeToPendingPromptEventsMock.mockReturnValue(() => {});
	});

	it("manual compact updates the active session sidecar without restarting", async () => {
		const sessionId = "sess-active";
		const messages = [
			{ id: "u1", role: "user" as const, content: "hello" },
			{ id: "a1", role: "assistant" as const, content: "world" },
		];
		const compactionState = createSessionCompactionState({
			sourceMessages: messages,
			compactedMessages: [
				{ id: "summary", role: "user" as const, content: "summary" },
			],
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const manager = {
			start: vi.fn().mockResolvedValue({
				sessionId,
				manifest: createManifest(sessionId),
				manifestPath: "/tmp/session.json",
				messagesPath: "/tmp/session.messages.json",
			}),
			readMessages: vi.fn().mockResolvedValue(messages),
			updateSessionCompactionState: vi
				.fn()
				.mockResolvedValue({ updated: true }),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		compactInteractiveMessagesMock.mockResolvedValue({
			compacted: true,
			canonicalMessages: messages,
			compactionState,
		});
		const { createInteractiveSessionRuntime } = await importRuntime();
			const runtime = createInteractiveSessionRuntime({
				config: createConfig(),
				providerSettingsManager: createProviderSettingsManager(),
				chatCommandState: createChatCommandState(),
				requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
				askQuestionRef: { current: null },
				resolveMistakeLimitDecision: undefined,
				switchToActModeTool: {} as never,
				onAgentEvent: vi.fn(),
				onTeamEvent: vi.fn(),
				onPendingPrompts: vi.fn(),
				onPendingPromptSubmitted: vi.fn(),
				getCompactionSidecarEnabled: () => true,
			});

		await runtime.ensureReady();
		const result = await runtime.compactCurrentSession();

		expect(result).toEqual({
			messagesBefore: messages.length,
			messagesAfter: messages.length,
			workingContextMessagesAfter: compactionState.messages.length,
			compacted: true,
		});
		expect(manager.start).toHaveBeenCalledTimes(1);
		expect(manager.stop).not.toHaveBeenCalled();
		expect(manager.readMessages).toHaveBeenCalledWith(sessionId);
		expect(compactInteractiveMessagesMock).toHaveBeenCalledWith({
			config: expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-test",
			}),
			providerSettingsManager: expect.objectContaining({
				getProviderSettings: expect.any(Function),
			}),
			sessionId,
			messages,
			abortSignal: expect.any(AbortSignal),
		});
		expect(manager.updateSessionCompactionState).toHaveBeenCalledWith(
			sessionId,
			compactionState,
		);
		expect(runtime.getActiveSessionId()).toBe(sessionId);
	});

	it("manual compact runs compaction but reports not compacted when the sidecar flag is off", async () => {
		const sessionId = "sess-active-sidecar-off";
		const messages = [
			{ id: "u1", role: "user" as const, content: "hello" },
			{ id: "a1", role: "assistant" as const, content: "world" },
		];
		const compactionState = createSessionCompactionState({
			sourceMessages: messages,
			compactedMessages: [
				{ id: "summary", role: "user" as const, content: "summary" },
			],
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const manager = {
			start: vi.fn().mockResolvedValue({
				sessionId,
				manifest: createManifest(sessionId),
				manifestPath: "/tmp/session.json",
				messagesPath: "/tmp/session.messages.json",
			}),
			readMessages: vi.fn().mockResolvedValue(messages),
			updateSessionCompactionState: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		compactInteractiveMessagesMock.mockResolvedValue({
			compacted: true,
			canonicalMessages: messages,
			compactionState,
		});
		const { createInteractiveSessionRuntime } = await importRuntime();
			const runtime = createInteractiveSessionRuntime({
				config: createConfig(),
				providerSettingsManager: createProviderSettingsManager(),
				chatCommandState: createChatCommandState(),
				requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
			getCompactionSidecarEnabled: () => false,
		});

		await runtime.ensureReady();
		const result = await runtime.compactCurrentSession();

		expect(result).toEqual({
			messagesBefore: messages.length,
			messagesAfter: messages.length,
			compacted: false,
		});
		expect(compactInteractiveMessagesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				messages,
			}),
		);
		expect(manager.updateSessionCompactionState).not.toHaveBeenCalled();
		expect(runtime.getActiveSessionId()).toBe(sessionId);
	});

	it("rejects manual compact while the active session is running", async () => {
		const sessionId = "sess-running";
		const messages = [{ role: "user" as const, content: "hello" }];
		const manager = {
			start: vi.fn().mockResolvedValue({
				sessionId,
				manifest: createManifest(sessionId),
				manifestPath: "/tmp/session.json",
				messagesPath: "/tmp/session.messages.json",
			}),
			readMessages: vi.fn().mockResolvedValue(messages),
			updateSessionCompactionState: vi
				.fn()
				.mockResolvedValue({ updated: true }),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn().mockResolvedValue({
				sessionId,
				status: "running",
			}),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
				onAgentEvent: vi.fn(),
				onTeamEvent: vi.fn(),
				onPendingPrompts: vi.fn(),
				onPendingPromptSubmitted: vi.fn(),
				getCompactionSidecarEnabled: () => true,
			});

		await runtime.ensureReady();

		await expect(runtime.compactCurrentSession()).rejects.toThrow(
			"Cannot compact while the current turn is running",
		);
		expect(manager.readMessages).toHaveBeenCalledWith(sessionId);
		expect(compactInteractiveMessagesMock).not.toHaveBeenCalled();
		expect(manager.updateSessionCompactionState).not.toHaveBeenCalled();
	});

	it("rejects manual compact when compaction is disabled", async () => {
		const manager = makeManager();
		const config = createConfig();
		config.compaction = { enabled: false };
		const runtime = await makeRuntime(manager, { config });

		await runtime.ensureReady();

		await expect(runtime.compactCurrentSession()).rejects.toThrow(
			"compaction is off",
		);
		expect(compactInteractiveMessagesMock).not.toHaveBeenCalled();
		expect(manager.updateSessionCompactionState).not.toHaveBeenCalled();
	});

	it("carries compacted working context across mode-switch restarts", async () => {
		const firstSessionId = "sess-mode-before";
		const secondSessionId = "sess-mode-after";
		const prefixMessage = {
			id: "u1",
			role: "user" as const,
			content: "large original",
		};
		const tailMessage = {
			id: "u2",
			role: "user" as const,
			content: "new canonical tail",
		};
		const messages = [prefixMessage, tailMessage];
		const summaryMessage = {
			id: "summary",
			role: "user" as const,
			content: "summary",
		};
		const compactionState = createSessionCompactionState({
			sourceMessages: [prefixMessage],
			compactedMessages: [summaryMessage],
			conversationId: firstSessionId,
			systemPrompt: "compacted system",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const manager = {
			start: vi
				.fn()
				.mockResolvedValueOnce({
					sessionId: firstSessionId,
					manifest: createManifest(firstSessionId),
					manifestPath: "/tmp/session-before.json",
					messagesPath: "/tmp/session-before.messages.json",
				})
				.mockResolvedValueOnce({
					sessionId: secondSessionId,
					manifest: createManifest(secondSessionId),
					manifestPath: "/tmp/session-after.json",
					messagesPath: "/tmp/session-after.messages.json",
				}),
			readMessages: vi.fn().mockResolvedValue(messages),
			readSessionCompactionState: vi.fn().mockResolvedValue(compactionState),
			updateSessionCompactionState: vi
				.fn()
				.mockResolvedValue({ updated: true }),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
				onAgentEvent: vi.fn(),
				onTeamEvent: vi.fn(),
				onPendingPrompts: vi.fn(),
				onPendingPromptSubmitted: vi.fn(),
				getCompactionSidecarEnabled: () => true,
			});

		await runtime.ensureReady();
		await runtime.applyMode("plan");

		expect(manager.readMessages).toHaveBeenCalledWith(firstSessionId);
		expect(manager.readSessionCompactionState).toHaveBeenCalledWith(
			firstSessionId,
		);
		expect(manager.stop).toHaveBeenCalledWith(firstSessionId);
		const restartInput = manager.start.mock.calls[1]?.[0];
		expect(restartInput).toMatchObject({
			initialMessages: messages,
			initialCompactionState: expect.objectContaining({
				source_message_count: messages.length,
				messages: [summaryMessage, tailMessage],
				system_prompt: "compacted system",
			}),
		});
		expect(restartInput.initialCompactionState).not.toHaveProperty(
			"conversation_id",
		);
		expect(manager.updateSessionCompactionState).not.toHaveBeenCalled();
		expect(runtime.getActiveSessionId()).toBe(secondSessionId);
	});

	it("defers creating the replacement session after a new-session reset", async () => {
		let startCount = 0;
		const manager = {
			start: vi.fn().mockImplementation(async () => {
				startCount += 1;
				const sessionId = `session-${startCount}`;
				return {
					sessionId,
					manifest: createManifest(sessionId),
					manifestPath: `/tmp/${sessionId}.json`,
					messagesPath: `/tmp/${sessionId}.messages.json`,
				};
			}),
			readMessages: vi.fn().mockResolvedValue([]),
			readSessionCompactionState: vi.fn().mockResolvedValue(undefined),
			updateSessionCompactionState: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
		});

		await runtime.ensureReady();
		expect(manager.start).toHaveBeenCalledOnce();
		expect(runtime.getActiveSessionId()).toBe("session-1");

		await runtime.resetForNewSession();

		expect(manager.stop).toHaveBeenCalledWith("session-1");
		expect(manager.start).toHaveBeenCalledOnce();
		expect(runtime.getActiveSessionId()).toBe("");
		expect(setActiveCliSessionMock).toHaveBeenLastCalledWith(undefined);

		await runtime.ensureReady();

		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(runtime.getActiveSessionId()).toBe("session-2");
	});

	it("adds a live interactive approval policy hook to started sessions", async () => {
		const manager = makeManager();
		const upstreamBeforeTool = vi.fn(async () => ({
			input: { text: "updated" },
		}));
		createRuntimeHooksMock.mockReturnValueOnce({
			hooks: {
				beforeTool: upstreamBeforeTool,
			},
			shutdown: vi.fn(async () => {}),
		});
		const runtime = await makeRuntime(manager, {
			resolveToolPolicy: (toolName) => ({
				autoApprove: toolName === "echo",
			}),
		});

		await runtime.ensureReady();

		const startInput = manager.start.mock.calls[0]?.[0] as
			| { config?: Config }
			| undefined;
		const beforeTool = startInput?.config?.hooks?.beforeTool;
		expect(beforeTool).toBeTypeOf("function");

		const result = await beforeTool?.({
			snapshot: {
				agentId: "agent-1",
				conversationId: "conversation-1",
				status: "running",
				iteration: 1,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
			tool: {
				name: "echo",
				description: "",
				inputSchema: {},
				execute: async () => "ok",
			},
			toolCall: {
				type: "tool-call",
				toolCallId: "call-1",
				toolName: "echo",
				input: { text: "original" },
			},
			input: { text: "original" },
		});

		expect(upstreamBeforeTool).toHaveBeenCalledOnce();
		expect(result).toEqual({
			input: { text: "updated" },
			policy: { autoApprove: true },
		});
	});

	it("starts fresh after resetting an initially resumed session", async () => {
		let startCount = 0;
		const manager = {
			start: vi.fn().mockImplementation(async () => {
				startCount += 1;
				const sessionId = `session-${startCount}`;
				return {
					sessionId,
					manifest: createManifest(sessionId),
					manifestPath: `/tmp/${sessionId}.json`,
					messagesPath: `/tmp/${sessionId}.messages.json`,
				};
			}),
			readMessages: vi.fn().mockResolvedValue([]),
			readSessionCompactionState: vi.fn().mockResolvedValue(undefined),
			updateSessionCompactionState: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			resumeSessionId: "resumed-session",
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
		});

		await runtime.ensureReady();

		expect(loadInteractiveResumeMessagesMock).toHaveBeenNthCalledWith(
			1,
			manager,
			"resumed-session",
		);
		expect(manager.start).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				config: expect.objectContaining({ sessionId: "resumed-session" }),
			}),
		);

		await runtime.resetForNewSession();
		await runtime.ensureReady();

		expect(loadInteractiveResumeMessagesMock).toHaveBeenNthCalledWith(
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
		let startCount = 0;
		const manager = {
			start: vi.fn().mockImplementation(async () => {
				startCount += 1;
				const sessionId = `session-${startCount}`;
				return {
					sessionId,
					manifest: createManifest(sessionId),
					manifestPath: `/tmp/${sessionId}.json`,
					messagesPath: `/tmp/${sessionId}.messages.json`,
				};
			}),
			readMessages: vi.fn().mockResolvedValue([]),
			readSessionCompactionState: vi.fn().mockResolvedValue(undefined),
			updateSessionCompactionState: vi.fn(),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
			ingestHookEvent: vi.fn().mockResolvedValue(undefined),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
		};
		createCliCoreMock.mockResolvedValue(manager);
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			resolveToolPolicy: () => ({ autoApprove: true }),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
		});

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
		const runtime = await makeRuntime(manager);

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

	it("recovers empty read-driven restarts when the active interactive session disappeared", async () => {
		const manager = makeManager();
		manager.readMessages.mockRejectedValueOnce(
			new SessionNotFoundError("session-1"),
		);
		const runtime = await makeRuntime(manager);

		await runtime.ensureReady();
		await runtime.restartWithCurrentMessages();

		expect(manager.readMessages).toHaveBeenCalledWith("session-1");
		expect(manager.start).toHaveBeenCalledTimes(2);
		expect(manager.start).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				initialMessages: [],
			}),
		);
		expect(runtime.getActiveSessionId()).toBe("session-2");
	});

	it("does not restart with stale messages when another operation changes the active session during a read", async () => {
		const manager = makeManager();
		let runtime!: Awaited<ReturnType<typeof makeRuntime>>;
		manager.readMessages.mockImplementationOnce(async () => {
			await runtime.restartEmpty();
			return [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "stale" }],
				},
			];
		});
		runtime = await makeRuntime(manager);

		await runtime.ensureReady();
		await runtime.restartWithCurrentMessages();

		expect(manager.start).toHaveBeenCalledTimes(2);
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
		const runtime = await makeRuntime(manager);

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
