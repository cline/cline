import { describe, expect, it, vi } from "vitest";
import { adoptDesktopCliRuntime, ensureHubWithDesktopCli } from "./cli-runtime";

describe("ensureHubWithDesktopCli", () => {
	it("asks the installed CLI to start or reuse the Hub and returns only its URL", async () => {
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
				env: { PATH: "/usr/bin", CLINE_NO_AUTO_UPDATE: "1" },
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
	it("routes Hub spawns through the installed CLI and restores the workspace cwd", () => {
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

	it("keeps the default Hub launcher when no installed CLI is provided", () => {
		const chdir = vi.fn();
		const setLauncher = vi.fn();

		expect(adoptDesktopCliRuntime({ env: {}, chdir, setLauncher })).toEqual({
			cliPath: undefined,
		});
		expect(chdir).not.toHaveBeenCalled();
		expect(setLauncher).not.toHaveBeenCalled();
	});
});
