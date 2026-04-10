import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const resolveSessionBackend = vi.fn();
const ensureRpcRuntimeAddress = vi.fn();
const mockGetRpcServerHealth = vi.fn();

class MockRpcCoreSessionService {}

vi.mock("@clinebot/core", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/core")>("@clinebot/core");
	return {
		...actual,
		RpcCoreSessionService: MockRpcCoreSessionService as any,
		resolveSessionBackend,
		ClineCore: {
			create: vi.fn(),
		},
	};
});

vi.mock("@clinebot/rpc", () => ({
	RPC_BUILD_VERSION: "rpc-build-test",
	getRpcServerDefaultAddress: vi.fn(() => "127.0.0.1:4317"),
	getRpcServerHealth: mockGetRpcServerHealth,
	RpcSessionClient: vi.fn().mockImplementation(function RpcSessionClient() {
		return {
			close: vi.fn(),
			streamEvents: vi.fn(() => vi.fn()),
		};
	}),
}));

vi.mock("../commands/rpc", () => ({
	ensureRpcRuntimeAddress,
}));

vi.mock("./telemetry", () => ({
	getCliTelemetryService: vi.fn(() => undefined),
}));

describe("createDefaultCliSessionManager", () => {
	let createDefaultCliSessionManager: typeof import("./session").createDefaultCliSessionManager;
	const envSnapshot = {
		CLINE_RPC_ADDRESS: process.env.CLINE_RPC_ADDRESS,
		CLINE_SESSION_BACKEND_MODE: process.env.CLINE_SESSION_BACKEND_MODE,
	};

	beforeAll(async () => {
		({ createDefaultCliSessionManager } = await import("./session"));
	});

	beforeEach(() => {
		resolveSessionBackend.mockReset();
		ensureRpcRuntimeAddress.mockReset();
		mockGetRpcServerHealth.mockReset();
		resolveSessionBackend.mockResolvedValue(new MockRpcCoreSessionService());
		delete process.env.CLINE_RPC_ADDRESS;
		delete process.env.CLINE_SESSION_BACKEND_MODE;
	});

	afterEach(() => {
		process.env.CLINE_RPC_ADDRESS = envSnapshot.CLINE_RPC_ADDRESS;
		process.env.CLINE_SESSION_BACKEND_MODE =
			envSnapshot.CLINE_SESSION_BACKEND_MODE;
	});

	it("treats an explicit rpc address as a shared server to attach to", async () => {
		process.env.CLINE_RPC_ADDRESS = "127.0.0.1:5001";

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "rpc",
			rpc: { address: "127.0.0.1:5001", autoStart: false },
		});
	});

	it("connects to the default rpc address in auto mode when a server is already running", async () => {
		mockGetRpcServerHealth.mockResolvedValue({
			running: true,
			serverId: "auto-discovered-server",
		});

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(mockGetRpcServerHealth).toHaveBeenCalledWith("127.0.0.1:4317");
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "rpc",
			rpc: { address: "127.0.0.1:4317", autoStart: false },
		});
	});

	it("falls back to the local backend in auto mode when no rpc server is running", async () => {
		mockGetRpcServerHealth.mockResolvedValue(undefined);

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(mockGetRpcServerHealth).toHaveBeenCalledWith("127.0.0.1:4317");
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("falls back to the local backend in auto mode when the rpc health probe throws", async () => {
		mockGetRpcServerHealth.mockRejectedValue(new Error("connection refused"));

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});

	it("uses the local backend by default when no explicit rpc address is configured and no server is running", async () => {
		mockGetRpcServerHealth.mockResolvedValue(undefined);

		await createDefaultCliSessionManager();

		expect(ensureRpcRuntimeAddress).not.toHaveBeenCalled();
		expect(resolveSessionBackend).toHaveBeenCalledWith({
			backendMode: "local",
			rpc: { autoStart: false },
		});
	});
});
