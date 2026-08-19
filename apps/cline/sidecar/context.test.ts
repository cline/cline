import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeCapabilities } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeUserFiles } from "./attachments";
import type { LiveSession, SidecarContext } from "./types";

const createCoreMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const ensureCompatibleLocalHubUrlMock = vi.hoisted(() => vi.fn());
const hubCommandMock = vi.hoisted(() => vi.fn());
const hubDisposeMock = vi.hoisted(() => vi.fn());
const hubGetConnectionErrorMock = vi.hoisted(() => vi.fn());
const hubGetUrlMock = vi.hoisted(() => vi.fn());
const hubIsConnectedMock = vi.hoisted(() => vi.fn());
const nodeHubClientCtorMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const readHubDiscoveryMock = vi.hoisted(() => vi.fn());
const resolveHubOwnerContextMock = vi.hoisted(() => vi.fn());
const stopLocalHubServerGracefullyMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineCore: {
			create: createCoreMock,
		},
		ensureCompatibleLocalHubUrl: ensureCompatibleLocalHubUrlMock,
		readHubDiscovery: readHubDiscoveryMock,
		resolveHubOwnerContext: resolveHubOwnerContextMock,
		stopLocalHubServerGracefully: stopLocalHubServerGracefullyMock,
		NodeHubClient: class {
			constructor(options: unknown) {
				nodeHubClientCtorMock(options);
			}
			connect = connectMock;
			command = hubCommandMock;
			getConnectionError = hubGetConnectionErrorMock;
			getUrl = hubGetUrlMock;
			isConnected = hubIsConnectedMock;
			subscribe = subscribeMock;
			dispose = hubDisposeMock;
		},
	};
});

function readEvents(ctx: SidecarContext): Array<{
	event: { name: string; payload: Record<string, unknown> };
}> {
	const [client] = ctx.wsClients;
	const send = client?.send;
	if (!send || typeof send !== "function" || !("mock" in send)) {
		return [];
	}
	return (send as ReturnType<typeof vi.fn>).mock.calls.map(([raw]) =>
		JSON.parse(String(raw)),
	);
}

