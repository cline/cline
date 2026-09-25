import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	isRemoteHubCommand,
	REMOTE_HUB_COMMAND_VERSION,
	type RemoteHubCommandDependencies,
	runRemoteHubCommand,
} from "./remote-hub-command";

function createDependencies(
	overrides: Partial<RemoteHubCommandDependencies> = {},
): {
	dependencies: RemoteHubCommandDependencies;
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
			resolveDefaultHubDiscoveryPath: () =>
				"/home/pi/.cline/data/locks/hub/production.json",
			ensureLoginShellPath: vi.fn(async () => ({
				status: "skipped" as const,
				reason: "test",
			})),
			resolveHubBuildIdentity: () => ({
				buildId: "build-a",
				buildEpochMs: 1,
				coreVersion: "0.0.85",
			}),
			setHomeDirIfUnset: vi.fn(),
			homeDir: () => "/home/pi",
			cwd: () => "/home/pi",
			env: {},
			writeOutput: (value) => output.push(value),
			...overrides,
		},
	};
}

describe("remote Hub commands", () => {
	it("imports the built public Hub commands without executing its CLI", () => {
		const result = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const before = process.exitCode; const commands = await import('@cline/core/remote/hub-command'); if (process.exitCode !== before || typeof commands.runRemoteHubCommand !== 'function') throw new Error('Import side effect'); console.log('imported');`,
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
			runRemoteHubCommand(
				[
					"cline",
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
			coreVersion: "0.0.85",
			protocolVersion: "v1",
			remoteHubCommandVersion: REMOTE_HUB_COMMAND_VERSION,
		});
	});

	it("reports Hub identity without starting a Hub", async () => {
		const { dependencies, output } = createDependencies();
		await expect(
			runRemoteHubCommand(["cline", "--remote-hub-info"], dependencies),
		).resolves.toBe(true);
		expect(dependencies.ensureDetachedHubServer).not.toHaveBeenCalled();
		expect(dependencies.ensureLoginShellPath).not.toHaveBeenCalled();
		expect(JSON.parse(output.join(""))).toEqual({
			remoteHubCommandVersion: REMOTE_HUB_COMMAND_VERSION,
			protocolVersion: "v1",
			minClientProtocolVersion: "v1",
			maxClientProtocolVersion: "v1",
			buildId: "build-a",
			buildEpochMs: 1,
			coreVersion: "0.0.85",
			platform: process.platform,
			arch: process.arch,
		});
	});

	it("recognizes only the remote Hub command flags", async () => {
		expect(isRemoteHubCommand(["cline", "--remote-hub-ensure"])).toBe(true);
		expect(isRemoteHubCommand(["cline", "--version"])).toBe(false);
		const { dependencies } = createDependencies();
		await expect(
			runRemoteHubCommand(["cline", "hello"], dependencies),
		).resolves.toBe(false);
	});

	it("refuses bootstrap without an explicit discovery owner", async () => {
		const { dependencies } = createDependencies();
		await expect(
			runRemoteHubCommand(["cline", "--remote-hub-ensure"], dependencies),
		).rejects.toThrow("--discovery-path is required");
	});

	it("refuses the default CLI Hub owner path for ensure and stop", async () => {
		const { dependencies } = createDependencies();
		const defaultPath = dependencies.resolveDefaultHubDiscoveryPath();
		const equivalentPath = defaultPath.replace(
			"production.json",
			"./production.json",
		);
		for (const path of [defaultPath, equivalentPath]) {
			for (const command of ["--remote-hub-ensure", "--remote-hub-stop"]) {
				await expect(
					runRemoteHubCommand(
						["cline", command, "--discovery-path", path],
						dependencies,
					),
				).rejects.toThrow("cannot use the default CLI Hub discovery path");
			}
		}
		expect(dependencies.ensureDetachedHubServer).not.toHaveBeenCalled();
		expect(dependencies.readHubDiscovery).not.toHaveBeenCalled();
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
						ReturnType<RemoteHubCommandDependencies["readHubDiscovery"]>
					>,
			),
		});
		await expect(
			runRemoteHubCommand(
				["cline", "--remote-hub-stop", "--discovery-path", discoveryPath],
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
						ReturnType<RemoteHubCommandDependencies["readHubDiscovery"]>
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
		const result = runRemoteHubCommand(
			["cline", "--remote-hub-stop", "--discovery-path", discoveryPath],
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
			runRemoteHubCommand(["cline", "--remote-hub-stop"], dependencies),
		).rejects.toThrow("--discovery-path is required");
		expect(dependencies.readHubDiscovery).not.toHaveBeenCalled();
	});
});
