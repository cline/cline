import type { RuntimeCapabilities } from "@cline/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const runtimeInfo: SidecarContext["runtimeInfo"] = {
	app: { name: "Cline Code", version: "1.2.3" },
	sdk: { coreVersion: "4.5.6" },
	runtime: { name: "bun", version: "1.3.4", nodeVersion: "v24.0.0" },
	os: {
		platform: "darwin",
		name: "Darwin",
		version: "Darwin Kernel Version 25",
		release: "25.0.0",
		arch: "arm64",
	},
	environment: { pathSource: "shell", pathChanged: true },
};

const createCoreMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const nodeHubClientCtorMock = vi.hoisted(() => vi.fn());
const resolveHubOwnerContextMock = vi.hoisted(() => vi.fn());
const startHubWebSocketServerMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const loginOAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineCore: {
			create: createCoreMock,
		},
		createLocalHubScheduleRuntimeHandlers: vi.fn(() => ({
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		})),
		resolveHubOwnerContext: resolveHubOwnerContextMock,
		startHubWebSocketServer: startHubWebSocketServerMock,
		NodeHubClient: class {
			constructor(options: unknown) {
				nodeHubClientCtorMock(options);
			}
			connect = connectMock;
			subscribe = subscribeMock;
			dispose = vi.fn();
		},
		loginAndSaveLocalProviderOAuthCredentials: loginOAuthMock,
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
		nodeHubClientCtorMock.mockReset();
		resolveHubOwnerContextMock.mockReset();
		startHubWebSocketServerMock.mockReset();
		subscribeMock.mockReset();
		loginOAuthMock.mockReset();
		connectMock.mockResolvedValue(undefined);
		resolveHubOwnerContextMock.mockReturnValue({
			ownerId: "code-sidecar-test",
			discoveryPath: "/tmp/code-sidecar-test.json",
		});
		startHubWebSocketServerMock.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
			close: vi.fn(),
		});
		subscribeMock.mockReturnValue(() => {});
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn(() => () => {}),
			dispose: vi.fn(),
		});
	});

	it("routes OAuth authorization URLs to the requesting desktop client", async () => {
		loginOAuthMock.mockImplementation(
			async (
				_manager: unknown,
				providerId: string,
				onAuth: (input: { url: string; instructions?: string }) => void,
			) => {
				onAuth({
					url: "https://auth.example.com/authorize?code=test",
					instructions: "Enter code TEST",
				});
				return {
					provider: providerId,
					auth: { accessToken: "oauth-token" },
				};
			},
		);
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });
		const sendEvent = vi.fn();

		await expect(
			handleCommand(
				ctx,
				"run_provider_oauth_login",
				{ provider: "cline", flowId: "flow-1" },
				{ requestId: "request-1", sendEvent },
			),
		).resolves.toEqual({ provider: "cline", accessTokenPresent: true });

		expect(sendEvent).toHaveBeenCalledWith("oauth_authorization_requested", {
			flowId: "flow-1",
			providerId: "cline",
			url: "https://auth.example.com/authorize?code=test",
			instructions: "Enter code TEST",
		});
	});

	it("registers Code App capability factory with core", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);

		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });
		await initializeSessionManager(ctx);

		expect(startHubWebSocketServerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				port: 0,
				owner: {
					ownerId: "code-sidecar-test",
					discoveryPath: "/tmp/code-sidecar-test.json",
				},
			}),
		);
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
					endpoint: "ws://127.0.0.1:25463/hub",
					authToken: "test-token",
					clientType: "code-sidecar",
					displayName: "Code App sidecar",
				}),
			}),
		);
		expect(nodeHubClientCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "test-token",
				clientType: "code-sidecar-approvals",
			}),
		);
	});

	it("rejects non-web OAuth authorization URLs", async () => {
		loginOAuthMock.mockImplementation(
			async (
				_manager: unknown,
				_providerId: string,
				onAuth: (input: { url: string }) => void,
			) => {
				onAuth({ url: "file:///etc/passwd" });
			},
		);
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });
		const sendEvent = vi.fn();

		await expect(
			handleCommand(
				ctx,
				"run_provider_oauth_login",
				{ provider: "cline", flowId: "flow-1" },
				{ requestId: "request-1", sendEvent },
			),
		).rejects.toThrow("OAuth authorization URL must use http(s)");
		expect(sendEvent).not.toHaveBeenCalled();
	});

	it("wires the desktop logger and telemetry through the client and embedded hub", async () => {
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
			runtimeInfo,
			telemetry: telemetry as never,
		});

		await initializeSessionManager(ctx);

		expect(startHubWebSocketServerMock).toHaveBeenCalledWith(
			expect.objectContaining({ logger, telemetry }),
		);
		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				clientName: "cline-code",
				logger,
				telemetry,
			}),
		);
	});

	it("returns the canonical runtime snapshot with process context", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");
		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });

		await expect(handleCommand(ctx, "get_process_context")).resolves.toEqual({
			workspaceRoot: "/workspace/project",
			cwd: "/workspace/project",
			homeDir: expect.any(String),
			runtimeInfo,
		});
	});

	it("resolves askQuestion through the websocket request/response protocol", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });
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

		const ctx = createSidecarContext("/workspace/project", { runtimeInfo });
		ctx.wsClients.add({ send: vi.fn() });

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					endpoint: "ws://127.0.0.1:25463/hub",
					authToken: "test-token",
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
});
