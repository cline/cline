import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync, mockGetRpcServerHealth } = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
	mockGetRpcServerHealth: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

vi.mock("@clinebot/core", () => ({
	resolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
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
	afterEach(() => {
		vi.clearAllMocks();
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
						"50174 /Users/beatrix/.bun/bin/bun /Users/beatrix/dev/clinee/sdk-wip/apps/cli/src/index.ts rpc start --address 127.0.0.1:4317",
						"50181 /Users/beatrix/.bun/bin/bun /Users/beatrix/dev/clinee/sdk-wip/apps/cli/src/index.ts hook-worker",
						"50190 /Users/beatrix/.bun/bin/bun /Users/beatrix/dev/clinee/sdk-wip/apps/cli/src/index.ts hey",
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
						staleCliPids: [],
						hookWorkerPids: [],
					}
				: {
						listeningPids: [50174],
						staleCliPids: [50190],
						hookWorkerPids: [50181],
					},
		);
	});
});
