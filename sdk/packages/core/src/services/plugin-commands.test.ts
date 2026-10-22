import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentExtensionApi,
	AgentTool,
	ITelemetryService,
	Message,
} from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProcessPluginRegistry } from "../extensions/plugin/plugin-registry";
import { writeGlobalSettings } from "./global-settings";
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
	vi.useRealTimers();
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
		failures: [] as Array<{
			pluginPath: string;
			phase: "setup";
			message: string;
		}>,
		warnings: [],
		issues: [],
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

	it("keeps healthy commands through a failure and retries the load after a delay", async () => {
		vi.useFakeTimers();
		const workspacePath = await workspace();
		const failing = loaded();
		failing.failures.push({
			pluginPath: join(workspacePath, "broken.js"),
			phase: "setup",
			message: "broken",
		});
		const load = vi
			.fn()
			.mockResolvedValueOnce(failing)
			.mockImplementation(async () => loaded());
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "error",
			error: "broken",
			commands: [{ name: "echo" }],
		});
		await manager.run({ workspacePath, prompt: "/echo" });
		expect(load).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "ready",
			commands: [{ name: "echo" }],
		});
		expect(load).toHaveBeenCalledTimes(2);
		expect(failing.shutdown).toHaveBeenCalledTimes(1);
	});

	it("re-imports a plugin whose import failed without touching the shared registry", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const workspacePath = await workspace();
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		const ready = join(workspacePath, "ready.txt");
		await writeFile(
			join(directory, "flaky.js"),
			`import {existsSync} from 'node:fs';
if (!existsSync(${JSON.stringify(ready)})) throw new Error('not ready');
export default {name:'flaky',manifest:{capabilities:['commands']},setup(api){api.registerCommand({name:'flaky',handler:()=>'ready'})}};`,
		);
		const manager = new PluginCommandManager();
		managers.push(manager);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "error",
			error: expect.stringContaining("not ready"),
			commands: [],
		});
		expect(getProcessPluginRegistry().list()).toEqual([]);
		await writeFile(ready, "ready");
		vi.setSystemTime(Date.now() + 30_000);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "ready",
			commands: [{ name: "flaky" }],
		});
		expect(
			await manager.run({ workspacePath, prompt: "/flaky" }),
		).toMatchObject({ reply: "ready" });
	});

	it("reloads when a plugin is disabled but not for unrelated settings", async () => {
		const workspacePath = await workspace();
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		const plugin = join(directory, "toggle.js");
		await writeFile(plugin, "export default {}");
		const load = vi.fn(async () => loaded());
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		await manager.list({ workspacePath });
		writeGlobalSettings({ tuiTheme: "dark" });
		await manager.list({ workspacePath });
		expect(load).toHaveBeenCalledTimes(1);
		writeGlobalSettings({ tuiTheme: "dark", disabledPlugins: [plugin] });
		await manager.list({ workspacePath });
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("rechecks imported helpers outside plugin directories", async () => {
		const workspacePath = await workspace();
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		const helper = join(workspacePath, "helpers.js");
		await writeFile(helper, "export const value='first';");
		await writeFile(
			join(directory, "command.js"),
			`import {value} from '../../helpers.js';
export default {name:'helper',manifest:{capabilities:['commands']},setup(api){api.registerCommand({name:'helper',description:value,handler:()=>value})}};`,
		);
		const manager = new PluginCommandManager();
		managers.push(manager);
		expect(
			await manager.run({ workspacePath, prompt: "/helper" }),
		).toMatchObject({ reply: "first" });
		await writeFile(helper, "export const value='later';");
		expect(await manager.list({ workspacePath })).toMatchObject({
			commands: [{ name: "helper", description: "later" }],
		});
		expect(
			await manager.run({ workspacePath, prompt: "/helper" }),
		).toMatchObject({ reply: "later" });
	});

	it("reloads edits made during initial catalog loading on the next request", async () => {
		const workspacePath = await workspace();
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		const plugin = join(directory, "command.js");
		await writeFile(plugin, "// original");
		const load = vi.fn(async () => {
			const contents = await readFile(plugin, "utf8");
			if (load.mock.calls.length === 1) await writeFile(plugin, "// changed");
			return loaded(async () => contents);
		});
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		await manager.list({ workspacePath });
		expect(await manager.run({ workspacePath, prompt: "/echo" })).toMatchObject(
			{ reply: "// changed" },
		);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("keeps setup output beside a plugin out of catalog invalidation", async () => {
		const workspacePath = await workspace();
		const directory = join(workspacePath, ".cline", "plugins");
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, "logging.js"),
			`import {appendFileSync} from 'node:fs';
export default {name:'logging',manifest:{capabilities:['commands']},setup(api){appendFileSync(new URL('./setup.log',import.meta.url),'setup\\n');let count=0;api.registerCommand({name:'counter',handler:()=>String(++count)})}};`,
		);
		const manager = new PluginCommandManager();
		managers.push(manager);
		expect(await manager.list({ workspacePath })).toMatchObject({
			status: "ready",
			commands: [{ name: "counter" }],
		});
		expect(
			await manager.run({ workspacePath, prompt: "/counter" }),
		).toMatchObject({ reply: "1" });
		await writeFile(join(directory, "state.json"), '{"count":1}');
		await manager.list({ workspacePath });
		expect(
			await manager.run({ workspacePath, prompt: "/counter" }),
		).toMatchObject({ reply: "2" });
		expect(await readFile(join(directory, "setup.log"), "utf8")).toBe(
			"setup\n",
		);
	});

	it("releases idle workspace catalogs and reloads them on demand", async () => {
		vi.useFakeTimers();
		const workspacePath = await workspace();
		const first = loaded();
		const load = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockImplementation(async () => loaded());
		const manager = new PluginCommandManager({ load });
		managers.push(manager);
		await manager.list({ workspacePath });
		await vi.advanceTimersByTimeAsync(9 * 60_000);
		await manager.list({ workspacePath });
		expect(first.shutdown).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(first.shutdown).toHaveBeenCalledTimes(1);
		await expect(
			manager.run({ workspacePath, prompt: "/echo again" }),
		).resolves.toMatchObject({ reply: "echo:again" });
		expect(load).toHaveBeenCalledTimes(2);
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

	it("preserves a successful command result when telemetry throws", async () => {
		const handler = vi.fn(() => "completed action");
		const telemetry = {
			capture: vi.fn(() => {
				throw new Error("telemetry failed");
			}),
		} as unknown as ITelemetryService;
		await expect(
			executePluginCommand([{ name: "action", handler }], "/action", {
				telemetry,
			}),
		).resolves.toEqual({ reply: "completed action", submitPrompt: undefined });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(telemetry.capture).toHaveBeenCalledTimes(1);
	});

	it("preserves the original handler failure when telemetry also throws", async () => {
		const failure = new Error("action failed");
		const handler = vi.fn(() => {
			throw failure;
		});
		const telemetry = {
			capture: vi.fn(() => {
				throw new Error("telemetry failed");
			}),
		} as unknown as ITelemetryService;
		await expect(
			executePluginCommand([{ name: "action", handler }], "/action", {
				telemetry,
			}),
		).rejects.toBe(failure);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(telemetry.capture).toHaveBeenCalledTimes(1);
	});
});
