import {
	createSessionCompactionState,
	type ProviderSettingsManager,
	type SessionManifest,
	SessionSource,
} from "@cline/core";
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

function createChatCommandState(): ChatCommandState {
	return {
		enableTools: true,
		autoApproveTools: true,
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
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
			messages,
			compactionState,
		});
		const { createInteractiveSessionRuntime } = await importRuntime();
		const runtime = createInteractiveSessionRuntime({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
			chatCommandState: createChatCommandState(),
			requestToolApproval: vi.fn(),
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
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

	it("rejects manual compact while the active session is running", async () => {
		const sessionId = "sess-running";
		const manager = {
			start: vi.fn().mockResolvedValue({
				sessionId,
				manifest: createManifest(sessionId),
				manifestPath: "/tmp/session.json",
				messagesPath: "/tmp/session.messages.json",
			}),
			readMessages: vi.fn(),
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
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
		});

		await runtime.ensureReady();

		await expect(runtime.compactCurrentSession()).rejects.toThrow(
			"Cannot compact while the current turn is running",
		);
		expect(manager.readMessages).not.toHaveBeenCalled();
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
			askQuestionRef: { current: null },
			resolveMistakeLimitDecision: undefined,
			switchToActModeTool: {} as never,
			onAgentEvent: vi.fn(),
			onTeamEvent: vi.fn(),
			onPendingPrompts: vi.fn(),
			onPendingPromptSubmitted: vi.fn(),
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
		});
		expect(restartInput).not.toHaveProperty("initialCompactionState");
		expect(manager.updateSessionCompactionState).toHaveBeenCalledWith(
			secondSessionId,
			expect.objectContaining({
				conversation_id: secondSessionId,
				source_message_count: messages.length,
				messages: [summaryMessage, tailMessage],
				system_prompt: "compacted system",
			}),
		);
		expect(runtime.getActiveSessionId()).toBe(secondSessionId);
	});
});
