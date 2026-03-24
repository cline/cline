import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockSpawn,
	mockGetRpcServerHealth,
	mockStopRuntimeSession,
	mockClientClose,
	mockCreateServer,
	mockRequestRpcServerShutdown,
	rpcPkgVersion,
} = vi.hoisted(() => {
	const fs = require("node:fs") as typeof import("node:fs");
	const p = require("node:path") as typeof import("node:path");
	const pkg = JSON.parse(
		fs.readFileSync(
			p.resolve(__dirname, "../../../../packages/rpc/package.json"),
			"utf8",
		),
	) as { version: string };
	return {
		mockSpawn: vi.fn(),
		mockGetRpcServerHealth: vi.fn(),
		mockStopRuntimeSession: vi.fn(),
		mockClientClose: vi.fn(),
		mockCreateServer: vi.fn(),
		mockRequestRpcServerShutdown: vi.fn(),
		rpcPkgVersion: pkg.version,
	};
});

vi.mock("node:child_process", () => ({
	spawn: mockSpawn,
	spawnSync: vi.fn(),
}));

vi.mock("node:net", () => ({
	createServer: mockCreateServer,
}));

vi.mock("@clinebot/rpc", () => ({
	getRpcServerDefaultAddress: vi.fn(() => "127.0.0.1:4317"),
	getRpcServerHealth: mockGetRpcServerHealth,
	registerRpcClient: vi.fn(),
	requestRpcServerShutdown: mockRequestRpcServerShutdown,
	startRpcServer: vi.fn(),
	stopRpcServer: vi.fn(),
	RPC_PROTOCOL_VERSION: rpcPkgVersion,
	RpcSessionClient: class {
		async stopRuntimeSession(sessionId: string) {
			return mockStopRuntimeSession(sessionId);
		}

		close() {
			mockClientClose();
		}
	},
}));

import { runRpcEnsureCommand } from "./rpc";

