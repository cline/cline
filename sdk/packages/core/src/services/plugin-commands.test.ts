import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginCommandService } from "./plugin-commands";

describe("createPluginCommandService", () => {
	const tempRoots: string[] = [];
	const shutdowns: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(shutdowns.map((shutdown) => shutdown()));
		shutdowns.length = 0;
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function createWorkspace(): Promise<{
		workspacePath: string;
		pluginPath: string;
	}> {
		const workspacePath = await mkdtemp(join(tmpdir(), "plugin-commands-"));
		tempRoots.push(workspacePath);
		const pluginsDir = join(workspacePath, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const pluginPath = join(pluginsDir, "goalish.js");
		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'goalish-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'Goalish',",
				"      description: 'Set a goal',",
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
		return { workspacePath, pluginPath };
	}

	it("lists normalized commands and runs handlers", async () => {
		const { workspacePath } = await createWorkspace();
		const service = createPluginCommandService({ cwd: workspacePath });
		shutdowns.push(service.shutdown);

		const commands = await service.listCommands();
		expect(commands).toContainEqual({
			name: "goalish",
			description: "Set a goal",
		});
		await expect(service.run("/Goalish", " status ")).resolves.toEqual({
			reply: "No goal is active.",
			submitPrompt: undefined,
		});
		await expect(service.run("goalish", "fix the tests")).resolves.toEqual({
			reply: "Goal set: fix the tests",
			submitPrompt: "fix the tests",
		});
		await expect(service.run("not-a-command", "")).resolves.toBeUndefined();
	});

	it("continues without commands when a plugin fails to load, retrying only when plugins change", async () => {
		const { workspacePath, pluginPath } = await createWorkspace();
		await writeFile(
			pluginPath,
			"export default { name: 'broken', manifest: { capabilities: ['bogus'] }, setup() {} };",
		);
		const errors: string[] = [];
		const service = createPluginCommandService({
			cwd: workspacePath,
			logger: {
				debug: () => {},
				log: () => {},
				error: (message) => errors.push(message),
			},
		});
		shutdowns.push(service.shutdown);

		await expect(service.listCommands()).resolves.toEqual([]);
		await expect(service.run("goalish", "status")).resolves.toBeUndefined();
		expect(errors).toHaveLength(1);

		// The failure may have been transient, so it is retried after a delay.
		const realNow = Date.now;
		const nowSpy = vi
			.spyOn(Date, "now")
			.mockImplementation(() => realNow() + 60_000);
		try {
			await expect(service.run("goalish", "status")).resolves.toBeUndefined();
			expect(errors).toHaveLength(2);
		} finally {
			nowSpy.mockRestore();
		}

		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'goalish-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({ name: 'goalish', handler: () => { throw new Error('handler boom'); } });",
				"  },",
				"};",
			].join("\n"),
		);
		const later = new Date(Date.now() + 5_000);
		await utimes(pluginPath, later, later);

		// Handler failures are the plugin's own errors and still surface.
		await expect(service.run("goalish", "status")).rejects.toThrow(
			"handler boom",
		);
	});

	it("reloads plugins when the plugin set changes", async () => {
		const { workspacePath, pluginPath } = await createWorkspace();
		const service = createPluginCommandService({ cwd: workspacePath });
		shutdowns.push(service.shutdown);
		await expect(service.run("goalish", "status")).resolves.toEqual({
			reply: "No goal is active.",
			submitPrompt: undefined,
		});

		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'goalish-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({ name: 'goalish', handler: () => 'reloaded' });",
				"  },",
				"};",
			].join("\n"),
		);
		const later = new Date(Date.now() + 5_000);
		await utimes(pluginPath, later, later);

		await expect(service.run("goalish", "status")).resolves.toEqual({
			reply: "reloaded",
			submitPrompt: undefined,
		});
	});
});