describe("Code sidecar runtime capabilities", () => {
	beforeEach(() => {
		createCoreMock.mockReset();
		connectMock.mockReset();
		ensureCompatibleLocalHubUrlMock.mockReset();
		hubCommandMock.mockReset();
		hubDisposeMock.mockReset();
		hubGetConnectionErrorMock.mockReset();
		hubGetUrlMock.mockReset();
		hubIsConnectedMock.mockReset();
		nodeHubClientCtorMock.mockReset();
		subscribeMock.mockReset();
		readHubDiscoveryMock.mockReset();
		resolveHubOwnerContextMock.mockReset();
		stopLocalHubServerGracefullyMock.mockReset();
		stopLocalHubServerGracefullyMock.mockResolvedValue(true);
		connectMock.mockResolvedValue(undefined);
		hubDisposeMock.mockResolvedValue(undefined);
		ensureCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);
		resolveHubOwnerContextMock.mockReturnValue({
			ownerId: "hub-test-owner",
			discoveryPath: "/workspace/.locks/hub/owners/hub-test-owner.json",
		});
		readHubDiscoveryMock.mockResolvedValue({
			authToken: "test-hub-auth-token",
		});
		hubCommandMock.mockResolvedValue({ ok: true, payload: {} });
		hubGetConnectionErrorMock.mockReturnValue(null);
		hubGetUrlMock.mockReturnValue("ws://127.0.0.1:25463/hub");
		hubIsConnectedMock.mockReturnValue(true);
		subscribeMock.mockReturnValue(() => {});
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn(() => () => {}),
			dispose: vi.fn(),
		});
	});

	it("registers Code App capability factory with core", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);

		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					toolExecutors: expect.objectContaining({
						askQuestion: expect.any(Function),
					}),
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					strategy: "require-hub",
					workspaceRoot: "/workspace/project",
					cwd: "/workspace/project",
					clientType: "cline-sidecar",
					displayName: "Code App sidecar",
				}),
			}),
		);
		const hubOptions = createCoreMock.mock.calls[0][0].hub;
		expect(hubOptions.endpoint).toBe("ws://127.0.0.1:25463/hub");
		expect(hubOptions.authToken).toBe("test-hub-auth-token");
		expect(nodeHubClientCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				clientType: "cline-sidecar-observer",
				displayName: "Code App observer",
			}),
		);
	});

	it("retries ClineCore.create after a transient failure spinning up a brand-new Hub daemon", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		createCoreMock
			.mockRejectedValueOnce(new Error("Connection ended"))
			.mockResolvedValueOnce({
				runtimeAddress: "ws://127.0.0.1:25463/hub",
				subscribe: vi.fn(() => () => {}),
				dispose: vi.fn(),
			});

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledTimes(2);
		expect(ctx.sessionManager).toBeTruthy();
	});

	it("gives up after exhausting ClineCore.create retries and surfaces the last error", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		createCoreMock.mockRejectedValue(new Error("Connection ended"));

		await expect(initializeSessionManager(ctx)).rejects.toThrow(
			"Connection ended",
		);
		expect(createCoreMock).toHaveBeenCalledTimes(3);
		expect(ctx.sessionManager).toBeNull();
	});

	it("wires the desktop logger and telemetry through the shared Hub client", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const telemetry = { capture: vi.fn() };
		const ctx = createSidecarContext("/workspace/project", {
			logger,
			telemetry: telemetry as never,
		});

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				clientName: "cline-code",
				logger,
				telemetry,
			}),
		);
	});

	it("reports the connected shared Hub endpoint in process context", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project");

		await initializeSessionManager(ctx);
		const session = {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: true,
			startedAt: Date.now(),
			status: "running",
		} satisfies LiveSession;
		ctx.liveSessions.set("running-session", session);
		ctx.liveSessions.set("idle-session", {
			...session,
			busy: false,
			status: "idle",
		});

		await expect(handleCommand(ctx, "get_process_context")).resolves.toEqual(
			expect.objectContaining({
				runningSessionCount: 1,
				hub: {
					status: "connected",
					url: "ws://127.0.0.1:25463/hub",
					error: null,
				},
			}),
		);
	});

	it("starts or reuses the shared Hub when a command needs a client", async () => {
		const { createSidecarContext, ensureSharedHubClient } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		const hubClient = await ensureSharedHubClient(ctx);
		expect(hubClient).toBe(ctx.hubClient);

		expect(ensureCompatibleLocalHubUrlMock).toHaveBeenCalledWith({
			strategy: "require-hub",
			workspaceRoot: "/workspace/project",
			cwd: "/workspace/project",
		});
		expect(nodeHubClientCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				clientType: "cline-sidecar-observer",
			}),
		);
		expect(connectMock).toHaveBeenCalledOnce();
	});

	it("passes the Hub's own required auth token when connecting the shared Hub client", async () => {
		const { createSidecarContext, ensureSharedHubClient } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		readHubDiscoveryMock.mockResolvedValue({
			authToken: "the-real-hub-secret",
		});

		await ensureSharedHubClient(ctx);

		expect(resolveHubOwnerContextMock).toHaveBeenCalled();
		expect(readHubDiscoveryMock).toHaveBeenCalledWith(
			"/workspace/.locks/hub/owners/hub-test-owner.json",
		);
		expect(nodeHubClientCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({ authToken: "the-real-hub-secret" }),
		);
	});

	it("retries the shared Hub connection after a transient failure instead of failing sidecar startup", async () => {
		const { createSidecarContext, ensureSharedHubClient } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		connectMock
			.mockRejectedValueOnce(new Error("Connection ended"))
			.mockResolvedValueOnce(undefined);

		const hubClient = await ensureSharedHubClient(ctx);

		expect(hubClient).toBe(ctx.hubClient);
		expect(connectMock).toHaveBeenCalledTimes(2);
	});

	it("gives up after exhausting retries and surfaces the last connection error", async () => {
		const { createSidecarContext, ensureSharedHubClient } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		connectMock.mockRejectedValue(new Error("Connection ended"));

		await expect(ensureSharedHubClient(ctx)).rejects.toThrow(
			"Connection ended",
		);
		expect(connectMock).toHaveBeenCalledTimes(3);
		expect(ctx.hubClient).toBeNull();
	});

	it("serializes queued image data when a queued prompt starts", async () => {
		const { serializeQueuedPromptStart } = await import("./context");

		expect(
			JSON.parse(
				serializeQueuedPromptStart({
					promptId: "queued-prompt-1",
					prompt: "Describe this",
					attachmentCount: 1,
					userImages: ["data:image/png;base64,AQID"],
				}),
			),
		).toEqual({
			promptId: "queued-prompt-1",
			prompt: "Describe this",
			attachmentCount: 1,
			userImages: ["data:image/png;base64,AQID"],
		});
	});

	it("announces a queued prompt start once when drain emits both queue events", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		let onEvent: ((event: unknown) => void) | undefined;
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn((handler: (event: unknown) => void) => {
				onEvent = handler;
				return () => {};
			}),
			dispose: vi.fn(),
		});

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		await initializeSessionManager(ctx);
		const session = {
			config: {},
			messages: [],
			promptsInQueue: [
				{
					id: "prompt-1",
					prompt: "hi there",
					steer: false,
					attachmentCount: 0,
				},
			],
			busy: false,
			startedAt: Date.now(),
			status: "running",
		} satisfies LiveSession;
		ctx.liveSessions.set("session-1", session);

		// PendingPromptService.drain() emits both events for the same prompt:
		// a queue snapshot with the head removed, then the submitted event.
		onEvent?.({
			type: "pending_prompts",
			payload: { sessionId: "session-1", prompts: [] },
		});
		onEvent?.({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-1",
				id: "prompt-1",
				prompt: "hi there",
				attachmentCount: 0,
			},
		});

		const starts = readEvents(ctx).filter(
			(message) =>
				message.event.name === "chat_event" &&
				(message.event.payload as { stream?: string }).stream ===
					"chat_queued_prompt_start",
		);
		expect(starts).toHaveLength(1);

		// A different prompt id must still be announced.
		onEvent?.({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-1",
				id: "prompt-2",
				prompt: "second",
				attachmentCount: 0,
			},
		});
		expect(
			readEvents(ctx).filter(
				(message) =>
					message.event.name === "chat_event" &&
					(message.event.payload as { stream?: string }).stream ===
						"chat_queued_prompt_start",
			),
		).toHaveLength(2);
	});

	it("preserves the caller turn id on terminal chat events", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		let onEvent: ((event: unknown) => void) | undefined;
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn((handler: (event: unknown) => void) => {
				onEvent = handler;
				return () => {};
			}),
			dispose: vi.fn(),
		});
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		await initializeSessionManager(ctx);

		onEvent?.({
			type: "agent_event",
			payload: {
				sessionId: "session-relay",
				clientTurnId: "turn-relay",
				event: {
					type: "done",
					reason: "completed",
					text: "reply",
					iterations: 1,
				},
			},
		});

		const done = readEvents(ctx).find(
			(message) =>
				message.event.name === "chat_event" &&
				(message.event.payload as { stream?: string }).stream === "chat_done",
		);
		expect(done?.event.payload).toMatchObject({
			sessionId: "session-relay",
			clientTurnId: "turn-relay",
		});
	});

	it("relays generated media for attach-only Hub sessions", async () => {
		const { createSidecarContext, handleHubLiveEvent } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		ctx.liveSessions.set("session-image", {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: true,
			startedAt: Date.now(),
			status: "running",
			attachedViaHub: true,
		});

		handleHubLiveEvent(ctx, {
			event: "assistant.media",
			sessionId: "session-image",
			payload: {
				media: {
					id: "generated-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
			},
		});

		expect(readEvents(ctx)).toEqual([
			expect.objectContaining({
				event: {
					name: "chat_event",
					payload: expect.objectContaining({
						sessionId: "session-image",
						stream: "chat_media",
						chunk: JSON.stringify({
							id: "generated-1",
							modality: "image",
							mediaType: "image/png",
							source: { type: "base64", data: "aGVsbG8=" },
						}),
					}),
				},
			}),
		]);
	});

	it("ignores raw assistant media for locally-owned sessions", async () => {
		const { createSidecarContext, handleHubLiveEvent } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		ctx.liveSessions.set("session-image", {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: true,
			startedAt: Date.now(),
			status: "running",
			attachedViaHub: false,
		});

		handleHubLiveEvent(ctx, {
			event: "assistant.media",
			sessionId: "session-image",
			payload: {
				media: {
					id: "generated-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
			},
		});

		expect(readEvents(ctx)).toEqual([]);
	});

	it("resolves askQuestion through the websocket request/response protocol", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });

		await initializeSessionManager(ctx);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const answer = capabilities.toolExecutors?.askQuestion?.(
			"Which branch?",
			["Keep current", "Create new"],
			{
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 3,
			},
		);

		expect(answer).toBeInstanceOf(Promise);
		const event = readEvents(ctx).find(
			(item) => item.event.name === "ask_question_requested",
		);
		expect(event?.event.payload).toMatchObject({
			question: "Which branch?",
			options: ["Keep current", "Create new"],
			context: {
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 3,
			},
		});
		const requestId = String(event?.event.payload.requestId ?? "");
		expect(requestId.length).toBeGreaterThan(0);

		await handleCommand(ctx, "respond_ask_question", {
			requestId,
			answer: "Create new",
		});

		await expect(answer).resolves.toBe("Create new");
		expect(ctx.pendingQuestions.size).toBe(0);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "ask_question_answered",
					payload: { requestId },
				}),
			}),
		);
	});

	it("resolves message_bot through the websocket request/response protocol", async () => {
		const { createSidecarContext, requestSidecarMessageBot } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });

		const result = requestSidecarMessageBot(
			ctx,
			{
				botName: "Recipe Bot",
				message: "What's for dinner?",
				mode: "await_reply",
			},
			{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
		);

		const event = readEvents(ctx).find(
			(item) => item.event.name === "message_bot_requested",
		);
		expect(event?.event.payload).toMatchObject({
			botName: "Recipe Bot",
			message: "What's for dinner?",
			mode: "await_reply",
		});
		const requestId = String(event?.event.payload.requestId ?? "");
		expect(requestId.length).toBeGreaterThan(0);

		await handleCommand(ctx, "respond_message_bot", {
			requestId,
			result: {
				delivered: true,
				botId: "recipe-bot",
				botName: "Recipe Bot",
				sessionId: "session-123",
				reply: "Tacos.",
			},
		});

		await expect(result).resolves.toEqual({
			delivered: true,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "session-123",
			reply: "Tacos.",
		});
		expect(ctx.pendingMessageBots.size).toBe(0);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "message_bot_answered",
					payload: { requestId },
				}),
			}),
		);
	});

	it("rejects a successful await_reply result that contains no reply text", async () => {
		const { createSidecarContext, requestSidecarMessageBot } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		const result = requestSidecarMessageBot(
			ctx,
			{
				botName: "Recipe Bot",
				message: "What's your name?",
				mode: "await_reply",
			},
			{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
		);
		const event = readEvents(ctx).find(
			(item) => item.event.name === "message_bot_requested",
		);
		const requestId = String(event?.event.payload.requestId ?? "");

		await handleCommand(ctx, "respond_message_bot", {
			requestId,
			result: {
				delivered: true,
				botId: "recipe-bot",
				botName: "Recipe Bot",
				sessionId: "session-empty",
				reply: "",
			},
		});

		await expect(result).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "session-empty",
			error: '"Recipe Bot" completed without returning reply text',
		});
		expect(ctx.pendingMessageBots.size).toBe(0);
	});

	it("grants one message_bot relay claim and only accepts its response", async () => {
		const { createSidecarContext, requestSidecarMessageBot } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project");
		const firstConnection = { send: vi.fn() };
		const secondConnection = { send: vi.fn() };
		ctx.wsClients.add(firstConnection);
		const result = requestSidecarMessageBot(
			ctx,
			{
				botName: "Recipe Bot",
				message: "Hello",
				mode: "await_reply",
			},
			{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
		);
		const request = readEvents(ctx).find(
			(item) => item.event.name === "message_bot_requested",
		);
		const requestId = String(request?.event.payload.requestId ?? "");

		await expect(
			handleCommand(
				ctx,
				"claim_message_bot",
				{ requestId },
				{ connection: firstConnection },
			),
		).resolves.toBe(true);
		await expect(
			handleCommand(
				ctx,
				"claim_message_bot",
				{ requestId },
				{ connection: secondConnection },
			),
		).resolves.toBe(false);
		await expect(
			handleCommand(
				ctx,
				"respond_message_bot",
				{ requestId, result: { delivered: false, error: "wrong owner" } },
				{ connection: secondConnection },
			),
		).rejects.toThrow("claimed by another connection");

		await handleCommand(
			ctx,
			"respond_message_bot",
			{
				requestId,
				result: { delivered: true, reply: "Hi", botName: "Recipe Bot" },
			},
			{ connection: firstConnection },
		);
		await expect(result).resolves.toMatchObject({
			delivered: true,
			reply: "Hi",
		});
	});

	it("resolves message_bot with a clear error when botName is blank", async () => {
		const { createSidecarContext, requestSidecarMessageBot } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		await expect(
			requestSidecarMessageBot(
				ctx,
				{ botName: "  ", message: "hi", mode: "fire_and_forget" },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			),
		).resolves.toEqual({ delivered: false, error: "botName is required" });
		expect(ctx.pendingMessageBots.size).toBe(0);
	});

	it("resolves approval through websocket state", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					strategy: "require-hub",
					clientType: "cline-sidecar",
					displayName: "Code App sidecar",
				}),
			}),
		);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const approval = capabilities.requestToolApproval?.({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "tool-call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		expect(approval).toBeInstanceOf(Promise);
		const pending = await handleCommand(ctx, "poll_tool_approvals", {
			sessionId: "sess-1",
		});
		expect(pending).toEqual([
			expect.objectContaining({
				sessionId: "sess-1",
				toolCallId: "tool-call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				agentId: "agent-1",
				conversationId: "conversation-1",
			}),
		]);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "tool_approval_state",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						items: expect.arrayContaining([
							expect.objectContaining({ toolCallId: "tool-call-1" }),
						]),
					}),
				}),
			}),
		);

		const [{ requestId }] = pending as Array<{ requestId: string }>;
		await handleCommand(ctx, "respond_tool_approval", {
			sessionId: "sess-1",
			requestId,
			approved: true,
		});

		await expect(approval).resolves.toEqual({ approved: true });
		expect(
			await handleCommand(ctx, "poll_tool_approvals", { sessionId: "sess-1" }),
		).toEqual([]);
	});

	it("routes routine commands through the connected shared Hub client", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		hubCommandMock.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "schedule-1", enabled: false } },
		});

		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);

		await expect(
			handleCommand(ctx, "pause_routine_schedule", {
				schedule_id: "schedule-1",
			}),
		).resolves.toEqual({
			schedule: { scheduleId: "schedule-1", enabled: false },
		});
		expect(hubCommandMock).toHaveBeenCalledWith("schedule.disable", {
			scheduleId: "schedule-1",
		});
	});
});

