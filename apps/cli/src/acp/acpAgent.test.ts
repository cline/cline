import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentSideConnection,
	PromptRequest,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import {
	ClineAccountService,
	type ClineCore,
	Llms,
	ProviderSettingsManager,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSystemPrompt } from "../runtime/prompt";
import { createCliCore } from "../session/session";
import { prepareCliEnterpriseIntegration } from "../utils/enterprise";
import { AcpAgent } from "./acpAgent";

vi.mock("../session/session", () => ({ createCliCore: vi.fn() }));
vi.mock("../runtime/prompt", () => ({ resolveSystemPrompt: vi.fn() }));
vi.mock("../utils/telemetry", () => ({
	getCliTelemetryService: () => ({ capture: vi.fn() }),
}));
vi.mock("./organizations", async () => {
	const actual =
		await vi.importActual<typeof import("./organizations")>("./organizations");
	return { ...actual, fetchClineOrganizations: vi.fn(async () => undefined) };
});

const history: MessageWithMetadata[] = [
	{ role: "user", content: "Keep this conversation" },
	{ role: "assistant", content: "I remember" },
];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function candidateManager() {
	const listeners = new Set<(event: unknown) => void>();
	const unsubscribe = vi.fn(() => listeners.clear());
	const manager = {
		start: vi.fn(async (input: Parameters<ClineCore["start"]>[0]) => ({
			sessionId: input.config?.sessionId ?? "core-session",
		})),
		send: vi.fn<ClineCore["send"]>().mockResolvedValue(undefined),
		readMessages: vi.fn<ClineCore["readMessages"]>().mockResolvedValue(history),
		abort: vi.fn<ClineCore["abort"]>().mockResolvedValue(undefined),
		dispose: vi.fn<ClineCore["dispose"]>().mockResolvedValue(undefined),
		subscribe: vi.fn((listener: (event: unknown) => void) => {
			listeners.add(listener);
			return unsubscribe;
		}),
	};
	const emitText = (text: string) => {
		for (const listener of listeners) {
			listener({
				type: "agent_event",
				payload: {
					event: { type: "content_start", contentType: "text", text },
				},
			});
		}
	};
	// The mocked factory exposes only the core methods used by AcpAgent.
	vi.mocked(createCliCore).mockResolvedValueOnce(
		manager as unknown as ClineCore,
	);
	return { manager, unsubscribe, listeners, emitText };
}

interface SessionProbe {
	abortController?: AbortController;
	pendingInitialMessages?: MessageWithMetadata[];
	sessionManager?: ClineCore;
	activeSessionId?: string;
	unsubscribe?: () => void;
}

function sessionState(agent: AcpAgent, sessionId: string): SessionProbe {
	// ACP has no public getter for prompt ownership or pending history.
	const sessions = Reflect.get(agent, "sessions") as Map<string, SessionProbe>;
	const session = sessions.get(sessionId);
	if (!session) throw new Error(`Missing test session: ${sessionId}`);
	return session;
}

function promptAbortController(session: SessionProbe): AbortController {
	if (!session.abortController)
		throw new Error("Missing prompt abort controller");
	return session.abortController;
}

function promptRequest(sessionId: string): PromptRequest {
	return { sessionId, prompt: [{ type: "text", text: "Continue" }] };
}

