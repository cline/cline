import { describe, expect, it, vi } from "vitest";
import {
	adoptDesktopCliRuntime,
	configureDesktopPluginRuntime,
	ensureHubWithDesktopCli,
} from "./cli-runtime";

describe("ensureHubWithDesktopCli", () => {
	it("asks the bundled CLI to start or reuse the Hub and returns only its URL", async () => {
		const run = vi.fn(
			async () =>
				'warming up\n{"url":"ws://127.0.0.1:25463/hub","authToken":"secret","cwd":"/work"}\n',
		);

		await expect(
			ensureHubWithDesktopCli("/opt/cline/cline-cli", "/work", {
				env: { PATH: "/usr/bin" },
				run,
			}),
		).resolves.toEqual({ url: "ws://127.0.0.1:25463/hub" });
		expect(run).toHaveBeenCalledWith(
			"/opt/cline/cline-cli",
			["hub", "ensure", "--json", "--cwd", "/work"],
			{
				cwd: "/work",
				env: {
					PATH: "/usr/bin",
					CLINE_NO_AUTO_UPDATE: "1",
					CLINE_HUB_LAUNCHER_CLIENT: "cline-desktop",
					CLINE_HUB_LAUNCHER_VERSION: expect.stringMatching(/^\d+\.\d+\.\d+/),
					CLINE_HUB_LAUNCHER_TRANSPORT: "local",
				},
				timeoutMs: 60_000,
			},
		);
	});

	it("rejects when the CLI does not report a Hub URL", async () => {
		await expect(
			ensureHubWithDesktopCli("/opt/cline/cline-cli", "/work", {
				env: {},
				run: async () => "",
			}),
		).rejects.toThrow("did not report a Hub URL");
	});
});

describe("adoptDesktopCliRuntime", () => {
	it("routes Hub spawns through the bundled CLI and restores the workspace cwd", () => {
		const env: NodeJS.ProcessEnv = {
			BUN_BE_BUN: "1",
			CLINE_DESKTOP_CLI_PATH:
				"/Applications/Cline.app/Contents/MacOS/cline-cli",
			CLINE_DESKTOP_WORKSPACE_ROOT: "/Users/dev/project",
		};
		const chdir = vi.fn();
		const setLauncher = vi.fn();

		expect(adoptDesktopCliRuntime({ env, chdir, setLauncher })).toEqual({
			cliPath: "/Applications/Cline.app/Contents/MacOS/cline-cli",
		});

		expect(env.BUN_BE_BUN).toBeUndefined();
		expect(env.CLINE_DESKTOP_WORKSPACE_ROOT).toBeUndefined();
		expect(env.CLINE_DESKTOP_CLI_PATH).toBe(
			"/Applications/Cline.app/Contents/MacOS/cline-cli",
		);
		expect(chdir).toHaveBeenCalledWith("/Users/dev/project");
		expect(setLauncher).toHaveBeenCalledWith({
			command: "/Applications/Cline.app/Contents/MacOS/cline-cli",
		});
	});

	it("keeps the default Hub launcher when no bundled CLI is provided", () => {
		const chdir = vi.fn();
		const setLauncher = vi.fn();

		expect(adoptDesktopCliRuntime({ env: {}, chdir, setLauncher })).toEqual({
			cliPath: undefined,
		});
		expect(chdir).not.toHaveBeenCalled();
		expect(setLauncher).not.toHaveBeenCalled();
	});
});

describe("configureDesktopPluginRuntime", () => {
	it("asks the matching executable for its runtime rather than treating it as a script runner", async () => {
		const env = { BUN_BE_BUN: "1" };
		const run = vi.fn(async () => "/cache/plugins/build-id\n");
		await configureDesktopPluginRuntime("/opt/cline/cline-cli", { env, run });
		expect(env).toMatchObject({
			CLINE_PLUGIN_RUNTIME_DIR: "/cache/plugins/build-id",
		});
		expect(run).toHaveBeenCalledWith(
			"/opt/cline/cline-cli",
			["--plugin-runtime-dir"],
			expect.objectContaining({
				env: expect.objectContaining({
					BUN_BE_BUN: undefined,
					CLINE_NO_AUTO_UPDATE: "1",
				}),
			}),
		);
	});
	it("rejects a CLI that does not report its runtime", async () => {
		await expect(
			configureDesktopPluginRuntime("/opt/cline/cline-cli", {
				env: {},
				run: async () => "",
			}),
		).rejects.toThrow("plugin runtime directory");
	});
});