describe("disposeSidecarContext attachment cleanup", () => {
	let previousSessionDataDir: string | undefined;
	let testSessionDataDir: string;

	beforeEach(() => {
		previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-dispose-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
		stopLocalHubServerGracefullyMock.mockReset();
		stopLocalHubServerGracefullyMock.mockResolvedValue(true);
	});

	afterEach(() => {
		if (previousSessionDataDir === undefined) {
			delete process.env.CLINE_SESSION_DATA_DIR;
		} else {
			process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
		}
		rmSync(testSessionDataDir, { recursive: true, force: true });
	});

	it("deletes tracked attachments for all live sessions on shutdown", async () => {
		const { createSidecarContext, disposeSidecarContext } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		const sessionId = "dispose-session";
		const [queuedFile] = materializeUserFiles(sessionId, [
			{ name: "queued.txt", content: "q" },
		]) as string[];
		const session: LiveSession = {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: false,
			startedAt: Date.now(),
			status: "idle",
			queuedAttachmentFiles: new Map([["pending_1", [queuedFile]]]),
		};
		ctx.liveSessions.set(sessionId, session);

		await disposeSidecarContext(ctx, "test_shutdown");

		expect(existsSync(queuedFile)).toBe(false);
		expect(ctx.liveSessions.size).toBe(0);
	});

	it("stops this sidecar's own Hub daemon on shutdown when a session manager was established", async () => {
		const { createSidecarContext, disposeSidecarContext } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.sessionManager = {
			dispose: vi.fn().mockResolvedValue(undefined),
		} as unknown as SidecarContext["sessionManager"];

		await disposeSidecarContext(ctx, "test_shutdown");

		expect(stopLocalHubServerGracefullyMock).toHaveBeenCalled();
	});

	it("does not attempt to stop a Hub daemon when no session manager was ever established", async () => {
		const { createSidecarContext, disposeSidecarContext } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");

		await disposeSidecarContext(ctx, "test_shutdown");

		expect(stopLocalHubServerGracefullyMock).not.toHaveBeenCalled();
	});

	it("still cleans up live sessions even if stopping the Hub daemon fails", async () => {
		const { createSidecarContext, disposeSidecarContext } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.sessionManager = {
			dispose: vi.fn().mockResolvedValue(undefined),
		} as unknown as SidecarContext["sessionManager"];
		stopLocalHubServerGracefullyMock.mockRejectedValue(
			new Error("shutdown request failed"),
		);

		const sessionId = "dispose-session-hub-failure";
		const session: LiveSession = {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: false,
			startedAt: Date.now(),
			status: "idle",
			queuedAttachmentFiles: new Map(),
		};
		ctx.liveSessions.set(sessionId, session);

		await disposeSidecarContext(ctx, "test_shutdown");

		expect(ctx.liveSessions.size).toBe(0);
	});
});
