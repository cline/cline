import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceChatCommandHost } from "./plugin-chat-commands";

describe("plugin chat commands", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("bridges plugin extension commands onto the chat command host", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-commands-"));
		tempRoots.push(tempRoot);
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

		const { host, pluginSlashCommands } = await createWorkspaceChatCommandHost({
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
	});
});
