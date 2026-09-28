import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	type RemoteHelperDependencies,
	runRemoteHelperEntrypoint,
} from "./remote-helper";

function createDependencies(
	overrides: Partial<RemoteHelperDependencies> = {},
): {
	dependencies: RemoteHelperDependencies;
	output: string[];
} {
	const output: string[] = [];
	return {
		output,
		dependencies: {
			readHubDiscovery: vi.fn(async () => undefined),
			clearHubDiscoveryIfOwned: vi.fn(async () => true),
			probeProcess: vi.fn(),
			requestHubShutdown: vi.fn(async () => true),
			ensureDetachedHubServer: vi.fn(async () => ({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "desktop-owner-token",
			})),
			claimHubDaemonProcess: vi.fn(() => false),
			loadHubDaemon: vi.fn(async () => undefined),
			ensureLoginShellPath: vi.fn(async () => ({
				status: "skipped" as const,
				reason: "test",
			})),
			setHomeDirIfUnset: vi.fn(),
			homeDir: () => "/home/pi",
			cwd: () => "/home/pi",
			env: {},
			writeOutput: (value) => output.push(value),
			...overrides,
		},
	};
}

describe("remote helper entrypoint", () => {
	it("imports the built public helper without executing its CLI", () => {
		const result = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const before = process.exitCode; const helper = await import('@cline/core/remote/helper'); if (process.exitCode !== before || typeof helper.runRemoteHelperEntrypoint !== 'function') throw new Error('Import side effect'); console.log('imported');`,
			],
			{
				cwd: fileURLToPath(new URL("../../", import.meta.url)),
				encoding: "utf8",
			},
		);
		expect(result.trim()).toBe("imported");
	});

	it("starts only the explicitly owned desktop Hub discovery record", async () => {
		const { dependencies, output } = createDependencies();
		const discoveryPath = "/home/pi/.cline/data/remote/desktop-hub.json";

		await expect(
			runRemoteHelperEntrypoint(
				[
					"code-sidecar",
					"--remote-hub-ensure",
					"--cwd",
					"/home/pi",
					"--discovery-path",
					discoveryPath,
				],
				dependencies,
			),
		).resolves.toBe(true);

		expect(dependencies.env.CLINE_HUB_DISCOVERY_PATH).toBe(discoveryPath);
		expect(dependencies.ensureDetachedHubServer).toHaveBeenCalledWith(
			"/home/pi",
			{
				host: "127.0.0.1",
				port: 0,
				pathname: "/hub",
				allowPortFallback: true,
				manageConnectors: false,
			},
		);
		expect(JSON.parse(output.join(""))).toMatchObject({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "desktop-owner-token",
			cwd: "/home/pi",
		});
	});

	it("refuses bootstrap without an explicit discovery owner", async () => {
		const { dependencies } = createDependencies();
		await expect(
			runRemoteHelperEntrypoint(
				["code-sidecar", "--remote-hub-ensure"],
				dependencies,
			),
		).rejects.toThrow("--discovery-path is required");
	});

	it("stops only the explicitly owned Hub using its authentication token", async () => {
		const discoveryPath = "/home/pi/.cline/data/remote/owned.json";
		const { dependencies } = createDependencies({
			readHubDiscovery: vi.fn(
				async () =>
					({
						url: "ws://127.0.0.1:1234/hub",
						authToken: "owner-token",
					}) as Awaited<
						ReturnType<RemoteHelperDependencies["readHubDiscovery"]>
					>,
			),
		});
		await expect(
			runRemoteHelperEntrypoint(
				["helper", "--remote-hub-stop", "--discovery-path", discoveryPath],
				dependencies,
			),
		).resolves.toBe(true);
		expect(dependencies.readHubDiscovery).toHaveBeenCalledWith(discoveryPath);
		expect(dependencies.requestHubShutdown).toHaveBeenCalledWith(
			"ws://127.0.0.1:1234/hub",
			"owner-token",
		);
	});
	it.each([
		"dead",
		"alive",
		"denied",
	])("handles %s Hub processes during cleanup", async (state) => {
		const discoveryPath = "/home/pi/.cline/data/remote/owned.json";
		const { dependencies } = createDependencies({
			readHubDiscovery: vi.fn(
				async () =>
					({
						hubId: "owned-hub",
						pid: 1234,
						url: "ws://127.0.0.1:1234/hub",
						authToken: "owner-token",
					}) as Awaited<
						ReturnType<RemoteHelperDependencies["readHubDiscovery"]>
					>,
			),
			probeProcess: vi.fn(() => {
				if (state !== "alive")
					throw Object.assign(new Error(state), {
						code: state === "dead" ? "ESRCH" : "EPERM",
					});
			}),
			requestHubShutdown: vi.fn(async () => {
				throw new Error("Connection refused");
			}),
		});
		const result = runRemoteHelperEntrypoint(
			["helper", "--remote-hub-stop", "--discovery-path", discoveryPath],
			dependencies,
		);
		if (state === "dead") {
			await expect(result).resolves.toBe(true);
			expect(dependencies.clearHubDiscoveryIfOwned).toHaveBeenCalledWith(
				discoveryPath,
				"owned-hub",
			);
			expect(dependencies.requestHubShutdown).not.toHaveBeenCalled();
		} else {
			await expect(result).rejects.toThrow("Connection refused");
			expect(dependencies.clearHubDiscoveryIfOwned).not.toHaveBeenCalled();
		}
	});

	it("refuses shutdown without an explicit discovery owner", async () => {
		const { dependencies } = createDependencies();
		await expect(
			runRemoteHelperEntrypoint(["helper", "--remote-hub-stop"], dependencies),
		).rejects.toThrow("--discovery-path is required");
		expect(dependencies.readHubDiscovery).not.toHaveBeenCalled();
	});

	it("hosts the detached daemon when the one-shot sentinel is claimed", async () => {
		const loadHubDaemon = vi.fn(async () => undefined);
		const { dependencies } = createDependencies({
			claimHubDaemonProcess: () => true,
			loadHubDaemon,
		});

		await expect(
			runRemoteHelperEntrypoint(["code-sidecar"], dependencies),
		).resolves.toBe(true);
		expect(loadHubDaemon).toHaveBeenCalledOnce();
	});
});
