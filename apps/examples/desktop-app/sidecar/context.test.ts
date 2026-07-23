import type { RuntimeCapabilities } from "@cline/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const createCoreMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const ensureCompatibleLocalHubUrlMock = vi.hoisted(() => vi.fn());
const hubCommandMock = vi.hoisted(() => vi.fn());
const hubGetConnectionErrorMock = vi.hoisted(() => vi.fn());
const hubGetUrlMock = vi.hoisted(() => vi.fn());
const hubIsConnectedMock = vi.hoisted(() => vi.fn());
const nodeHubClientCtorMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());

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
		connectMock.mockResolvedValue(undefined);
		ensureCompatibleLocalHubUrlMock.mockResolvedValue(
			"ws://127.0.0.1:25463/hub",
		);
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
					clientType: "code-sidecar",
					displayName: "Code App sidecar",
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
				displayName: "Code App observer",
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

		await expect(handleCommand(ctx, "get_process_context")).resolves.toEqual(
			expect.objectContaining({
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
					clientType: "code-sidecar",
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