describe("AcpAgent session startup", () => {
	let agent: AcpAgent;
	let sessionUpdate: ReturnType<
		typeof vi.fn<AgentSideConnection["sessionUpdate"]>
	>;

	beforeEach(() => {
		vi.mocked(createCliCore).mockReset();
		vi.mocked(resolveSystemPrompt).mockReset().mockResolvedValue("Test prompt");
		vi.spyOn(Llms, "getModelsForProvider").mockResolvedValue({});
		vi.spyOn(Llms, "getProvider").mockResolvedValue(undefined);
		vi.stubEnv("CLINE_API_KEY", "test-key");
		vi.stubEnv("CLINE_PROVIDER", undefined);
		vi.stubEnv("CLINE_MODEL", undefined);
		sessionUpdate = vi
			.fn<AgentSideConnection["sessionUpdate"]>()
			.mockResolvedValue();
		agent = new AcpAgent({ sessionUpdate } as unknown as AgentSideConnection);
	});

	afterEach(async () => {
		await agent.shutdown();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function newSession() {
		return (await agent.newSession({ cwd: process.cwd(), mcpServers: [] }))
			.sessionId;
	}

	it("keeps a failed candidate local, unsubscribes, and awaits disposal before rejecting", async () => {
		const sessionId = await newSession();
		const { manager, unsubscribe, listeners, emitText } = candidateManager();
		const start = deferred<{ sessionId: string }>();
		const dispose = deferred<void>();
		manager.start.mockReturnValueOnce(start.promise);
		manager.dispose.mockReturnValueOnce(dispose.promise);
		const failure = new Error("Session start failed");
		let settled = false;
		const outcome = agent.prompt(promptRequest(sessionId)).catch((error) => {
			settled = true;
			return error;
		});
		await vi.waitFor(() => expect(manager.start).toHaveBeenCalledOnce());
		expect(listeners.size).toBe(1);
		const session = sessionState(agent, sessionId);
		expect(session.sessionManager).toBeUndefined();
		expect(session.activeSessionId).toBeUndefined();
		expect(session.unsubscribe).toBeUndefined();
		start.reject(failure);
		await vi.waitFor(() => expect(manager.dispose).toHaveBeenCalledOnce());
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(unsubscribe).toHaveBeenCalledBefore(manager.dispose);
		expect(listeners.size).toBe(0);
		expect(settled).toBe(false);
		emitText("Must not reach the client");
		expect(sessionUpdate).not.toHaveBeenCalled();
		dispose.resolve();
		expect(await outcome).toBe(failure);
		expect(manager.send).not.toHaveBeenCalled();
		expect(session.abortController).toBeUndefined();
		await agent.shutdown();
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(manager.dispose).toHaveBeenCalledOnce();
	});

	it.each([
		"prompt",
		"load",
	] as const)("settles %s startup when real enterprise cleanup fails", async (route) => {
		const cwd = await mkdtemp(join(tmpdir(), "acp-enterprise-"));
		try {
			vi.spyOn(
				ProviderSettingsManager.prototype,
				"getProviderSettings",
			).mockReturnValue({
				provider: "cline",
				auth: { accessToken: "test-token" },
			});
			const fetchConfig = vi
				.spyOn(ClineAccountService.prototype, "fetchRemoteConfig")
				.mockResolvedValue({
					enabled: true,
					organizationId: "org-test",
					value: JSON.stringify({
						version: "v1",
						globalRules: [
							{
								name: "Piratical",
								contents: "Talk like a pirate.",
								alwaysEnabled: false,
							},
						],
					}),
				});
			const config = {
				cwd,
				workspaceRoot: cwd,
				providerId: "cline",
				modelId: "test-model",
				systemPrompt: "Test startup",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			};
			const integration = await prepareCliEnterpriseIntegration({ config });
			if (!integration)
				throw new Error("Expected enabled enterprise configuration");
			await integration.dispose();
			await writeFile(
				integration.prepared.paths.workflowsPath,
				"Not a directory",
			);
			fetchConfig.mockResolvedValue(null);
			const sessionId =
				route === "prompt"
					? (await agent.newSession({ cwd, mcpServers: [] })).sessionId
					: "enterprise-load";
			const failed = candidateManager();
			failed.manager.start.mockImplementationOnce(async () => {
				await prepareCliEnterpriseIntegration({ config });
				return { sessionId };
			});
			const run = () =>
				route === "prompt"
					? agent.prompt(promptRequest(sessionId))
					: agent.loadSession({ sessionId, cwd, mcpServers: [] });
			await expect(run()).rejects.toMatchObject({ code: "ENOTDIR" });
			expect(failed.unsubscribe).toHaveBeenCalledOnce();
			expect(failed.manager.dispose).toHaveBeenCalledOnce();
			if (route === "prompt")
				expect(sessionState(agent, sessionId).abortController).toBeUndefined();
			await rm(integration.prepared.paths.workflowsPath);
			const retry = candidateManager();
			retry.manager.start.mockImplementationOnce(async () => {
				await prepareCliEnterpriseIntegration({ config });
				return { sessionId };
			});
			await run();
			expect(retry.manager.start).toHaveBeenCalledOnce();
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("disposes a candidate when subscription setup throws, even if disposal rejects", async () => {
		const sessionId = await newSession();
		const { manager, unsubscribe } = candidateManager();
		const failure = new Error("Subscription setup failed");
		manager.subscribe.mockImplementationOnce(() => {
			throw failure;
		});
		manager.dispose.mockRejectedValueOnce(new Error("Disposal failed"));
		await expect(agent.prompt(promptRequest(sessionId))).rejects.toBe(failure);
		expect(manager.start).not.toHaveBeenCalled();
		expect(manager.dispose).toHaveBeenCalledOnce();
		expect(unsubscribe).not.toHaveBeenCalled();
		expect(sessionState(agent, sessionId).abortController).toBeUndefined();
	});

	it.each([
		"config",
		"factory",
	] as const)("clears prompt ownership when %s initialization rejects", async (boundary) => {
		const sessionId = await newSession();
		const failure = new Error(`${boundary} failed`);
		if (boundary === "config") {
			vi.mocked(resolveSystemPrompt).mockRejectedValueOnce(failure);
		} else {
			vi.mocked(createCliCore).mockRejectedValueOnce(failure);
		}
		await expect(agent.prompt(promptRequest(sessionId))).rejects.toBe(failure);
		expect(sessionState(agent, sessionId).abortController).toBeUndefined();
		await agent.cancel({ sessionId });
	});

	it("retries with the conversation preserved by a public provider change", async () => {
		const sessionId = await newSession();
		const previous = candidateManager();
		await agent.prompt(promptRequest(sessionId));
		await agent.setSessionConfigOption({
			sessionId,
			configId: "provider",
			value: "cline-pass",
		});
		expect(previous.manager.readMessages).toHaveBeenCalledWith(sessionId);
		expect(previous.unsubscribe).toHaveBeenCalledOnce();
		expect(previous.manager.dispose).toHaveBeenCalledOnce();

		const failed = candidateManager();
		const failure = new Error("New provider failed to start");
		failed.manager.start.mockRejectedValueOnce(failure);
		await expect(agent.prompt(promptRequest(sessionId))).rejects.toBe(failure);
		expect(failed.manager.start.mock.calls[0]?.[0].initialMessages).toBe(
			history,
		);
		expect(sessionState(agent, sessionId).pendingInitialMessages).toBe(history);
		expect(failed.unsubscribe).toHaveBeenCalledOnce();
		expect(failed.manager.dispose).toHaveBeenCalledOnce();

		const retry = candidateManager();
		await expect(agent.prompt(promptRequest(sessionId))).resolves.toEqual({
			stopReason: "end_turn",
		});
		expect(retry.manager.start.mock.calls[0]?.[0].initialMessages).toBe(
			history,
		);
		expect(retry.manager.start.mock.calls[0]?.[0].config?.providerId).toBe(
			"cline-pass",
		);
		expect(
			sessionState(agent, sessionId).pendingInitialMessages,
		).toBeUndefined();
		expect(retry.listeners.size).toBe(1);
		await agent.prompt(promptRequest(sessionId));
		expect(retry.manager.start).toHaveBeenCalledOnce();
		expect(retry.manager.send).toHaveBeenCalledTimes(2);
		await agent.shutdown();
		expect(retry.unsubscribe).toHaveBeenCalledOnce();
		expect(retry.manager.dispose).toHaveBeenCalledOnce();
	});

	it("does not consume a replacement pending conversation while start is suspended", async () => {
		const sessionId = await newSession();
		candidateManager();
		await agent.prompt(promptRequest(sessionId));
		await agent.setSessionConfigOption({
			sessionId,
			configId: "provider",
			value: "cline-pass",
		});
		const { manager } = candidateManager();
		const start = deferred<{ sessionId: string }>();
		manager.start.mockReturnValueOnce(start.promise);
		const turn = agent.prompt(promptRequest(sessionId));
		await vi.waitFor(() => expect(manager.start).toHaveBeenCalledOnce());
		const replacement: MessageWithMetadata[] = [
			{ role: "user", content: "Newer conversation" },
		];
		const session = sessionState(agent, sessionId);
		expect(session.pendingInitialMessages).toBe(history);
		session.pendingInitialMessages = replacement;
		start.resolve({ sessionId });
		await turn;
		expect(manager.start.mock.calls[0]?.[0].initialMessages).toBe(history);
		expect(session.pendingInitialMessages).toBe(replacement);
	});

	it("cancels during startup without sending and clears its abort controller", async () => {
		const sessionId = await newSession();
		const { manager } = candidateManager();
		const start = deferred<{ sessionId: string }>();
		manager.start.mockReturnValueOnce(start.promise);
		const turn = agent.prompt(promptRequest(sessionId));
		await vi.waitFor(() => expect(manager.start).toHaveBeenCalledOnce());
		const session = sessionState(agent, sessionId);
		const controller = promptAbortController(session);
		await agent.cancel({ sessionId });
		expect(controller.signal.aborted).toBe(true);
		start.resolve({ sessionId });
		await expect(turn).resolves.toEqual({ stopReason: "cancelled" });
		expect(session.abortController).toBeUndefined();
		expect(manager.send).not.toHaveBeenCalled();
		expect(manager.abort).not.toHaveBeenCalled();
	});

	it.each([
		"complete",
		"reject",
		"cancel",
	] as const)("removes the turn's abort listener after send exits with %s", async (exit) => {
		const sessionId = await newSession();
		const { manager } = candidateManager();
		const send = deferred<Awaited<ReturnType<ClineCore["send"]>>>();
		manager.send.mockReturnValueOnce(send.promise);
		const outcome = agent
			.prompt(promptRequest(sessionId))
			.catch((error) => error);
		await vi.waitFor(() => expect(manager.send).toHaveBeenCalledOnce());
		const session = sessionState(agent, sessionId);
		const controller = promptAbortController(session);
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const failure = new Error("Send failed");
		if (exit === "cancel") await agent.cancel({ sessionId });
		if (exit === "reject") send.reject(failure);
		else if (exit === "cancel") {
			send.resolve({
				text: "",
				usage: { inputTokens: 0, outputTokens: 0 },
				messages: history,
				toolCalls: [],
				iterations: 0,
				finishReason: "aborted",
				model: { id: "test-model", provider: "test-provider" },
				startedAt: new Date(0),
				endedAt: new Date(0),
				durationMs: 0,
			});
		} else send.resolve(undefined);
		if (exit === "reject") expect(await outcome).toBe(failure);
		else
			expect(await outcome).toEqual({
				stopReason: exit === "cancel" ? "cancelled" : "end_turn",
			});
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(session.abortController).toBeUndefined();
		expect(manager.abort).toHaveBeenCalledTimes(exit === "cancel" ? 1 : 0);
		controller.abort();
		expect(manager.abort).toHaveBeenCalledTimes(exit === "cancel" ? 1 : 0);
	});

	it("does not clear the controller of a newer prompt when an older prompt finishes", async () => {
		const sessionId = await newSession();
		const { manager } = candidateManager();
		await agent.prompt(promptRequest(sessionId));
		manager.send.mockClear();
		const firstSend = deferred<Awaited<ReturnType<ClineCore["send"]>>>();
		const secondSend = deferred<Awaited<ReturnType<ClineCore["send"]>>>();
		manager.send
			.mockReturnValueOnce(firstSend.promise)
			.mockReturnValueOnce(secondSend.promise);
		const first = agent.prompt(promptRequest(sessionId));
		await vi.waitFor(() => expect(manager.send).toHaveBeenCalledTimes(1));
		const session = sessionState(agent, sessionId);
		const firstController = promptAbortController(session);
		const second = agent.prompt(promptRequest(sessionId));
		await vi.waitFor(() => expect(manager.send).toHaveBeenCalledTimes(2));
		const secondController = promptAbortController(session);
		expect(secondController).not.toBe(firstController);
		firstSend.resolve(undefined);
		await first;
		expect(session.abortController).toBe(secondController);
		firstController.abort();
		expect(manager.abort).not.toHaveBeenCalled();
		await agent.cancel({ sessionId });
		expect(secondController.signal.aborted).toBe(true);
		expect(manager.abort).toHaveBeenCalledOnce();
		secondSend.resolve(undefined);
		await second;
		expect(session.abortController).toBeUndefined();
	});

	it("cleans up failed load startup and allows a fresh load to replay history", async () => {
		const sessionId = "persisted-session";
		const failed = candidateManager();
		const failure = new Error("Resume startup failed");
		failed.manager.start.mockRejectedValueOnce(failure);
		const disposal = deferred<void>();
		failed.manager.dispose.mockReturnValueOnce(disposal.promise);
		const params = { sessionId, cwd: process.cwd(), mcpServers: [] };
		let settled = false;
		const outcome = agent.loadSession(params).catch((error) => {
			settled = true;
			return error;
		});
		await vi.waitFor(() =>
			expect(failed.manager.dispose).toHaveBeenCalledOnce(),
		);
		expect(failed.unsubscribe).toHaveBeenCalledOnce();
		expect(settled).toBe(false);
		disposal.resolve();
		expect(await outcome).toBe(failure);
		expect(failed.manager.readMessages).toHaveBeenCalledWith(sessionId);
		expect(failed.manager.start.mock.calls[0]?.[0].initialMessages).toBe(
			history,
		);
		expect(failed.unsubscribe).toHaveBeenCalledOnce();
		expect(failed.manager.dispose).toHaveBeenCalledOnce();
		expect(failed.listeners.size).toBe(0);
		expect(sessionUpdate).not.toHaveBeenCalled();
		await expect(agent.prompt(promptRequest(sessionId))).rejects.toThrow(
			"unknown session",
		);

		const retry = candidateManager();
		await agent.loadSession(params);
		expect(retry.manager.start.mock.calls[0]?.[0].initialMessages).toBe(
			history,
		);
		expect(
			sessionUpdate.mock.calls.map(([notification]) => notification),
		).toEqual([
			{
				sessionId,
				update: {
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text: "Keep this conversation" },
				},
			},
			{
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "I remember" },
				},
			},
		]);
		await agent.prompt(promptRequest(sessionId));
		expect(retry.manager.start).toHaveBeenCalledOnce();
		expect(retry.manager.send).toHaveBeenCalledWith({
			sessionId,
			prompt: "Continue",
		});
	});

	it.each([
		"missing",
		"read failure",
	] as const)("disposes a load candidate with %s history without subscribing or starting", async (reason) => {
		const sessionId = "unreadable-session";
		const { manager, unsubscribe } = candidateManager();
		if (reason === "missing") manager.readMessages.mockResolvedValueOnce([]);
		else manager.readMessages.mockRejectedValueOnce(new Error("Read failed"));
		await expect(
			agent.loadSession({ sessionId, cwd: process.cwd(), mcpServers: [] }),
		).rejects.toMatchObject({
			code: RequestError.resourceNotFound(sessionId).code,
		});
		expect(manager.dispose).toHaveBeenCalledOnce();
		expect(manager.subscribe).not.toHaveBeenCalled();
		expect(manager.start).not.toHaveBeenCalled();
		expect(unsubscribe).not.toHaveBeenCalled();
		await expect(agent.prompt(promptRequest(sessionId))).rejects.toThrow(
			"unknown session",
		);
	});
});
