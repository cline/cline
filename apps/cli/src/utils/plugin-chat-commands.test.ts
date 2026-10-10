import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClineCore } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceChatCommandHost } from "./plugin-chat-commands";

describe("plugin chat commands", () => {
	const tempRoots: string[] = [];
	const cores: ClineCore[] = [];

	afterEach(async () => {
		await Promise.all(cores.splice(0).map((core) => core.dispose()));
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

		const core = await ClineCore.create({ backendMode: "local" });
		cores.push(core);
		const { host, listCommands } = await createWorkspaceChatCommandHost({
			commands: core.pluginCommands,
			cwd: tempRoot,
			workspaceRoot: tempRoot,
		});
		const reply = vi.fn(async () => undefined);

		// Filter to only our test plugin to ignore any discovered system plugins
		const testCommands = (await listCommands()).filter(
			(cmd) => cmd.name === "echo",
		);
		expect(testCommands).toEqual([{ name: "echo", description: "Echo input" }]);

		const handled = await host.handle("/echo hello  plugin\nnext line", {
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
		expect(reply).toHaveBeenCalledWith("echo:hello  plugin\nnext line");
	});

	it("bridges plugin command submit prompts onto the chat command context", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-commands-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "submit.js"),
			[
				"export default {",
				"  name: 'submit-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'goal',",
				"      description: 'Set a goal and submit it',",
				"      handler: async (input) => ({",
				"        reply: 'goal:' + input,",
				"        submitPrompt: input",
				"      })",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);

		const core = await ClineCore.create({ backendMode: "local" });
		cores.push(core);
		const { host } = await createWorkspaceChatCommandHost({
			commands: core.pluginCommands,
			cwd: tempRoot,
			workspaceRoot: tempRoot,
		});
		const reply = vi.fn(async () => undefined);
		const submitPrompt = vi.fn(async () => undefined);

		const handled = await host.handle("/goal fix tests", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
			submitPrompt,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("goal:fix tests");
		expect(submitPrompt).toHaveBeenCalledWith("fix tests");
	});
});
