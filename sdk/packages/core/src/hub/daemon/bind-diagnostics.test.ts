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

import { describeAddressInUse, parseLsofOwners } from "./bind-diagnostics";

const endpoint = { host: "127.0.0.1", port: 25463, pathname: "/hub" };

describe("describeAddressInUse", () => {
	it("pairs lsof pids with their command names", () => {
		expect(parseLsofOwners("p1234\nccline\np5678\ncnode\n")).toEqual([
			"1234\tcline",
			"5678\tnode",
		]);
	});

	it("reports the port owner, lock state, and whether the occupant is a Hub", async () => {
		mockSpawnSync.mockReturnValue({
			status: 0,
			stderr: "",
			stdout:
				process.platform === "win32"
					? "4242\tcline.exe C:\\Users\\alice\\cline.exe\r\n"
					: "p4242\nc/Users/alice/cline\n",
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
			hubInstanceLockHeld: true,
		});

		const context = await describeAddressInUse(error, endpoint);

		expect(context).toMatchObject({
			bind_port: 25463,
			instance_lock_held: true,
			port_owners: expect.stringMatching(/^4242\t.*\[redacted\]/),
			occupant_is_hub: true,
			occupant_hub_build_id: "old-build",
			occupant_hub_core_version: "3.0.1",
			occupant_hub_pid: 4242,
		});
		expect(context.port_owners).not.toContain("alice");
		expect(mockProbeHubServer).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			{ signal: expect.any(AbortSignal) },
		);
	});

	it("degrades when the lookup tool is missing and nothing answers the probe", async () => {
		mockSpawnSync.mockReturnValue({ error: new Error("ENOENT"), status: null });
		mockProbeHubServer.mockResolvedValueOnce(undefined);

		const context = await describeAddressInUse(new Error("busy"), endpoint);

		expect(context).toMatchObject({
			port_owners: "unavailable",
			occupant_is_hub: false,
		});
		expect(context).not.toHaveProperty("occupant_hub_build_id");
	});

	it("tells a lookup that failed apart from one that found no listener", async () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 1,
			stdout: "",
			stderr: "Get-NetTCPConnection : The term is not recognized",
		});
		expect(
			(await describeAddressInUse(new Error("busy"), endpoint)).port_owners,
		).toBe("unavailable");

		mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: "", stderr: "" });
		expect(
			(await describeAddressInUse(new Error("busy"), endpoint)).port_owners,
		).toBe("");
	});
});
