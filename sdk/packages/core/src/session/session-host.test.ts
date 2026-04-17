import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSessionService } from "./file-session-service";

const sqliteInitMock = vi.hoisted(() => vi.fn());
const ensureRpcRuntimeAddressMock = vi.hoisted(() => vi.fn());
const resolveRpcOwnerContextMock = vi.hoisted(() =>
	vi.fn(() => ({
		ownerId: "core-owner",
		buildId: "core-build",
		discoveryPath: "/tmp/rpc-owner.json",
	})),
);
const rpcHealthByAddress = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@clinebot/rpc", () => ({
	RPC_BUILD_VERSION: "rpc-build-test",
	getRpcServerDefaultAddress: () => "ws://127.0.0.1:0",
	getRpcServerHealth: vi.fn(async (address: string) => {
		return rpcHealthByAddress.get(address);
	}),
}));

vi.mock("./rpc-runtime-ensure", () => ({
	ensureRpcRuntimeAddress: ensureRpcRuntimeAddressMock,
	resolveRpcOwnerContext: resolveRpcOwnerContextMock,
}));

vi.mock("../storage/sqlite-session-store", () => ({
	SqliteSessionStore: class {
		init(): void {
			sqliteInitMock();
		}
	},
}));

describe("resolveSessionBackend", () => {
	const logger = {
		debug: vi.fn(),
		log: vi.fn(),
		error: vi.fn(),
	};

	afterEach(() => {
		sqliteInitMock.mockReset();
		ensureRpcRuntimeAddressMock.mockReset();
		resolveRpcOwnerContextMock.mockClear();
		rpcHealthByAddress.clear();
		logger.debug.mockReset();
		logger.log.mockReset();
		logger.error.mockReset();
		delete process.env.CLINE_SESSION_BACKEND_MODE;
		delete process.env.CLINE_VCR;
		vi.resetModules();
	});

	it("falls back to file session storage when sqlite initialization fails", async () => {
		const { resolveSessionBackend } = await import("./session-host");
		sqliteInitMock.mockImplementation(() => {
			throw new Error("sqlite unavailable");
		});

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend.constructor.name).toBe("FileSessionService");
	});

	it("silently falls back to file session storage when node:sqlite is unavailable", async () => {
		const { resolveSessionBackend } = await import("./session-host");
		sqliteInitMock.mockImplementation(() => {
			const error = new Error(
				"No such built-in module: node:sqlite",
			) as Error & {
				code?: string;
			};
			error.code = "ERR_UNKNOWN_BUILTIN_MODULE";
			throw error;
		});

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend.constructor.name).toBe("FileSessionService");
	});

	it("connects to the ensured rpc address when the sidecar relocates ports", async () => {
		const { resolveSessionBackend } = await import("./session-host");
		ensureRpcRuntimeAddressMock.mockResolvedValue({
			address: "ws://127.0.0.1:12345",
			action: "new-port",
			owner: {
				ownerId: "core-owner",
				buildId: "core-build",
				discoveryPath: "/tmp/rpc-owner.json",
			},
		});
		rpcHealthByAddress.set("ws://127.0.0.1:12345", {
			running: true,
			serverId: "rpc-server",
		});

		const backend = await resolveSessionBackend({
			backendMode: "auto",
			rpc: {
				address: "ws://127.0.0.1:4317",
				connectAttempts: 1,
				connectDelayMs: 0,
			},
		});

		expect(ensureRpcRuntimeAddressMock).toHaveBeenCalledWith(
			"ws://127.0.0.1:4317",
			expect.objectContaining({
				spawnIfNeeded: expect.any(Function),
				resolveOwner: expect.any(Function),
			}),
		);
		expect(backend).not.toBeInstanceOf(FileSessionService);
	});

	it("logs the rpc auto-start failure before falling back to local", async () => {
		const { resolveSessionBackend } = await import("./session-host");
		ensureRpcRuntimeAddressMock.mockRejectedValue(
			new Error(
				"failed to ensure rpc runtime at ws://127.0.0.1:4317: health probe reported no running server",
			),
		);

		const backend = await resolveSessionBackend({
			backendMode: "auto",
			logger,
			rpc: {
				address: "ws://127.0.0.1:4317",
				connectAttempts: 1,
				connectDelayMs: 0,
			},
		});

		expect(backend).not.toBeInstanceOf(FileSessionService);
		expect(logger.log).toHaveBeenCalledWith(
			"Ensuring RPC runtime for auto session backend",
			{ address: "ws://127.0.0.1:4317" },
		);
		expect(logger.error).toHaveBeenCalledWith(
			"RPC backend auto-start failed",
			expect.objectContaining({
				address: "ws://127.0.0.1:4317",
				requestedAddress: "ws://127.0.0.1:4317",
				error: expect.any(Error),
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"Falling back to local session backend",
			{
				requestedAddress: "ws://127.0.0.1:4317",
				address: "ws://127.0.0.1:4317",
				attempts: 1,
				delayMs: 0,
				severity: "warn",
			},
		);
	});

	it("honors env-managed local mode inside core backend resolution", async () => {
		process.env.CLINE_SESSION_BACKEND_MODE = "local";
		const { resolveSessionBackend } = await import("./session-host");

		const backend = await resolveSessionBackend({});

		expect(backend).not.toBeInstanceOf(FileSessionService);
		expect(ensureRpcRuntimeAddressMock).not.toHaveBeenCalled();
	});

	it("forces local backend when vcr is enabled", async () => {
		process.env.CLINE_VCR = "1";
		const { resolveSessionBackend } = await import("./session-host");

		const backend = await resolveSessionBackend({});

		expect(backend).not.toBeInstanceOf(FileSessionService);
		expect(ensureRpcRuntimeAddressMock).not.toHaveBeenCalled();
	});
});
