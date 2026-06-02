import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceChatCommandHost } from "./plugin-chat-commands";

describe("plugin chat commands", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};

	afterEach(async () => {
		restoreEnv("CLINE_DIR", envSnapshot.CLINE_DIR);
		restoreEnv(
			"CLINE_GLOBAL_SETTINGS_PATH",
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH,
		);
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	function restoreEnv(name: string, value: string | undefined): void {
		if (value === undefined) {
			delete process.env[name];
			return;
		}
		process.env[name] = value;
	}

	function isolateGlobalPlugins(tempRoot: string): void {
		process.env.CLINE_DIR = join(tempRoot, ".cline-global");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
	}

	it("returns a callable shutdown when no plugin commands are loaded", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "cli-plugin-commands-empty-"),
		);
		tempRoots.push(tempRoot);
		isolateGlobalPlugins(tempRoot);

		const { pluginSlashCommands, shutdown } =
			await createWorkspaceChatCommandHost({
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			});

		expect(pluginSlashCommands).toEqual([]);
		await expect(shutdown()).resolves.toBeUndefined();
	});

	it("bridges plugin extension commands onto the chat command host", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-commands-"));
		tempRoots.push(tempRoot);
		isolateGlobalPlugins(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "echo.js"),
			[
				"export default {",
				"  name: 'echo-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'echo',",
				"      description: 'Echo input',",
				"      handler: async (input) => 'echo:' + input",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);

		const { host, pluginSlashCommands, shutdown } =
			await createWorkspaceChatCommandHost({
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			});
		const reply = vi.fn(async () => undefined);

		// Filter to only our test plugin to ignore any discovered system plugins
		const testCommands = pluginSlashCommands.filter(
			(cmd) => cmd.name === "echo",
		);
		expect(testCommands).toEqual([{ name: "echo", description: "Echo input" }]);

		const handled = await host.handle("/echo hello plugin", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("echo:hello plugin");
		await shutdown();
	});
});
