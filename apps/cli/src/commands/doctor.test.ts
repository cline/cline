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
import { version as cliVersion } from "../../package.json";
import { getCliBuildInfo } from "../utils/common";

const {
	mockSpawnSync,
	mockResolveClineDataDir,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockReadHubDiscovery,
	mockReadSupersededHubDiscovery,
	mockProbeHubServer,
	mockClearHubDiscovery,
	mockStopLocalHubServerGracefully,
	mockEnsureFileExists,
	mockListActiveConnectors,
	mockStopAllConnectors,
	mockListSupervisedConnectors,
} = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
	mockResolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-production",
		discoveryPath: path.join(
			"/tmp/cline-data",
			"locks",
			"hub",
			"production.json",
		),
	})),
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
	mockReadSupersededHubDiscovery: vi.fn(() => undefined as unknown),
	mockProbeHubServer: vi.fn(),
	mockClearHubDiscovery: vi.fn(),
	mockStopLocalHubServerGracefully: vi.fn(async () => false),
	mockEnsureFileExists: vi.fn(),
	mockListActiveConnectors: vi.fn(() => []),
	mockStopAllConnectors: vi.fn(async () => ({
		stoppedProcesses: 0,
		failedProcesses: 0,
		stoppedSessions: 0,
		executed: 0,
	})),
	mockListSupervisedConnectors: vi.fn(async () => undefined as unknown),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@cline/core", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	clearHubDiscovery: mockClearHubDiscovery,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	readSupersededHubDiscovery: mockReadSupersededHubDiscovery,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
	ensureFileExists: mockEnsureFileExists,
	listActiveConnectors: mockListActiveConnectors,
}));

vi.mock("../connectors/common", () => ({
	isProcessRunning: vi.fn(() => false),
}));

vi.mock("./connect", () => ({
	stopAllConnectors: mockStopAllConnectors,
}));

vi.mock("./connect-via-hub", () => ({
	listSupervisedConnectorsViaHub: mockListSupervisedConnectors,
}));

import { __test__, createDoctorCommand, runDoctorCommand } from "./doctor";

