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
