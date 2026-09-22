import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPluginSlashCommand } from "./plugin-commands";

describe("runPluginSlashCommand", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function createWorkspaceWithPlugin(): Promise<string> {
		const workspacePath = await mkdtemp(
			join(tmpdir(), "desktop-plugin-commands-"),
		);
		tempRoots.push(workspacePath);
		const pluginsDir = join(workspacePath, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "goalish.js"),
			[
				"export default {",
				"  name: 'goalish-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'goalish',",
				"      handler: async (input) => {",
				"        const trimmed = input.trim();",
				"        if (!trimmed || trimmed === 'status') return 'No goal is active.';",
				"        return { reply: 'Goal set: ' + trimmed, submitPrompt: trimmed };",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);
		return workspacePath;
	}

	it("returns undefined when no plugin declares the command", async () => {
		const workspacePath = await createWorkspaceWithPlugin();
		await expect(
			runPluginSlashCommand({
				workspacePath,
				prompt: "/definitely-not-a-plugin-command hello",
			}),
		).resolves.toBeUndefined();
	});

	it("runs the handler and returns a reply-only result", async () => {
		const workspacePath = await createWorkspaceWithPlugin();
		await expect(
			runPluginSlashCommand({ workspacePath, prompt: "/goalish status" }),
		).resolves.toEqual({ reply: "No goal is active." });
	});

	it("passes the remainder to the handler and surfaces submitPrompt", async () => {
		const workspacePath = await createWorkspaceWithPlugin();
		await expect(
			runPluginSlashCommand({
				workspacePath,
				prompt: "/Goalish fix the failing tests",
			}),
		).resolves.toEqual({
			reply: "Goal set: fix the failing tests",
			submitPrompt: "fix the failing tests",
		});
	});
});
