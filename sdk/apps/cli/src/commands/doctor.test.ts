import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync, mockGetRpcServerHealth, mockResolveClineDataDir } =
	vi.hoisted(() => ({
		mockSpawnSync: vi.fn(),
		mockGetRpcServerHealth: vi.fn(),
		mockResolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
	}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@clinebot/core", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
}));

vi.mock("@clinebot/rpc", () => ({
	RPC_BUILD_VERSION: "rpc-build-test",
	getRpcServerHealth: mockGetRpcServerHealth,
	getRpcServerDefaultAddress: vi.fn(() => "127.0.0.1:4317"),
}));

vi.mock("../connectors/common", () => ({
	isProcessRunning: vi.fn(() => false),
}));

import { runDoctorCommand } from "./doctor";

describe("runDoctorCommand", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.clearAllMocks();
		mockResolveClineDataDir.mockReturnValue("/tmp/cline-data");
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not report rpc or hook worker processes as stale cli processes", async () => {
		mockGetRpcServerHealth.mockResolvedValue({
			running: true,
			serverId: "server-1",
		});
		mockSpawnSync.mockImplementation((command: string, args?: string[]) => {
			if (command === "lsof") {
				return {
					status: 0,
					stdout: "50174\n",
				};
			}
			if (
				command === "pgrep" &&
				Array.isArray(args) &&
				args[0] === "-fal" &&
				args[1] === "/apps/cli/src/index.ts"
			) {
				return {
					status: 0,
					stdout: [
						"50174 /Users/example/.bun/bin/bun /Users/example/dev/sdk/apps/cli/src/index.ts rpc start --address 127.0.0.1:4317",
						"50181 /Users/example/.bun/bin/bun /Users/example/dev/sdk/apps/cli/src/index.ts hook-worker",
						"50190 /Users/example/.bun/bin/bun /Users/example/dev/sdk/apps/cli/src/index.ts hey",
					].join("\n"),
				};
			}
			if (
				command === "pgrep" &&
				Array.isArray(args) &&
				args[0] === "-f" &&
				(args[1] === "hook-worker" || args[1] === " hook-worker ")
			) {
				return {
					status: 0,
					stdout: "50181\n",
				};
			}
			return { status: 1, stdout: "" };
		});

		const output: string[] = [];
		const code = await runDoctorCommand(
			{ address: "127.0.0.1:4317", json: true },
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(output).toHaveLength(1);
		expect(JSON.parse(output[0] || "")).toMatchObject(
			process.platform === "win32"
				? {
						listeningPids: [],
						rpcStartupLocks: [],
						rpcSpawnLeases: [],
						staleCliPids: [],
						hookWorkerPids: [],
					}
				: {
						listeningPids: [50174],
						rpcStartupLocks: [],
						rpcSpawnLeases: [],
						staleCliPids: [50190],
						hookWorkerPids: [50181],
					},
		);
	});

	it("doctor --fix clears wedged rpc lock artifacts when no server is actually running", async () => {
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "doctor-rpc-fix-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		mockGetRpcServerHealth.mockResolvedValue(undefined);
		mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

		const startupLockDir = path.join(
			dataDir,
			"locks",
			"rpc-start-127.0.0.1_4317.lock",
		);
		mkdirSync(startupLockDir, { recursive: true });
		writeFileSync(
			path.join(startupLockDir, "owner.json"),
			JSON.stringify({
				address: "127.0.0.1:4317",
				pid: process.pid,
				acquiredAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const spawnLeasePath = path.join(
			dataDir,
			"sessions",
			"rpc",
			"spawn-leases",
			"MTI3LjAuMC4xOjQzMTc.lock",
		);
		mkdirSync(path.dirname(spawnLeasePath), { recursive: true });
		writeFileSync(
			spawnLeasePath,
			JSON.stringify({
				address: "127.0.0.1:4317",
				pid: process.pid,
				createdAt: Date.now(),
			}),
			"utf8",
		);

		const output: string[] = [];
		const code = await runDoctorCommand(
			{ address: "127.0.0.1:4317", json: true, fix: true },
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
		);

		expect(code).toBe(0);
		expect(output).toHaveLength(1);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			killed: {
				rpcListeners: 0,
				cliProcesses: 0,
				hookWorkers: 0,
				rpcStartupLocks: 1,
				rpcSpawnLeases: 1,
			},
			after: {
				rpcHealthy: false,
				listeningPids: [],
				rpcStartupLocks: [],
				rpcSpawnLeases: [],
			},
		});
	});
});
