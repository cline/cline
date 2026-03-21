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
} = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
	mockGetRpcServerHealth: vi.fn(),
	mockStopRuntimeSession: vi.fn(),
	mockClientClose: vi.fn(),
	mockCreateServer: vi.fn(),
}));

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
	requestRpcServerShutdown: vi.fn(),
	startRpcServer: vi.fn(),
	stopRpcServer: vi.fn(),
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
});
