import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, ITelemetryService } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { splitCoreSessionConfig } from "../../runtime/host/runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import { HubCommandError } from "../client";
import { createHubPluginCommandsApi } from "../client/plugin-commands";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";

let root: string;
let runtime: LocalRuntimeHost;
let transport: HubServerTransport;
let transportStopped = false;
const capture = vi.fn();
const telemetry = {
	capture,
	captureRequired: vi.fn(),
	setDistinctId: vi.fn(),
	updateCommonProperties: vi.fn(),
} as unknown as ITelemetryService;
const originalClineDir = process.env.CLINE_DIR;
const originalHome = process.env.HOME;
beforeEach(async () => {
	transportStopped = false;
	capture.mockClear();
	root = await mkdtemp(join(tmpdir(), "hub-plugin-command-test-"));
	setHomeDir(root);
	setClineDir(join(root, ".cline"));
	runtime = new LocalRuntimeHost({
		sessionService: new FileSessionService(join(root, "sessions")),
		telemetry,
	});
	transport = new HubServerTransport({
		sessionHost: runtime,
		workspaceRoot: root,
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
	const directory = join(root, ".cline", "plugins");
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "counter.js"),
		`import {appendFileSync} from 'node:fs';
 export default {name:'counter',manifest:{capabilities:['commands']},setup(api,ctx){
 appendFileSync(${JSON.stringify(join(root, "setups.txt"))}, (ctx.session?.sessionId ?? 'workspace')+'\\n');
 let counter=0;
 api.registerCommand({name:'counter',handler:input=>({reply:(ctx.session?.sessionId ?? 'workspace')+':'+(++counter)+':'+input})});
 }};`,
	);
});
afterEach(async () => {
	if (!transportStopped) await transport?.stop();
	setHomeDir(originalHome ?? "~");
	setClineDir(originalClineDir ?? join(originalHome ?? "~", ".cline"));
	await rm(root, { recursive: true, force: true });
});
function command(
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown>,
	sessionId?: string,
) {
	return transport.handleCommand({
		version: "v1",
		requestId: Math.random().toString(),
		clientId: "test",
		command,
		payload,
		sessionId,
	});
}
describe("hub-owned plugin commands", () => {
	it("records workspace command usage once through direct and RPC execution", async () => {
		const target = { workspacePath: root };
		await runtime.pluginCommands.run({ ...target, prompt: "/counter direct" });
		await command("plugins.commands.run", {
			...target,
			prompt: "/counter rpc",
		});
		await runtime.pluginCommands.run({ ...target, prompt: "/unmatched" });
		const events = capture.mock.calls
			.map(([event]) => event)
			.filter((event) => event.event === "task.tool_used");
		expect(events).toHaveLength(2);
		for (const event of events)
			expect(event.properties).toMatchObject({
				tool: "plugin_command:counter",
				success: true,
				ulid: expect.any(String),
			});
	});

	it("records failed plugin handlers without changing their error", async () => {
		await writeFile(
			join(root, ".cline", "plugins", "failure.js"),
			`export default {name:'failure',manifest:{capabilities:['commands']},setup(api){api.registerCommand({name:'fail',handler(){throw new Error('handler failed')}})}}`,
		);
		await expect(
			runtime.pluginCommands.run({ workspacePath: root, prompt: "/fail" }),
		).rejects.toThrow("handler failed");
		const events = capture.mock.calls
			.map(([event]) => event)
			.filter((event) => event.event === "task.tool_used");
		expect(events).toHaveLength(1);
		expect(events[0].properties).toMatchObject({
			tool: "plugin_command:fail",
			success: false,
		});
	});
	it("protects active commands from drain, replacement, and shutdown without a chat participant", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run = vi
			.spyOn(runtime.pluginCommands, "run")
			.mockImplementation(async () => {
				await gate;
				return { reply: "finished" };
			});
		const pending = command("plugins.commands.run", {
			workspacePath: root,
			prompt: "/slow",
		});
		await vi.waitFor(() => expect(run).toHaveBeenCalled());
		expect((await command("hub.status", {})).payload).toMatchObject({
			idle: false,
			activePluginRequests: 1,
		});
		expect((await command("session.list", {})).payload).toMatchObject({
			activePluginRequests: 1,
		});
		await command("hub.drain", {});
		expect(
			await command("plugins.commands.list", { workspacePath: root }),
		).toMatchObject({ ok: false, error: { code: "hub_draining" } });
		let stopped = false;
		const stop = transport.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		release();
		expect(await pending).toMatchObject({
			ok: true,
			payload: { result: { reply: "finished" } },
		});
		await stop;
		transportStopped = true;
		expect(stopped).toBe(true);
	});

	it("keeps healthy commands available while a sibling plugin fails", async () => {
		const broken = join(root, ".cline", "plugins", "broken.js");
		await writeFile(
			broken,
			`export default {name:'broken',manifest:{capabilities:['commands']},setup(){throw new Error('broken setup');}};`,
		);
		const catalog = await runtime.pluginCommands.list({ workspacePath: root });
		expect(catalog).toMatchObject({
			status: "error",
			commands: [{ name: "counter" }],
			error: expect.stringContaining("broken setup"),
		});
		expect(
			await runtime.pluginCommands.run({
				workspacePath: root,
				prompt: "/counter healthy",
			}),
		).toMatchObject({ reply: "workspace:1:healthy" });
		await rm(broken);
		expect(
			await runtime.pluginCommands.list({ workspacePath: root }),
		).toMatchObject({ status: "ready", commands: [{ name: "counter" }] });
	});
	it("serves newly added commands through the shared client API", async () => {
		const api = createHubPluginCommandsApi({
			command: (name, payload, sessionId) =>
				command(name, payload ?? {}, sessionId),
		});
		await api.list({ workspacePath: root });
		await writeFile(
			join(root, ".cline", "plugins", "extra.js"),
			`export default {name:'extra',manifest:{capabilities:['commands']},setup(api){api.registerCommand({name:'extra',handler:()=> 'new command'});}};`,
		);
		expect((await api.list({ workspacePath: root })).commands).toEqual(
			expect.arrayContaining([{ name: "extra" }]),
		);
		expect(await api.run({ workspacePath: root, prompt: "/extra" })).toEqual({
			reply: "new command",
			submitPrompt: undefined,
		});
	});
	it("treats a Hub without plugin command RPCs as having no plugin commands", async () => {
		const api = createHubPluginCommandsApi({
			command: async (name) => {
				throw new HubCommandError(
					name,
					"unsupported_command",
					`Unsupported hub schedule command: ${name}`,
				);
			},
		});
		expect(await api.list({ workspacePath: root })).toEqual({
			workspacePath: root,
			status: "ready",
			commands: [],
		});
		expect(
			await api.run({ workspacePath: root, prompt: "/counter" }),
		).toBeUndefined();
	});
	it("shares a workspace sandbox across client requests and preserves arguments", async () => {
		const first = await command("plugins.commands.list", {
			workspacePath: root,
		});
		const second = await command("plugins.commands.list", {
			workspacePath: root,
		});
		expect(first.payload).toEqual(second.payload);
		expect(first.payload?.catalog).toMatchObject({
			status: "ready",
			commands: [{ name: "counter" }],
		});
		expect(
			(
				await command("plugins.commands.run", {
					workspacePath: root,
					prompt: "/counter a  b\nc",
				})
			).payload?.result,
		).toMatchObject({ reply: "workspace:1:a  b\nc" });
		expect(
			(
				await command("plugins.commands.run", {
					workspacePath: root,
					prompt: "/counter again",
				})
			).payload?.result,
		).toMatchObject({ reply: "workspace:2:again" });
		expect((await readFile(join(root, "setups.txt"), "utf8")).trim()).toBe(
			"workspace",
		);
	});
	it("runs workspace commands for a session the runtime does not have", async () => {
		const target = { workspacePath: root, sessionId: "sess_missing" };
		expect((await runtime.pluginCommands.list(target)).commands).toEqual([
			{ name: "counter" },
		]);
		expect(
			await runtime.pluginCommands.run({ ...target, prompt: "/counter x" }),
		).toMatchObject({ reply: "workspace:1:x" });
		expect(
			await command(
				"plugins.commands.run",
				{ ...target, prompt: "/counter rpc" },
				target.sessionId,
			),
		).toMatchObject({
			ok: true,
			payload: { result: { reply: "workspace:2:rpc" } },
		});
		expect(
			await runtime.pluginCommands.run({ ...target, prompt: "/unknown" }),
		).toBeUndefined();
	});
	it("executes against the existing session plugin instance and retains its setup context", async () => {
		const session = await runtime.startSession({
			...splitCoreSessionConfig({
				cwd: root,
				workspaceRoot: root,
				providerId: "openai-native",
				modelId: "gpt-4o-mini",
				apiKey: "test",
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			}),
			interactive: true,
		});
		const target = { workspacePath: root };
		const catalog = await command(
			"plugins.commands.list",
			target,
			session.sessionId,
		);
		expect(catalog.payload?.catalog).toMatchObject({
			sessionId: session.sessionId,
			commands: [{ name: "counter" }],
		});
		const result = await command(
			"plugins.commands.run",
			{ ...target, prompt: "/counter test" },
			session.sessionId,
		);
		expect(result.payload?.result).toMatchObject({
			reply: `${session.sessionId}:1:test`,
		});
		await runtime.pluginCommands.run({
			...target,
			sessionId: session.sessionId,
			prompt: "/counter direct",
		});
		const events = capture.mock.calls
			.map(([event]) => event)
			.filter((event) => event.event === "task.tool_used");
		expect(events).toHaveLength(2);
		for (const event of events)
			expect(event.properties).toMatchObject({
				ulid: session.sessionId,
				tool: "plugin_command:counter",
				success: true,
				provider: "openai-native",
				modelId: "gpt-4o-mini",
				agentId: expect.any(String),
			});
		expect((await readFile(join(root, "setups.txt"), "utf8")).trim()).toBe(
			session.sessionId,
		);
	});
	it("exposes session plugin commands loaded in subprocess mode", async () => {
		const previousMode = process.env.CLINE_PLUGIN_MODE;
		process.env.CLINE_PLUGIN_MODE = "sandbox";
		try {
			const session = await runtime.startSession({
				...splitCoreSessionConfig({
					cwd: root,
					workspaceRoot: root,
					providerId: "openai-native",
					modelId: "gpt-4o-mini",
					apiKey: "test",
					systemPrompt: "test",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				}),
				interactive: true,
			});
			const target = { workspacePath: root, sessionId: session.sessionId };
			expect((await runtime.pluginCommands.list(target)).commands).toEqual([
				{ name: "counter" },
			]);
			expect(
				await runtime.pluginCommands.run({ ...target, prompt: "/counter x" }),
			).toMatchObject({ reply: `${session.sessionId}:1:x` });
		} finally {
			if (previousMode === undefined) delete process.env.CLINE_PLUGIN_MODE;
			else process.env.CLINE_PLUGIN_MODE = previousMode;
		}
	});
	it("does not expose session skills as plugin commands", async () => {
		const skill = join(root, ".cline", "skills", "hello-skill");
		await mkdir(skill, { recursive: true });
		await writeFile(
			join(skill, "SKILL.md"),
			"---\nname: hello-skill\ndescription: Says hello\n---\nGreet the user.\n",
		);
		const session = await runtime.startSession({
			...splitCoreSessionConfig({
				cwd: root,
				workspaceRoot: root,
				providerId: "openai-native",
				modelId: "gpt-4o-mini",
				apiKey: "test",
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			}),
			interactive: true,
		});
		const target = { workspacePath: root, sessionId: session.sessionId };
		expect((await runtime.pluginCommands.list(target)).commands).toEqual([
			{ name: "counter" },
		]);
		expect(
			await runtime.pluginCommands.run({ ...target, prompt: "/hello-skill x" }),
		).toBeUndefined();
	});
	it("rejects a workspace outside the authenticated connection scope", async () => {
		await expect(
			transport.handleCommand(
				{
					version: "v1",
					clientId: "limited",
					command: "plugins.commands.list",
					payload: { workspacePath: root },
				},
				{
					clientId: "limited",
					workspaceContext: { workspaceRoot: join(root, "other") },
				},
			),
		).rejects.toThrow("authority");
	});
	it("rejects an unregistered remote connection regardless of workspace", async () => {
		await expect(
			transport.handleCommand(
				{
					version: "v1",
					clientId: "unregistered",
					command: "plugins.commands.run",
					payload: { workspacePath: root, prompt: "/counter" },
				},
				null,
			),
		).rejects.toThrow("Hub-authorized workspace");
	});
});
