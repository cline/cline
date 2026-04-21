import { describe, expect, it, vi } from "vitest";

const clientCloseMock = vi.hoisted(() => vi.fn());
const streamEventsMock = vi.hoisted(() => vi.fn(() => () => {}));
const startRuntimeSessionMock = vi.hoisted(() => vi.fn());
const sendRuntimeSessionMock = vi.hoisted(() => vi.fn());
const abortRuntimeSessionMock = vi.hoisted(() => vi.fn());
const stopRuntimeSessionMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/rpc", () => ({
	RpcSessionClient: class {
		close = clientCloseMock;
		streamEvents = streamEventsMock;
		startRuntimeSession = startRuntimeSessionMock;
		sendRuntimeSession = sendRuntimeSessionMock;
		abortRuntimeSession = abortRuntimeSessionMock;
		stopRuntimeSession = stopRuntimeSessionMock;
		getSession = getSessionMock;
		respondToolApproval = vi.fn();
	},
}));

describe("RpcRuntimeHost", () => {
	it("emits running status when a remote session starts", async () => {
		const { RpcRuntimeHost } = await import("./rpc");
		startRuntimeSessionMock.mockResolvedValue({
			sessionId: "session-1",
			startResult: {
				manifestPath: "/tmp/session-1.json",
				messagesPath: "/tmp/session-1.messages.json",
			},
		});
		const backend = {
			address: "127.0.0.1:4317",
			close: vi.fn(),
			readSessionManifest: vi.fn().mockReturnValue({
				session_id: "session-1",
				status: "running",
			}),
		} as unknown as import("../session/rpc-session-service").RpcCoreSessionService;

		const host = new RpcRuntimeHost(backend, undefined, undefined);
		const listener = vi.fn();
		const unsubscribe = host.subscribe(listener);

		await host.start({
			config: {
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				providerId: "mock-provider",
				modelId: "mock-model",
				mode: "act",
				systemPrompt: "system",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			interactive: true,
		});

		expect(listener).toHaveBeenCalledWith({
			type: "status",
			payload: { sessionId: "session-1", status: "running" },
		});
		unsubscribe();
	});

	it("does not close the shared backend on dispose", async () => {
		const { RpcRuntimeHost } = await import("./rpc");
		const backend = {
			address: "127.0.0.1:4317",
			close: vi.fn(),
		} as unknown as import("../session/rpc-session-service").RpcCoreSessionService;

		const host = new RpcRuntimeHost(backend, undefined, undefined);
		await host.dispose();

		expect(clientCloseMock).toHaveBeenCalledTimes(1);
		expect(backend.close).not.toHaveBeenCalled();
	});
});
