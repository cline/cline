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
	afterEach(() => {
		sqliteInitMock.mockReset();
		ensureRpcRuntimeAddressMock.mockReset();
		resolveRpcOwnerContextMock.mockClear();
		rpcHealthByAddress.clear();
		vi.resetModules();
	});

	it("falls back to file session storage when sqlite initialization fails", async () => {
		const { resolveSessionBackend } = await import("./session-host");
		sqliteInitMock.mockImplementation(() => {
			throw new Error("sqlite unavailable");
		});

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend).toBeInstanceOf(FileSessionService);
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
});