describe("runDoctorCommand", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.clearAllMocks();
		mockResolveClineDataDir.mockReturnValue("/tmp/cline-data");
		mockResolveProductionHubOwnerContext.mockReturnValue({
			ownerId: "hub-production",
			discoveryPath: path.join(
				"/tmp/cline-data",
				"locks",
				"hub",
				"production.json",
			),
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(false);
		mockStopAllConnectors.mockResolvedValue({
			stoppedProcesses: 0,
			failedProcesses: 0,
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
				args[1] === "--" &&
				args[2] === "/apps/cli/src/index.ts"
			) {
				return {
					status: 0,
					stdout: [
						"50174 /Users/example/.bun/bin/bun /Users/example/dev/apps/cli/src/index.ts hub start --cwd /workspace",
						"50190 /Users/example/.bun/bin/bun /Users/example/dev/apps/cli/src/index.ts hey",
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

	it("sees the hub through the set-aside record during the shielded update window", async () => {
		const cwd = "/workspace";
		// The npm postinstall shield renamed the discovery record aside; the
		// hub is alive and serving an old client's sessions.
		mockReadHubDiscovery.mockResolvedValue(undefined);
		mockReadSupersededHubDiscovery.mockReturnValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "shielded-token",
			pid: 50174,
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
		mockSpawnSync.mockImplementation((command: string, args?: string[]) => {
			if (command === "lsof") {
				return { status: 0, stdout: "50174\n" };
			}
			if (
				command === "pgrep" &&
				Array.isArray(args) &&
				args[2] === "--cline-hub-daemon"
			) {
				return {
					status: 0,
					stdout: "50174 /usr/local/bin/cline --cline-hub-daemon\n",
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
		expect(mockProbeHubServer).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			{
				authToken: "shielded-token",
			},
		);
		// Without the fallback the live daemon reads as stale and doctor's
		// advice (\"run doctor fix\") would kill the sessions the shield exists
		// to protect.
		expect(JSON.parse(output[0] || "")).toMatchObject({
			hubHealthy: true,
			staleHubPids: [],
		});
	});

	it("reports CLI and running hub Core versions", async () => {
		const cwd = "/workspace";
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			coreVersion: "0.0.63",
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			coreVersion: "0.0.64",
		});
		mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

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
		expect(JSON.parse(output[0] || "")).toMatchObject({
			cliVersion,
			coreVersion: "0.0.64",
		});
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
			failedProcesses: 0,
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
				args[1] === "--" &&
				args[2] === "/src-tauri/bin/code-sidecar"
			) {
				return {
					status: 0,
					stdout:
						"60123 /Users/example/dev/apps/examples/desktop-app/src-tauri/bin/code-sidecar\n",
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

describe("container-aware process filtering", () => {
	const { decideForeignContainer, CONTAINER_CGROUP_PATTERN } = __test__;

	it("treats a process in a different pid namespace as foreign", () => {
		expect(
			decideForeignContainer({
				platform: "linux",
				namespacePairs: [
					["pid:[4026531836]", "pid:[4026532500]"],
					[undefined, undefined],
				],
				ownContainerId: undefined,
				otherContainerId: undefined,
			}),
		).toBe(true);
	});

	it("keeps a sibling process in our own namespaces", () => {
		expect(
			decideForeignContainer({
				platform: "linux",
				namespacePairs: [
					["pid:[4026531836]", "pid:[4026531836]"],
					["mnt:[4026531840]", "mnt:[4026531840]"],
				],
				ownContainerId: undefined,
				otherContainerId: undefined,
			}),
		).toBe(false);
	});

	it("falls back to cgroup container ids when namespaces are unreadable", () => {
		expect(
			decideForeignContainer({
				platform: "linux",
				namespacePairs: [[undefined, undefined]],
				ownContainerId: undefined,
				otherContainerId: "7c6ffadc42f0bc0bc7c6ca47de4cd702",
			}),
		).toBe(true);
		// Same container: our own sibling process, not something to retire.
		expect(
			decideForeignContainer({
				platform: "linux",
				namespacePairs: [[undefined, undefined]],
				ownContainerId: "7c6ffadc42f0bc0bc7c6ca47de4cd702",
				otherContainerId: "7c6ffadc42f0bc0bc7c6ca47de4cd702",
			}),
		).toBe(false);
	});

	it("never filters off Linux, where containers cannot share our pid space", () => {
		expect(
			decideForeignContainer({
				platform: "darwin",
				namespacePairs: [["pid:[1]", "pid:[2]"]],
				ownContainerId: undefined,
				otherContainerId: "abcdef123456",
			}),
		).toBe(false);
	});

	it("extracts container ids from real cgroup paths", () => {
		const docker =
			"0::/system.slice/docker-7c6ffadc42f0bc0bc7c6ca47de4cd702206e79b4068d172d8c2a2350063913ad.scope";
		expect(docker.match(CONTAINER_CGROUP_PATTERN)?.[1]).toBe(
			"7c6ffadc42f0bc0bc7c6ca47de4cd702206e79b4068d172d8c2a2350063913ad",
		);
		// A plain host session must not look like a container.
		expect(
			"0::/user.slice/user-1001.slice/session-121.scope".match(
				CONTAINER_CGROUP_PATTERN,
			),
		).toBeNull();
	});
});

describe("doctor supervision reporting", () => {
	const { formatSupervisedConnector } = __test__;

	afterEach(() => {
		vi.clearAllMocks();
		mockListSupervisedConnectors.mockResolvedValue(undefined);
	});

	async function runDoctorJson(): Promise<Record<string, unknown>> {
		const output: string[] = [];
		await runDoctorCommand(
			{ cwd: "/workspace", json: true },
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
		);
		return JSON.parse(output[0] || "{}") as Record<string, unknown>;
	}

	it("reports what the hub is supervising", async () => {
		mockListSupervisedConnectors.mockResolvedValue([
			{
				channel: "slack",
				instanceId: "cline-slack",
				state: "backoff",
				origin: "spawned",
				restarts: 3,
			},
		]);

		await expect(runDoctorJson()).resolves.toMatchObject({
			supervisedConnectors: [
				{ channel: "slack", instanceId: "cline-slack", state: "backoff" },
			],
		});
	});

	it("omits supervision when the hub cannot report it", async () => {
		mockListSupervisedConnectors.mockResolvedValue(undefined);

		const status = await runDoctorJson();

		expect(status.supervisedConnectors).toBeUndefined();
	});

	it("stays usable when the supervision query fails", async () => {
		mockListSupervisedConnectors.mockRejectedValue(new Error("hub gone"));

		// Diagnostics must degrade quietly rather than fail.
		const status = await runDoctorJson();

		expect(status.supervisedConnectors).toBeUndefined();
		expect(status).toHaveProperty("hubHealthy");
	});

	it("formats restart and failure state so a crash loop is visible", () => {
		expect(
			formatSupervisedConnector({
				channel: "slack",
				instanceId: "cline-slack",
				state: "failed",
				origin: "adopted",
				pid: 42,
				restarts: 5,
				lastExitCode: 1,
				lastError: "invalid token",
			}),
		).toBe(
			"slack | instance=cline-slack | state=failed | origin=adopted | pid=42 | restarts=5 | lastExit=1 | error=invalid token",
		);
	});

	it("leaves out fields that do not apply to a healthy connector", () => {
		expect(
			formatSupervisedConnector({
				channel: "telegram",
				instanceId: "cline_bot",
				state: "running",
				origin: "spawned",
				pid: 7,
				restarts: 0,
			}),
		).toBe(
			"telegram | instance=cline_bot | state=running | origin=spawned | pid=7",
		);
	});
});

describe("describeProcessesStartedDuringFix", () => {
	const { describeProcessesStartedDuringFix } = __test__;
	const liveParents = new Map([
		[100, 10],
		[200, 20],
	]);
	const resolveLiveParent = (pid: number) => liveParents.get(pid);

	it("says nothing when no process started during the fix", () => {
		expect(
			describeProcessesStartedDuringFix([], resolveLiveParent),
		).toBeUndefined();
	});

	it("blames the parent only when every process has a live one", () => {
		expect(
			describeProcessesStartedDuringFix([100, 200], resolveLiveParent),
		).toBe(
			"\nThese processes were respawned by a live parent. Stop the parent process listed above, then re-run.",
		);
	});

	// A process can start on its own mid-repair - a user opening a new session,
	// say - and telling them to go kill an unrelated parent would be wrong.
	it("states the facts when no process has a live parent", () => {
		expect(describeProcessesStartedDuringFix([777], resolveLiveParent)).toBe(
			"\nThese processes started after the fix began, so they were not targeted. Re-run to see whether they persist.",
		);
	});

	it("separates respawns from independent starts in a mixed batch", () => {
		expect(
			describeProcessesStartedDuringFix([100, 777], resolveLiveParent),
		).toBe(
			"\nSome of these were respawned by a live parent (100); stop the parent process listed above, then re-run. The rest started after the fix began and were not targeted.",
		);
	});
});
