import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
	mockSpawnSync,
	mockResolveClineDataDir,
	mockResolveSharedHubOwnerContext,
	mockReadHubDiscovery,
	mockProbeHubServer,
	mockClearHubDiscovery,
} = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
	mockResolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-owner",
		discoveryPath: path.join(
			"/tmp/cline-data",
			"locks",
			"hub",
			"owners",
			"hub-owner.json",
		),
	})),
	mockReadHubDiscovery: vi.fn(),
	mockProbeHubServer: vi.fn(),
	mockClearHubDiscovery: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@clinebot/core", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	clearHubDiscovery: mockClearHubDiscovery,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
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

	it("does not report hub processes as stale cli processes", async () => {
		const cwd = "/workspace";
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:4317/hub",
			port: 4317,
			pid: 50174,
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:4317/hub",
			port: 4317,
			pid: 50174,
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
						"50174 /Users/example/.bun/bin/bun /Users/example/dev/sdk/apps/cli/src/index.ts hub start --cwd /workspace",
						"50190 /Users/example/.bun/bin/bun /Users/example/dev/sdk/apps/cli/src/index.ts hey",
					].join("\n"),
				};
			}
			return { status: 1, stdout: "" };
		});

		const output: string[] = [];
		const code = await runDoctorCommand(
			{ cwd, json: true },
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
						hubStartupLocks: [],
						staleCliPids: [],
					}
				: {
						listeningPids: [50174],
						hubStartupLocks: [],
						staleCliPids: [50190],
					},
		);
	});

	it("doctor --fix clears wedged hub startup artifacts when no server is actually running", async () => {
		const cwd = mkdtempSync(path.join(os.tmpdir(), "doctor-hub-fix-"));
		tempDirs.push(cwd);
		const discoveryPath = path.join(cwd, ".hub-discovery.json");
		mockResolveSharedHubOwnerContext.mockReturnValue({
			ownerId: "hub-owner",
			discoveryPath,
		});
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:4317/hub",
			port: 4317,
			pid: 50000,
		});
		mockProbeHubServer.mockResolvedValue(undefined);
		mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

		const startupLockDir = `${discoveryPath}.lock`;
		writeFileSync(
			discoveryPath,
			JSON.stringify({
				url: "ws://127.0.0.1:4317/hub",
				port: 4317,
				pid: 50000,
			}),
			"utf8",
		);
		mkdirSync(startupLockDir, { recursive: true });
		writeFileSync(
			path.join(startupLockDir, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				acquiredAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const output: string[] = [];
		const code = await runDoctorCommand(
			{ cwd, json: true, fix: true },
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
				hubListeners: 0,
				cliProcesses: 0,
				hubStartupLocks: 1,
				hubDiscovery: 1,
			},
			after: {
				hubHealthy: false,
				listeningPids: [],
				hubStartupLocks: [],
			},
		});
		expect(mockClearHubDiscovery).toHaveBeenCalledWith(discoveryPath);
	});
});
