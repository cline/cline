import { describe, expect, it, vi } from "vitest";

const { mockProbeHubServer, mockSpawnSync } = vi.hoisted(() => ({
	mockProbeHubServer: vi.fn(
		async (_url: string, _options?: unknown) => undefined as unknown,
	),
	mockSpawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: mockSpawnSync }));
vi.mock("../discovery", () => ({
	createHubServerUrl: (host: string, port: number, pathname: string) =>
		`ws://${host}:${port}${pathname}`,
	probeHubServer: mockProbeHubServer,
}));

import {
	describeAddressInUse,
	parseLsofListeners,
	parseNetstatListeners,
	parseSsListeners,
} from "./bind-diagnostics";

describe("bind diagnostics parsers", () => {
	it("parses netstat listeners on the requested port only", () => {
		const output = [
			"  Proto  Local Address          Foreign Address        State           PID",
			"  TCP    127.0.0.1:25463        0.0.0.0:0              LISTENING       1234",
			"  TCP    [::1]:25463            [::]:0                 LISTENING       1234",
			"  TCP    127.0.0.1:254630       0.0.0.0:0              LISTENING       999",
			"  TCP    127.0.0.1:25463        127.0.0.1:50000        ESTABLISHED     4321",
			"  UDP    0.0.0.0:25463          *:*                                    777",
		].join("\r\n");
		expect(parseNetstatListeners(output, 25463)).toEqual([1234]);
	});

	it("parses lsof field output", () => {
		expect(parseLsofListeners("p1234\nccline\np5678\ncnode\n")).toEqual([
			{ pid: 1234, command: "cline" },
			{ pid: 5678, command: "node" },
		]);
	});

	it("parses ss process annotations", () => {
		expect(
			parseSsListeners(
				'LISTEN 0 511 127.0.0.1:25463 0.0.0.0:* users:(("cline",pid=1234,fd=21))\n',
			),
		).toEqual([{ pid: 1234, command: "cline" }]);
	});
});

describe("describeAddressInUse", () => {
	it("reports the port owner, lock state, and whether the occupant is a Hub", async () => {
		const commandLine = "/Users/alice/.cline/bin/cline --cline-hub-daemon\n";
		mockSpawnSync.mockImplementation((command: string) => {
			switch (command) {
				case "lsof":
					return { status: 0, stdout: "p4242\nccline\n" };
				case "netstat":
					return {
						status: 0,
						stdout:
							"  TCP    127.0.0.1:25463   0.0.0.0:0   LISTENING   4242\r\n",
					};
				case "ps":
				case "powershell":
					return { status: 0, stdout: commandLine };
				default:
					return { status: 1, stdout: "" };
			}
		});
		mockProbeHubServer.mockResolvedValueOnce({
			protocolVersion: "1",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			buildId: "old-build",
			coreVersion: "3.0.1",
			pid: 4242,
		});
		const error = Object.assign(new Error("listen EADDRINUSE"), {
			code: "EADDRINUSE",
			errno: -48,
			syscall: "listen",
			hubInstanceLockHeld: true,
		});

		const context = await describeAddressInUse(error, {
			host: "127.0.0.1",
			port: 25463,
			pathname: "/hub",
		});

		expect(context).toMatchObject({
			bind_host: "127.0.0.1",
			bind_port: 25463,
			error_errno: -48,
			error_syscall: "listen",
			instance_lock_held: true,
			port_owner_pids: "4242",
			port_owner_commands:
				"4242: /Users/[redacted]/.cline/bin/cline --cline-hub-daemon",
			occupant_is_hub: true,
			occupant_hub_build_id: "old-build",
			occupant_hub_core_version: "3.0.1",
			occupant_hub_pid: 4242,
		});
		expect(mockProbeHubServer).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			{
				signal: expect.any(AbortSignal),
			},
		);
	});

	it("degrades to an unavailable lookup when no tool responds", async () => {
		mockSpawnSync.mockReturnValue({ error: new Error("ENOENT"), status: null });
		mockProbeHubServer.mockResolvedValueOnce(undefined);

		const context = await describeAddressInUse(new Error("busy"), {
			host: "127.0.0.1",
			port: 25463,
			pathname: "/hub",
		});

		expect(context).toMatchObject({
			port_owner_lookup:
				process.platform === "win32" ? "netstat_unavailable" : "unavailable",
			port_owner_pids: "",
			occupant_is_hub: false,
		});
	});
});
