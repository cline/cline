import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { splitCoreSessionConfig } from "../../runtime/host/runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import { createHubPluginCommandsApi } from "../client/plugin-commands";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";

let root: string;
let runtime: LocalRuntimeHost;
let transport: HubServerTransport;
const originalClineDir = process.env.CLINE_DIR;
const originalHome = process.env.HOME;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "hub-plugin-command-test-"));
	setHomeDir(root);
	setClineDir(join(root, ".cline"));
	runtime = new LocalRuntimeHost({
		sessionService: new FileSessionService(join(root, "sessions")),
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
	await transport?.stop();
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
		const updates = vi.fn();
		const stop = runtime.pluginCommands.subscribe(updates);
		await rm(broken);
		await vi.waitFor(
			() =>
				expect(updates).toHaveBeenLastCalledWith(
					expect.objectContaining({
						status: "ready",
						commands: [{ name: "counter" }],
					}),
				),
			{ timeout: 5000 },
		);
		stop();
	});
	it("delivers invalidations and current commands through the shared client API", async () => {
		const api = createHubPluginCommandsApi({
			command: (name, payload, sessionId) =>
				command(name, payload ?? {}, sessionId),
			subscribe: (listener) => transport.subscribe("observer", listener),
		});
		const updates = vi.fn();
		const stop = api.subscribe(updates);
		await api.list({ workspacePath: root });
		await writeFile(
			join(root, ".cline", "plugins", "extra.js"),
			`export default {name:'extra',manifest:{capabilities:['commands']},setup(api){api.registerCommand({name:'extra',handler:()=> 'new command'});}};`,
		);
		await vi.waitFor(
			() =>
				expect(updates).toHaveBeenLastCalledWith(
					expect.objectContaining({
						commands: expect.arrayContaining([{ name: "extra" }]),
					}),
				),
			{ timeout: 5000 },
		);
		expect(await api.run({ workspacePath: root, prompt: "/extra" })).toEqual({
			reply: "new command",
			submitPrompt: undefined,
		});
		stop();
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
		expect((await readFile(join(root, "setups.txt"), "utf8")).trim()).toBe(
			session.sessionId,
		);
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
});
