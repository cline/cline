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
const hubGetConnectionErrorMock = vi.hoisted(() => vi.fn());
const hubGetUrlMock = vi.hoisted(() => vi.fn());
const hubIsConnectedMock = vi.hoisted(() => vi.fn());
const nodeHubClientCtorMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const updateCapabilitiesMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineCore: {
			create: createCoreMock,
		},
		ensureCompatibleLocalHubUrl: ensureCompatibleLocalHubUrlMock,
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
			updateCapabilities = updateCapabilitiesMock;
			dispose = vi.fn();
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
		hubGetConnectionErrorMock.mockReset();
		hubGetUrlMock.mockReset();
		hubIsConnectedMock.mockReset();
		nodeHubClientCtorMock.mockReset();
		subscribeMock.mockReset();
		updateCapabilitiesMock.mockReset();
		connectMock.mockResolvedValue(undefined);
		ensureCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);
		hubCommandMock.mockResolvedValue({ ok: true, payload: {} });
		hubGetConnectionErrorMock.mockReturnValue(null);
		hubGetUrlMock.mockReturnValue("ws://127.0.0.1:25463/hub");
		hubIsConnectedMock.mockReturnValue(true);
		subscribeMock.mockReturnValue(() => {});
		updateCapabilitiesMock.mockResolvedValue(undefined);
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn(() => () => {}),
			dispose: vi.fn(),
		});
	});

	it("registers the desktop capability factory with core", async () => {
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
					clientType: "code-sidecar",
					displayName: "Cline Desktop sidecar",
				}),
			}),
		);
		const hubOptions = createCoreMock.mock.calls[0][0].hub;
		expect(hubOptions).not.toHaveProperty("endpoint");
		expect(hubOptions).not.toHaveProperty("authToken");
		expect(nodeHubClientCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				clientType: "code-sidecar-observer",
				displayName: "Cline Desktop observer",
			}),
		);
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
				clientType: "code-sidecar-observer",
			}),
		);
		expect(connectMock).toHaveBeenCalledOnce();
	});

	it("forwards raw hub tool updates to attached desktop sessions", async () => {
		const { createSidecarContext, handleHubLiveEvent } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		ctx.liveSessions.set("session-1", {
			config: {},
			messages: [],
			promptsInQueue: [],
			busy: true,
			startedAt: Date.now(),
			status: "running",
			attachedViaHub: true,
		});

		handleHubLiveEvent(ctx, {
			event: "tool.updated",
			sessionId: "session-1",
			payload: {
				toolCallId: "call-1",
				toolName: "run_commands",
				update: { stream: "stdout", chunk: "live\n" },
			},
		});

		const forwarded = readEvents(ctx).find(
			(message) =>
				message.event.name === "chat_event" &&
				(message.event.payload as { stream?: string }).stream ===
					"chat_tool_call_update",
		);
		expect(forwarded?.event.payload).toMatchObject({
			sessionId: "session-1",
			stream: "chat_tool_call_update",
		});
		expect(
			JSON.parse(
				String((forwarded?.event.payload as { chunk?: string }).chunk),
			),
		).toEqual({
			toolCallId: "call-1",
			toolName: "run_commands",
			update: { stream: "stdout", chunk: "live\n" },
		});
	});

	it("forwards proceed-while-running requests to the hub", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		hubCommandMock.mockResolvedValue({
			ok: true,
			payload: { detachedCount: 1 },
		});
		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);

		await expect(
			handleCommand(ctx, "proceed_while_running", {
				sessionId: "session-1",
				toolCallId: "call-1",
			}),
		).resolves.toEqual({ detachedCount: 1 });
		expect(hubCommandMock).toHaveBeenCalledWith(
			"run.proceed_while_running",
			{ sessionId: "session-1", toolCallId: "call-1" },
			"session-1",
		);
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
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi.fn(),
		};
		ctx.wsClients.add(approvalClient);

		await initializeSessionManager(ctx);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const answer = capabilities.toolExecutors?.askQuestion?.(
			"Which branch?",
			["Keep current", "Create new"],
			{
				sessionId: "session-1",
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
			sessionId: "session-1",
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
		expect(
			await handleCommand(ctx, "poll_ask_questions", {
				sessionId: "session-1",
			}),
		).toEqual([
			expect.objectContaining({
				requestId,
				sessionId: "session-1",
				question: "Which branch?",
				options: ["Keep current", "Create new"],
			}),
		]);
		expect(
			await handleCommand(ctx, "poll_ask_questions", {
				sessionId: "another-session",
			}),
		).toEqual([]);

		await handleCommand(ctx, "respond_ask_question", {
			requestId,
			answer: "Create new",
		});

		await expect(answer).resolves.toBe("Create new");
		expect(ctx.pendingQuestions.size).toBe(0);
		expect(
			await handleCommand(ctx, "poll_ask_questions", {
				sessionId: "session-1",
			}),
		).toEqual([]);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "ask_question_answered",
					payload: { requestId },
				}),
			}),
		);
	});

	it("rejects askQuestion requests without an owning session", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });
		await initializeSessionManager(ctx);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const answer = capabilities.toolExecutors?.askQuestion?.(
			"Which branch?",
			["Keep current", "Create new"],
			{ agentId: "agent-1", iteration: 3 },
		);

		await expect(answer).rejects.toThrow(
			"ask_question requires an active session ID",
		);
		expect(
			readEvents(ctx).some(
				(message) => message.event.name === "ask_question_requested",
			),
		).toBe(false);
	});

	it("resolves approval through websocket state", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi.fn(),
		};
		ctx.wsClients.add(approvalClient);

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					strategy: "require-hub",
					clientType: "code-sidecar",
					displayName: "Cline Desktop sidecar",
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
		const pending = await handleCommand(
			ctx,
			"poll_tool_approvals",
			{ sessionId: "sess-1" },
			{ connection: approvalClient },
		);
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
		const untrustedClient = { send: vi.fn() };
		ctx.wsClients.add(untrustedClient);
		await expect(
			handleCommand(
				ctx,
				"respond_tool_approval",
				{ sessionId: "sess-1", requestId, approved: true },
				{ connection: untrustedClient },
			),
		).rejects.toThrow("trusted desktop connection");
		expect(ctx.pendingApprovals.size).toBe(1);
		await handleCommand(
			ctx,
			"respond_tool_approval",
			{ sessionId: "sess-1", requestId, approved: true },
			{ connection: approvalClient },
		);

		await expect(approval).resolves.toEqual({ approved: true });
		expect(
			await handleCommand(
				ctx,
				"poll_tool_approvals",
				{ sessionId: "sess-1" },
				{ connection: approvalClient },
			),
		).toEqual([]);
	});

	it("rejects and removes an approval when initial delivery fails", async () => {
		const { createSidecarContext, createSidecarRuntimeCapabilities } =
			await import("./context");
		const ctx = createSidecarContext("/workspace/project");
		const failedClient = {
			data: { canApproveTools: true },
			send: vi.fn(() => {
				throw new Error("socket closed");
			}),
		};
		ctx.wsClients.add(failedClient);

		const approval = createSidecarRuntimeCapabilities(
			ctx,
		).requestToolApproval?.({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "tool-call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		await expect(approval).resolves.toEqual({
			approved: false,
			reason: "Desktop approval surface disconnected",
		});
		expect(ctx.pendingApprovals.size).toBe(0);
		expect(ctx.wsClients.has(failedClient)).toBe(false);
	});

	it("rejects an owned approval when a later broadcast fails", async () => {
		const {
			broadcastEvent,
			createSidecarContext,
			createSidecarRuntimeCapabilities,
		} = await import("./context");
		const ctx = createSidecarContext("/workspace/project");
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi
				.fn()
				.mockImplementationOnce(() => undefined)
				.mockImplementationOnce(() => {
					throw new Error("socket closed");
				}),
		};
		ctx.wsClients.add(approvalClient);

		const approval = createSidecarRuntimeCapabilities(
			ctx,
		).requestToolApproval?.({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "tool-call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(ctx.pendingApprovals.size).toBe(1);

		broadcastEvent(ctx, "task.updated", { taskId: "task-1" });

		await expect(approval).resolves.toEqual({
			approved: false,
			reason: "Desktop approval surface disconnected",
		});
		expect(ctx.pendingApprovals.size).toBe(0);
		expect(ctx.wsClients.has(approvalClient)).toBe(false);
	});

	it("rejects sibling approvals when a targeted state update fails", async () => {
		const { createSidecarContext, createSidecarRuntimeCapabilities } =
			await import("./context");
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project");
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi
				.fn()
				.mockImplementationOnce(() => undefined)
				.mockImplementationOnce(() => undefined)
				.mockImplementationOnce(() => {
					throw new Error("socket closed");
				}),
		};
		ctx.wsClients.add(approvalClient);
		const capabilities = createSidecarRuntimeCapabilities(ctx);
		const request = (toolCallId: string) =>
			capabilities.requestToolApproval?.({
				sessionId: "sess-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
				toolCallId,
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				policy: { autoApprove: false },
			});
		const firstApproval = request("tool-call-1");
		const siblingApproval = request("tool-call-2");
		const [{ requestId }] = (await handleCommand(
			ctx,
			"poll_tool_approvals",
			{ sessionId: "sess-1" },
			{ connection: approvalClient },
		)) as Array<{ requestId: string }>;

		await handleCommand(
			ctx,
			"respond_tool_approval",
			{ sessionId: "sess-1", requestId, approved: true },
			{ connection: approvalClient },
		);

		await expect(firstApproval).resolves.toEqual({ approved: true });
		await expect(siblingApproval).resolves.toEqual({
			approved: false,
			reason: "Desktop approval surface disconnected",
		});
		expect(ctx.pendingApprovals.size).toBe(0);
		expect(ctx.wsClients.has(approvalClient)).toBe(false);
	});

	it("serializes approval readiness updates and publishes the latest state", async () => {
		const {
			createSidecarContext,
			initializeSessionManager,
			syncSidecarApprovalReadiness,
		} = await import("./context");
		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);
		updateCapabilitiesMock.mockReset();

		let finishDisconnectedUpdate: (() => void) | undefined;
		updateCapabilitiesMock
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishDisconnectedUpdate = resolve;
					}),
			)
			.mockResolvedValue(undefined);

		const disconnected = syncSidecarApprovalReadiness(ctx);
		await vi.waitFor(() =>
			expect(updateCapabilitiesMock).toHaveBeenCalledWith([]),
		);
		ctx.wsClients.add({
			data: { canApproveTools: true },
			send: vi.fn(),
		});
		const connected = syncSidecarApprovalReadiness(ctx);
		expect(updateCapabilitiesMock).toHaveBeenCalledTimes(1);

		finishDisconnectedUpdate?.();
		await Promise.all([disconnected, connected]);
		expect(updateCapabilitiesMock).toHaveBeenLastCalledWith([
			expect.objectContaining({ name: "approval.respond" }),
		]);
	});

	it("forwards Hub-owned task session approvals to the live desktop", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		let onHubEvent: ((event: Record<string, unknown>) => void) | undefined;
		subscribeMock.mockImplementation((handler) => {
			onHubEvent = handler;
			return () => {};
		});
		const ctx = createSidecarContext("/workspace/project");
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi.fn(),
		};
		ctx.wsClients.add(approvalClient);
		await initializeSessionManager(ctx);

		expect(updateCapabilitiesMock).toHaveBeenCalledWith([
			expect.objectContaining({ name: "approval.respond" }),
		]);
		onHubEvent?.({
			event: "approval.requested",
			sessionId: "task-session-1",
			payload: {
				approvalId: "hub-approval-1",
				agendaTaskId: "task-1",
				agentId: "task-agent-1",
				conversationId: "task-conversation-1",
				iteration: 2,
				toolCallId: "tool-call-1",
				toolName: "write_to_file",
				inputJson: JSON.stringify({ path: "src/a.ts" }),
				policy: { autoApprove: false },
			},
		});
		await vi.waitFor(() => expect(ctx.pendingApprovals.size).toBe(1));
		const pendingItems = (await handleCommand(
			ctx,
			"poll_tool_approvals",
			{ sessionId: "task-session-1" },
			{ connection: approvalClient },
		)) as Array<{ requestId: string }>;
		const pending = pendingItems[0];
		if (!pending) throw new Error("expected a pending task approval");
		await handleCommand(
			ctx,
			"respond_tool_approval",
			{
				sessionId: "task-session-1",
				requestId: pending.requestId,
				approved: true,
			},
			{ connection: approvalClient },
		);

		await vi.waitFor(() =>
			expect(hubCommandMock).toHaveBeenCalledWith(
				"approval.respond",
				{
					approvalId: "hub-approval-1",
					approved: true,
					reason: undefined,
				},
				"task-session-1",
			),
		);
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

	it("proxies Agenda task commands through the connected shared Hub", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		const task = {
			taskId: "task-1",
			title: "Review the PR",
			status: "pending_approval",
		};
		hubCommandMock.mockResolvedValue({
			ok: true,
			payload: { tasks: [task] },
		});

		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);
		const approvalClient = {
			data: { canApproveTools: true },
			send: vi.fn(),
		};

		await expect(
			handleCommand(ctx, "task.list", {
				workspaceRoot: "/workspace/project",
				statuses: ["pending_approval"],
			}),
		).resolves.toEqual({ tasks: [task] });
		expect(hubCommandMock).toHaveBeenCalledWith("task.list", {
			workspaceRoot: "/workspace/project",
			statuses: ["pending_approval"],
		});

		hubCommandMock.mockResolvedValueOnce({
			ok: true,
			payload: { task: { ...task, status: "in_progress", revision: 4 } },
		});
		await expect(
			handleCommand(
				ctx,
				"task.run",
				{
					taskId: "task-1",
					expectedRevision: 4,
				},
				{ connection: approvalClient },
			),
		).resolves.toEqual({
			task: { ...task, status: "in_progress", revision: 4 },
		});
		expect(hubCommandMock).toHaveBeenCalledWith("task.run", {
			taskId: "task-1",
			expectedRevision: 4,
		});
	});

	it.each([
		"task.create",
		"task.approve",
		"task.cancel",
		"task.run",
		"task.automation.set",
	])("rejects untrusted %s commands before they reach the shared Hub", async (command) => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);
		const untrustedClient = {
			data: { canApproveTools: false },
			send: vi.fn(),
		};

		await expect(
			handleCommand(ctx, command, {}, { connection: untrustedClient }),
		).rejects.toThrow("task execution requires a trusted desktop connection");
		expect(hubCommandMock).not.toHaveBeenCalled();
	});

	it("forwards Hub task events that do not have a session", async () => {
		const { createSidecarContext, handleHubLiveEvent } = await import(
			"./context"
		);
		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() } as never);

		handleHubLiveEvent(ctx, {
			event: "task.created",
			payload: {
				taskId: "task-1",
				status: "pending_approval",
			},
		});

		expect(readEvents(ctx)).toEqual([
			{
				type: "event",
				event: {
					name: "task.created",
					payload: {
						taskId: "task-1",
						status: "pending_approval",
					},
				},
			},
		]);
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
});