describe("runRpcEnsureCommand", () => {
	const tempDirs: string[] = [];
	const originalArgv = [...process.argv];

	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
		process.argv = [...originalArgv];
		vi.clearAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates the rpc lock parent directory when it does not exist", async () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cline-rpc-lock-test-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;
		process.argv[1] = path.join(dataDir, "clite.js");
		const address = "127.0.0.1:65432";

		mockSpawn.mockReturnValue({ pid: 1234, unref: vi.fn() });
		mockCreateServer.mockImplementation(() => {
			let onListening: (() => void) | undefined;
			return {
				once: (event: string, handler: () => void) => {
					if (event === "listening") {
						onListening = handler;
					}
				},
				listen: () => {
					onListening?.();
				},
				close: (handler?: () => void) => {
					handler?.();
				},
			};
		});
		mockGetRpcServerHealth
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ running: true });
		mockStopRuntimeSession.mockRejectedValue(new Error("probe failed"));

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runRpcEnsureCommand(
			{ address, json: true },
			(text) => {
				output.push(text ?? "");
			},
			(text) => {
				errors.push(text);
			},
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(output).toHaveLength(1);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			running: true,
			requestedAddress: address,
			address,
			action: "started",
		});
		expect(existsSync(path.join(dataDir, "locks"))).toBe(true);
		expect(mockSpawn).toHaveBeenCalledTimes(1);
		expect(mockClientClose).toHaveBeenCalledTimes(1);
	});

	it("reuses the server when rpc version matches", async () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cline-rpc-ver-match-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;
		process.argv[1] = path.join(dataDir, "clite.js");
		const address = "127.0.0.1:65432";

		// Server is healthy and reports matching version.
		mockGetRpcServerHealth.mockResolvedValue({
			running: true,
			serverId: "test-server",
			address,
			startedAt: new Date().toISOString(),
			rpcVersion: rpcPkgVersion,
		});
		// Runtime method probe succeeds (not UNIMPLEMENTED).
		mockStopRuntimeSession.mockRejectedValue(new Error("session not found"));

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runRpcEnsureCommand(
			{ address, json: true },
			(text) => output.push(text ?? ""),
			(text) => errors.push(text),
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		const result = JSON.parse(output[0] || "");
		expect(result).toMatchObject({
			running: true,
			address,
			action: "reuse",
		});
		// Should NOT spawn a new server.
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("restarts the server when rpc version mismatches", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), "cline-rpc-ver-mismatch-"),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;
		process.argv[1] = path.join(dataDir, "clite.js");
		const address = "127.0.0.1:65432";

		mockCreateServer.mockImplementation(() => {
			let onListening: (() => void) | undefined;
			return {
				once: (event: string, handler: () => void) => {
					if (event === "listening") {
						onListening = handler;
					}
				},
				listen: () => {
					onListening?.();
				},
				close: (handler?: () => void) => {
					handler?.();
				},
			};
		});

		// First call: server healthy with old version.
		// After shutdown: server gone, then new server comes up healthy.
		mockGetRpcServerHealth
			.mockResolvedValueOnce({
				running: true,
				serverId: "old-server",
				address,
				startedAt: new Date().toISOString(),
				rpcVersion: "old-version",
			})
			// After shutdown request, server reports not running.
			.mockResolvedValueOnce(undefined)
			// waitForRuntimeReady polls: new server is healthy with matching version.
			.mockResolvedValue({
				running: true,
				serverId: "new-server",
				address,
				startedAt: new Date().toISOString(),
				rpcVersion: rpcPkgVersion,
			});

		// Runtime method probe succeeds (not UNIMPLEMENTED).
		mockStopRuntimeSession.mockRejectedValue(new Error("session not found"));
		// Shutdown accepted.
		mockRequestRpcServerShutdown.mockResolvedValue({ accepted: true });
		// New detached server spawned.
		mockSpawn.mockReturnValue({ pid: 5678, unref: vi.fn() });

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runRpcEnsureCommand(
			{ address, json: true },
			(text) => output.push(text ?? ""),
			(text) => errors.push(text),
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		const result = JSON.parse(output[0] || "");
		expect(result).toMatchObject({
			running: true,
			address,
			action: "started",
		});
		expect(mockRequestRpcServerShutdown).toHaveBeenCalledWith(address);
		expect(mockSpawn).toHaveBeenCalledTimes(1);
	});

	it("restarts the server when rpc version is missing (old server)", async () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cline-rpc-ver-empty-"));
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;
		process.argv[1] = path.join(dataDir, "clite.js");
		const address = "127.0.0.1:65432";

		mockCreateServer.mockImplementation(() => {
			let onListening: (() => void) | undefined;
			return {
				once: (event: string, handler: () => void) => {
					if (event === "listening") {
						onListening = handler;
					}
				},
				listen: () => {
					onListening?.();
				},
				close: (handler?: () => void) => {
					handler?.();
				},
			};
		});

		// Server healthy but no rpcVersion field (pre-upgrade server).
		mockGetRpcServerHealth
			.mockResolvedValueOnce({
				running: true,
				serverId: "old-server",
				address,
				startedAt: new Date().toISOString(),
				// No rpcVersion field.
			})
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue({
				running: true,
				serverId: "new-server",
				address,
				startedAt: new Date().toISOString(),
				rpcVersion: rpcPkgVersion,
			});

		mockStopRuntimeSession.mockRejectedValue(new Error("session not found"));
		mockRequestRpcServerShutdown.mockResolvedValue({ accepted: true });
		mockSpawn.mockReturnValue({ pid: 9999, unref: vi.fn() });

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runRpcEnsureCommand(
			{ address, json: true },
			(text) => output.push(text ?? ""),
			(text) => errors.push(text),
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		const result = JSON.parse(output[0] || "");
		expect(result).toMatchObject({
			running: true,
			address,
			action: "started",
		});
		expect(mockRequestRpcServerShutdown).toHaveBeenCalledWith(address);
		expect(mockSpawn).toHaveBeenCalledTimes(1);
	});

	it("replaces an auth-gated listener instead of reusing it", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), "cline-rpc-auth-gated-"),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;
		process.argv[1] = path.join(dataDir, "clite.js");
		const address = "127.0.0.1:65432";

		mockCreateServer.mockImplementation(() => {
			let onListening: (() => void) | undefined;
			return {
				once: (event: string, handler: () => void) => {
					if (event === "listening") {
						onListening = handler;
					}
				},
				listen: () => {
					onListening?.();
				},
				close: (handler?: () => void) => {
					handler?.();
				},
			};
		});

		mockGetRpcServerHealth
			.mockResolvedValueOnce({
				running: true,
				serverId: "foreign-auth-server",
				address,
				startedAt: new Date().toISOString(),
				rpcVersion: rpcPkgVersion,
			})
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue({
				running: true,
				serverId: "new-server",
				address,
				startedAt: new Date().toISOString(),
				rpcVersion: rpcPkgVersion,
			});

		mockStopRuntimeSession
			.mockRejectedValueOnce(
				new Error(
					"3 INVALID_ARGUMENT: Error: 401 Missing Authentication header",
				),
			)
			.mockRejectedValue(new Error("session not found"));
		mockRequestRpcServerShutdown.mockResolvedValue({ accepted: true });
		mockSpawn.mockReturnValue({ pid: 12345, unref: vi.fn() });

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runRpcEnsureCommand(
			{ address, json: true },
			(text) => output.push(text ?? ""),
			(text) => errors.push(text),
		);

		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			running: true,
			address,
			action: "started",
		});
		expect(mockRequestRpcServerShutdown).toHaveBeenCalledWith(address);
		expect(mockSpawn).toHaveBeenCalledTimes(1);
	});
});
