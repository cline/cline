import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClineCore, type PluginCommandsApi } from "@cline/core";
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

	it.each([
		"/skill explain",
		"/workflow run",
	])("lets %s reach instruction expansion when plugin discovery fails", async (prompt) => {
		const commands: PluginCommandsApi = {
			list: vi.fn().mockRejectedValue(new Error("hub unavailable")),
			run: vi.fn().mockRejectedValue(new Error("must not execute")),
		};
		const logger = { log: vi.fn(), debug: vi.fn() };
		const { host } = await createWorkspaceChatCommandHost({
			commands,
			cwd: "/tmp/project",
			logger,
		});
		const handled = await host.handle(prompt, {
			enabled: true,
			getState: () => ({
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: false,
				autoApproveTools: false,
			}),
			setState: vi.fn(),
			reply: vi.fn(),
		});
		expect(handled).toBe(false);
		expect(commands.run).not.toHaveBeenCalled();
		expect(logger.log).toHaveBeenCalled();
	});

	it("does not execute commands absent from a partial catalog", async () => {
		const commands: PluginCommandsApi = {
			list: vi.fn().mockResolvedValue({
				status: "error",
				commands: [{ name: "echo" }],
				error: "sibling failed",
			}),
			run: vi.fn(),
		};
		const { host } = await createWorkspaceChatCommandHost({
			commands,
			cwd: "/tmp/project",
		});
		expect(
			await host.handle("/workflow run", {
				enabled: true,
				getState: () => ({
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: false,
					autoApproveTools: false,
				}),
				setState: vi.fn(),
				reply: vi.fn(),
			}),
		).toBe(false);
		expect(commands.run).not.toHaveBeenCalled();
	});

	it("preserves execution errors for a command owned by a healthy plugin", async () => {
		const commands: PluginCommandsApi = {
			list: vi.fn().mockResolvedValue({
				status: "error",
				commands: [{ name: "echo" }],
				error: "sibling failed",
			}),
			run: vi.fn().mockRejectedValue(new Error("handler failed")),
		};
		const { host } = await createWorkspaceChatCommandHost({
			commands,
			cwd: "/tmp/project",
		});
		await expect(
			host.handle("/echo input", {
				enabled: true,
				getState: () => ({
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: false,
					autoApproveTools: false,
				}),
				setState: vi.fn(),
				reply: vi.fn(),
			}),
		).rejects.toThrow("handler failed");
		expect(commands.run).toHaveBeenCalledTimes(1);
	});
});
