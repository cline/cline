import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockResolveClineDataDir, mockGetConnector } = vi.hoisted(() => ({
	mockResolveClineDataDir: vi.fn(),
	mockGetConnector: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
	ensureParentDir: (path: string) => {
		mkdirSync(dirname(path), { recursive: true });
	},
}));

vi.mock("./registry", () => ({
	getConnector: mockGetConnector,
}));

import {
	restartQueuedConnectorsForHub,
	stopConnectorsForHubs,
} from "./restart";

describe("connector restart queue", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		mockGetConnector.mockReset();
		mockResolveClineDataDir.mockReset();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("queues connector restart metadata when stopping connectors for a killed hub", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "connector-restart-test-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		const statePath = join(dataDir, "connectors", "telegram", "bot.json");
		const queuePath = join(dataDir, "connectors", "restart-queue.json");
		mkdirSync(join(dataDir, "connectors", "telegram"), { recursive: true });
		writeFileSync(
			statePath,
			JSON.stringify({
				botUsername: "bot",
				pid: 12345,
				rpcAddress: "ws://127.0.0.1:57648/hub",
				startedAt: new Date().toISOString(),
				restart: {
					connector: "telegram",
					args: ["-m", "bot", "--rpc-address", "ws://127.0.0.1:57648/hub"],
				},
			}),
			"utf8",
		);
		const alive = new Set([12345]);
		const killSpy = vi
			.spyOn(process, "kill")
			.mockImplementation((pid, signal) => {
				if (signal === 0 || signal === undefined) {
					if (alive.has(Number(pid))) {
						return true;
					}
					throw Object.assign(new Error("missing"), { code: "ESRCH" });
				}
				alive.delete(Number(pid));
				return true;
			});

		const stopped = await stopConnectorsForHubs(
			["ws://127.0.0.1:57648/hub"],
			{
				writeln: () => {},
				writeErr: () => {},
			},
			{
				targetHubUrl: "ws://127.0.0.1:25466/hub",
			},
		);

		expect(stopped).toEqual({ stoppedProcesses: 1, queuedRestarts: 1 });
		expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
		expect(existsSync(statePath)).toBe(false);
		expect(JSON.parse(readFileSync(queuePath, "utf8"))).toMatchObject([
			{
				connector: "telegram",
				hubUrl: "ws://127.0.0.1:57648/hub",
				targetHubUrl: "ws://127.0.0.1:25466/hub",
				pid: 12345,
			},
		]);

		const run = vi.fn(async () => 0);
		mockGetConnector.mockResolvedValue({ name: "telegram", run });
		const restarted = await restartQueuedConnectorsForHub(
			"ws://127.0.0.1:25466/hub",
			{ writeln: () => {}, writeErr: () => {} },
		);

		expect(restarted).toEqual({ restarted: 1, remaining: 0 });
		expect(run).toHaveBeenCalledWith(
			["-m", "bot", "--rpc-address", "ws://127.0.0.1:25466/hub"],
			expect.any(Object),
		);
		expect(existsSync(queuePath)).toBe(false);
	});

	it("rewrites equals-form rpc address args when restarting queued connectors", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "connector-restart-test-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		const queuePath = join(dataDir, "connectors", "restart-queue.json");
		mkdirSync(join(dataDir, "connectors"), { recursive: true });
		writeFileSync(
			queuePath,
			JSON.stringify([
				{
					connector: "telegram",
					args: ["-m", "bot", "--rpc-address=ws://127.0.0.1:57648/hub"],
					hubUrl: "ws://127.0.0.1:57648/hub",
					targetHubUrl: "ws://127.0.0.1:25466/hub",
					statePath: join(dataDir, "connectors", "telegram", "bot.json"),
					pid: 12345,
					stoppedAt: new Date().toISOString(),
				},
			]),
			"utf8",
		);

		const run = vi.fn(async () => 0);
		mockGetConnector.mockResolvedValue({ name: "telegram", run });

		const restarted = await restartQueuedConnectorsForHub(
			"ws://127.0.0.1:25466/hub",
			{ writeln: () => {}, writeErr: () => {} },
		);

		expect(restarted).toEqual({ restarted: 1, remaining: 0 });
		expect(run).toHaveBeenCalledWith(
			["-m", "bot", "--rpc-address=ws://127.0.0.1:25466/hub"],
			expect.any(Object),
		);
	});

	it("only restarts queue entries targeted at the started hub", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "connector-restart-test-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		const queuePath = join(dataDir, "connectors", "restart-queue.json");
		mkdirSync(join(dataDir, "connectors"), { recursive: true });
		writeFileSync(
			queuePath,
			JSON.stringify([
				{
					connector: "telegram",
					args: ["-m", "bot-a"],
					hubUrl: "ws://127.0.0.1:57648/hub",
					targetHubUrl: "ws://127.0.0.1:25466/hub",
					statePath: join(dataDir, "connectors", "telegram", "bot-a.json"),
					pid: 12345,
					stoppedAt: new Date().toISOString(),
				},
				{
					connector: "telegram",
					args: ["-m", "bot-b"],
					hubUrl: "ws://127.0.0.1:57649/hub",
					targetHubUrl: "ws://127.0.0.1:25467/hub",
					statePath: join(dataDir, "connectors", "telegram", "bot-b.json"),
					pid: 12346,
					stoppedAt: new Date().toISOString(),
				},
			]),
			"utf8",
		);

		const run = vi.fn(async () => 0);
		mockGetConnector.mockResolvedValue({ name: "telegram", run });

		const restarted = await restartQueuedConnectorsForHub(
			"ws://127.0.0.1:25466/hub",
			{ writeln: () => {}, writeErr: () => {} },
		);

		expect(restarted).toEqual({ restarted: 1, remaining: 1 });
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(
			["-m", "bot-a", "--rpc-address", "ws://127.0.0.1:25466/hub"],
			expect.any(Object),
		);
		expect(JSON.parse(readFileSync(queuePath, "utf8"))).toMatchObject([
			{
				args: ["-m", "bot-b"],
				targetHubUrl: "ws://127.0.0.1:25467/hub",
			},
		]);
	});

	it("keeps state and skips restart queue when connector termination fails", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "connector-restart-test-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		const statePath = join(dataDir, "connectors", "telegram", "bot.json");
		const queuePath = join(dataDir, "connectors", "restart-queue.json");
		mkdirSync(join(dataDir, "connectors", "telegram"), { recursive: true });
		writeFileSync(
			statePath,
			JSON.stringify({
				botUsername: "bot",
				pid: 12345,
				rpcAddress: "ws://127.0.0.1:57648/hub",
				startedAt: new Date().toISOString(),
				restart: {
					connector: "telegram",
					args: ["-m", "bot"],
				},
			}),
			"utf8",
		);
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (signal === 0 || signal === undefined) {
				if (Number(pid) === 12345) {
					return true;
				}
				throw Object.assign(new Error("missing"), { code: "ESRCH" });
			}
			return true;
		});
		const errors: string[] = [];

		const stopped = await stopConnectorsForHubs(["ws://127.0.0.1:57648/hub"], {
			writeln: () => {},
			writeErr: (text) => {
				errors.push(text);
			},
		});

		expect(stopped).toEqual({ stoppedProcesses: 0, queuedRestarts: 0 });
		expect(existsSync(statePath)).toBe(true);
		expect(existsSync(queuePath)).toBe(false);
		expect(errors).toEqual([
			"[connect] failed to stop connector pid=12345 hub=ws://127.0.0.1:57648/hub",
		]);
	});

	it("ignores non-directory entries while scanning connector state", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "connector-restart-test-"));
		tempDirs.push(dataDir);
		mockResolveClineDataDir.mockReturnValue(dataDir);
		const statePath = join(dataDir, "connectors", "telegram", "bot.json");
		const queuePath = join(dataDir, "connectors", "restart-queue.json");
		mkdirSync(join(dataDir, "connectors", "telegram"), { recursive: true });
		writeFileSync(queuePath, "[]", "utf8");
		writeFileSync(
			statePath,
			JSON.stringify({
				botUsername: "bot",
				pid: 12345,
				rpcAddress: "ws://127.0.0.1:57648/hub",
				startedAt: new Date().toISOString(),
				restart: {
					connector: "telegram",
					args: ["-m", "bot"],
				},
			}),
			"utf8",
		);
		const alive = new Set([12345]);
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (signal === 0 || signal === undefined) {
				if (alive.has(Number(pid))) {
					return true;
				}
				throw Object.assign(new Error("missing"), { code: "ESRCH" });
			}
			alive.delete(Number(pid));
			return true;
		});

		const stopped = await stopConnectorsForHubs(["ws://127.0.0.1:57648/hub"], {
			writeln: () => {},
			writeErr: () => {},
		});

		expect(stopped).toEqual({ stoppedProcesses: 1, queuedRestarts: 1 });
		expect(JSON.parse(readFileSync(queuePath, "utf8"))).toMatchObject([
			{
				connector: "telegram",
				targetHubUrl: "ws://127.0.0.1:57648/hub",
			},
		]);
	});
});
