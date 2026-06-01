import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCliBuildInfo } from "../utils/common";

const {
	mockSpawnSync,
	mockResolveClineDataDir,
	mockResolveSharedHubOwnerContext,
	mockReadHubDiscovery,
	mockProbeHubServer,
	mockClearHubDiscovery,
	mockStopLocalHubServerGracefully,
	mockEnsureFileExists,
	mockStopAllConnectors,
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
	mockStopLocalHubServerGracefully: vi.fn(async () => false),
	mockEnsureFileExists: vi.fn(),
	mockStopAllConnectors: vi.fn(async () => ({
		stoppedProcesses: 0,
		stoppedSessions: 0,
		executed: 0,
	})),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@cline/core", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	clearHubDiscovery: mockClearHubDiscovery,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
	ensureFileExists: mockEnsureFileExists,
}));

vi.mock("../connectors/common", () => ({
	isProcessRunning: vi.fn(() => false),
}));

vi.mock("./connect", () => ({
	stopAllConnectors: mockStopAllConnectors,
}));

import { createDoctorCommand, runDoctorCommand } from "./doctor";

describe("runDoctorCommand", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.clearAllMocks();
		mockResolveClineDataDir.mockReturnValue("/tmp/cline-data");
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		mockStopAllConnectors.mockResolvedValue({
			stoppedProcesses: 0,
			stoppedSessions: 0,
			executed: 0,
		});
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not report hub processes as stale cli processes", async () => {
		const cwd = "/workspace";
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
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
						staleSidecarPids: [],
					}
				: {
						listeningPids: [50174],
						hubStartupLocks: [],
						staleCliPids: [50190],
						staleSidecarPids: [],
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
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50000,
		});
		mockProbeHubServer.mockResolvedValue(undefined);
		mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

		const startupLockDir = `${discoveryPath}.lock`;
		writeFileSync(
			discoveryPath,
			JSON.stringify({
				url: "ws://127.0.0.1:25463/hub",
				port: 25463,
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
				sidecarProcesses: 0,
				hubStartupLocks: 1,
				hubDiscovery: 1,
			},
			after: {
				hubHealthy: false,
				listeningPids: [],
				hubStartupLocks: [],
				staleSidecarPids: [],
			},
		});
		expect(mockClearHubDiscovery).toHaveBeenCalledWith(discoveryPath);
	});

	it("doctor --fix stops connector adapters and reports counts in JSON", async () => {
		const cwd = "/workspace";
		mockReadHubDiscovery.mockResolvedValue(undefined);
		mockProbeHubServer.mockResolvedValue(undefined);
		mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
		mockStopAllConnectors.mockResolvedValue({
			stoppedProcesses: 2,
			stoppedSessions: 5,
			executed: 3,
		});

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
		expect(mockStopAllConnectors).toHaveBeenCalledTimes(1);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			killed: {
				connectorProcesses: 2,
				connectorSessions: 5,
			},
		});
	});

	it("doctor --fix kills stale code sidecar processes", async () => {
		const cwd = "/workspace";
		mockReadHubDiscovery.mockResolvedValue(undefined);
		mockProbeHubServer.mockResolvedValue(undefined);
		mockSpawnSync.mockImplementation((command: string, args?: string[]) => {
			if (
				command === "pgrep" &&
				Array.isArray(args) &&
				args[0] === "-fal" &&
				args[1] === "/src-tauri/bin/code-sidecar"
			) {
				return {
					status: 0,
					stdout:
						"60123 /Users/example/dev/sdk/apps/examples/desktop-app/src-tauri/bin/code-sidecar\n",
				};
			}
			return { status: 1, stdout: "" };
		});
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

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
		expect(killSpy).toHaveBeenCalledWith(60123, "SIGKILL");
		expect(JSON.parse(output[0] || "")).toMatchObject({
			before: {
				staleSidecarPids: [60123],
			},
			killed: {
				sidecarProcesses: 1,
			},
		});
		killSpy.mockRestore();
	});
});

describe("createDoctorCommand log subcommand", () => {
	const tempDirs: string[] = [];
	const commandName = getCliBuildInfo().name;

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("opens the log file for doctor log", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-doctor-log-test-`),
		);
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		mockEnsureFileExists.mockImplementation((filePath: string) => {
			mkdirSync(path.dirname(filePath), { recursive: true });
			appendFileSync(filePath, "");
		});

		const opened: string[] = [];
		const output: string[] = [];
		const errors: string[] = [];
		let exitCode = 0;

		const cmd = createDoctorCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
			{
				openPath: async (target) => {
					opened.push(target);
				},
			},
		);

		await cmd.parseAsync(["log"], { from: "user" });

		const expectedPath = path.join(dataDir, "logs", `${commandName}.log`);
		expect(exitCode).toBe(0);
		expect(errors).toHaveLength(0);
		expect(opened).toEqual([expectedPath]);
		expect(output).toEqual([`Opening logs stored at ${expectedPath}`]);
		expect(existsSync(expectedPath)).toBe(true);
	});

	it("returns an error if opening log file fails", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-doctor-log-test-`),
		);
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);

		const errors: string[] = [];
		let exitCode = 0;

		const cmd = createDoctorCommand(
			{
				writeln: () => {},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
			{
				openPath: async () => {
					throw new Error("open failed");
				},
			},
		);

		await cmd.parseAsync(["log"], { from: "user" });

		expect(exitCode).toBe(1);
		expect(errors[0]).toContain("failed to open log file");
		expect(errors[0]).toContain("open failed");
	});
});
