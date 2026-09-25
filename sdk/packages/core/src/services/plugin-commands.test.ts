import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExtensionApi, AgentTool, Message } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePluginCommand, parsePluginCommand } from "./plugin-command-api";
import { PluginCommandManager } from "./plugin-commands";

const originalHome = process.env.HOME;
const originalClineDir = process.env.CLINE_DIR;
const roots: string[] = [];
beforeEach(async () => {
	const home = await workspace();
	setHomeDir(home);
	setClineDir(join(home, ".cline"));
});
const managers: PluginCommandManager[] = [];
afterEach(async () => {
	await Promise.all(managers.splice(0).map((m) => m.dispose()));
	setHomeDir(originalHome ?? "~");
	setClineDir(originalClineDir ?? join(originalHome ?? "~", ".cline"));
	await Promise.all(
		roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
	);
});
async function workspace() {
	const p = await mkdtemp(join(tmpdir(), "plugin-catalog-"));
	roots.push(p);
	return p;
}
function loaded(
	handler: (input: string) => Promise<string> = async (input) =>
		`echo:${input}`,
) {
	return {
		extensions: [
			{
				name: "echo-plugin",
				manifest: { capabilities: ["commands" as const] },
				setup(api: AgentExtensionApi<AgentTool, Message[]>) {
					api.registerCommand({ name: "Echo", description: "Echo", handler });
				},
			},
		],
		pluginPaths: [],
		failures: [],
		warnings: [],
		shutdown: vi.fn(async () => {}),
	};
}
describe("runtime plugin catalogs", () => {
	it("shares initialization across callers and preserves arguments", async () => {
		const workspacePath = await workspace();
		const load = vi.fn(async () => loaded());
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		const [a, b] = await Promise.all([
			manager.list({ workspacePath }),
			manager.list({ workspacePath }),
		]);
		expect(a).toEqual(b);
		expect(load).toHaveBeenCalledTimes(1);
		expect(a.commands).toEqual([{ name: "echo", description: "Echo" }]);
		await expect(
			manager.run({
				workspacePath,
				prompt: "/Echo first  line\n  second line",
			}),
		).resolves.toMatchObject({ reply: "echo:first  line\n  second line" });
		await expect(
			manager.run({ workspacePath, prompt: "/unknown" }),
		).resolves.toBeUndefined();
	});
	it("retries only failed paths while retaining healthy command state", async () => {
		const workspacePath = await workspace();
		const brokenPath = join(workspacePath, "broken.js");
		const failures = [
			{ pluginPath: brokenPath, phase: "setup" as const, message: "broken" },
		];
		let counter = 0;
		let recover = false;
		const healthy = loaded(async () => String(++counter));
		const recovered = loaded();
		recovered.extensions[0].setup = (api) =>
			api.registerCommand({ name: "fixed", handler: () => "recovered" });
		const load = vi.fn(async (_options: { pluginPaths: string[] }) => {
			if (load.mock.calls.length === 1) return { ...healthy, failures };
			return recover ? recovered : { ...loaded(), extensions: [], failures };
		});
		const manager = new PluginCommandManager({ load, retryDelayMs: 10 });
		managers.push(manager);
		const updates = vi.fn();
		manager.subscribe(updates);
		await manager.list({ workspacePath });
		expect(await manager.run({ workspacePath, prompt: "/echo" })).toMatchObject(
			{ reply: "1" },
		);
		await vi.waitFor(
			() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(3),
			{ timeout: 5000 },
		);
		expect(healthy.shutdown).not.toHaveBeenCalled();
		expect(await manager.run({ workspacePath, prompt: "/echo" })).toMatchObject(
			{ reply: "2" },
		);
		for (const [options] of load.mock.calls.slice(1))
			expect(options.pluginPaths).toEqual([brokenPath]);
		recover = true;
		await vi.waitFor(
			() =>
				expect(updates).toHaveBeenLastCalledWith(
					expect.objectContaining({ status: "ready" }),
				),
			{ timeout: 5000 },
		);
		expect(
			await manager.run({ workspacePath, prompt: "/fixed" }),
		).toMatchObject({ reply: "recovered" });
		expect(await manager.run({ workspacePath, prompt: "/echo" })).toMatchObject(
			{ reply: "3" },
		);
		expect(healthy.shutdown).not.toHaveBeenCalled();
	});
	it("recovers from initialization timeout without another client request", async () => {
		const workspacePath = await workspace();
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error("plugin-sandbox initialize timed out"))
			.mockResolvedValue(loaded());
		const manager = new PluginCommandManager({ load, retryDelayMs: 10 });
		managers.push(manager);
		const updates = vi.fn();
		manager.subscribe(updates);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "error",
			commands: [],
			error: expect.stringContaining("timed out"),
		});
		await vi.waitFor(
			() =>
				expect(updates).toHaveBeenLastCalledWith(
					expect.objectContaining({
						status: "ready",
						commands: [{ name: "echo", description: "Echo" }],
					}),
				),
			{ timeout: 5000 },
		);
		await expect(
			manager.run({ workspacePath, prompt: "/echo recovered" }),
		).resolves.toMatchObject({ reply: "echo:recovered" });
	});
	it("watches newly created plugin directories in non-Git workspaces", async () => {
		const workspacePath = await workspace();
		const load = vi.fn(async () => loaded());
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		await manager.list({ workspacePath });
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "echo.js"), "export default {};");
		await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1), {
			timeout: 3000,
		});
		const calls = load.mock.calls.length;
		await writeFile(
			join(directory, "echo.js"),
			"export default {name:'changed'};",
		);
		await vi.waitFor(
			() => expect(load.mock.calls.length).toBeGreaterThan(calls),
			{ timeout: 3000 },
		);
	});
	it("waits for active handlers before disposing the sandbox", async () => {
		const workspacePath = await workspace();
		let finish!: (result: string) => void;
		const handler = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		const plugins = loaded(handler);
		const manager = new PluginCommandManager({ load: async () => plugins });
		managers.push(manager);
		await manager.list({ workspacePath });
		const run = manager.run({ workspacePath, prompt: "/echo" });
		await vi.waitFor(() => expect(handler).toHaveBeenCalled());
		const dispose = manager.dispose();
		expect(plugins.shutdown).not.toHaveBeenCalled();
		finish("done");
		await run;
		await dispose;
		expect(plugins.shutdown).toHaveBeenCalledTimes(1);
		await expect(manager.list({ workspacePath })).rejects.toThrow("disposed");
	});
	it("isolates workspaces and propagates handler errors", async () => {
		const a = await workspace();
		const b = await workspace();
		const load = vi.fn(async (options?: { cwd?: string }) =>
			loaded(async () => options?.cwd ?? ""),
		);
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		await manager.list({ workspacePath: a });
		await manager.list({ workspacePath: b });
		expect(load).toHaveBeenCalledTimes(2);
		await expect(
			manager.run({ workspacePath: a, prompt: "/echo" }),
		).resolves.toMatchObject({ reply: a });
		await expect(
			executePluginCommand(
				[
					{
						name: "bad",
						handler: () => {
							throw new Error("handler boom");
						},
					},
				],
				"/bad",
			),
		).rejects.toThrow("handler boom");
	});
	it("parses slash input without changing internal whitespace", () => {
		expect(parsePluginCommand(" \n/GOAL a  b\nc ")).toEqual({
			name: "goal",
			input: "a  b\nc",
		});
		expect(parsePluginCommand("ordinary text")).toBeUndefined();
	});
});
