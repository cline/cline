import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NodeHubClient } from "../client";
import { HubPluginClient } from "../client/plugin-client";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";

let root: string;
let transport: HubServerTransport;
let client: HubPluginClient;
let stopped = false;

beforeEach(async () => {
	stopped = false;
	root = await mkdtemp(join(tmpdir(), "hub-plugin-commands-"));
	vi.stubEnv("CLINE_DIR", join(root, "global"));
	vi.stubEnv("CLINE_MCP_SETTINGS_PATH", join(root, "mcp.json"));
	transport = new HubServerTransport({
		workspaceRoot: root,
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		sessionSearchOptions: { dbPath: ":memory:" },
	});
	const connection = {
		command: async (command, payload) =>
			transport.handleCommand({
				version: "v1",
				requestId: "test",
				command,
				payload,
			}),
	} satisfies Pick<NodeHubClient, "command">;
	client = new HubPluginClient(connection);
});

afterEach(async () => {
	if (!stopped) await transport.stop();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

async function workspace(name: string): Promise<string> {
	const directory = join(root, name);
	const plugins = join(directory, ".cline", "plugins");
	await mkdir(plugins, { recursive: true });
	await writeFile(
		join(plugins, "command.ts"),
		`export default {
        name: "${name}", manifest: { capabilities: ["commands"] }, setup(api) {
            api.registerCommand({ name: "hello", handler: input => ({ reply: "${name}:" + input, submitPrompt: input }) });
            api.registerCommand({ name: "fail", handler: () => { throw new Error("handler failed"); } });
        }
    };`,
	);
	return directory;
}

it("discovers and executes plugins in the Hub with isolated workspace services", async () => {
	const first = await workspace("first");
	const second = await workspace("second");
	expect(await client.listCommands(first)).toContainEqual({
		name: "hello",
		description: undefined,
	});
	expect(await client.runCommand(first, "/HELLO", " one ")).toEqual({
		reply: "first:one",
		submitPrompt: "one",
	});
	expect(await client.runCommand(second, "hello", "two")).toEqual({
		reply: "second:two",
		submitPrompt: "two",
	});
	expect(await client.runCommand(first, "missing", "")).toBeUndefined();
	await expect(client.runCommand(first, "fail", "")).rejects.toThrow(
		"handler failed",
	);
	// A changed source refreshes the Hub-owned service, without restarting the client.
	await writeFile(
		join(first, ".cline/plugins/command.ts"),
		`export default { name: "changed", manifest: { capabilities: ["commands"] }, setup(api) { api.registerCommand({ name: "updated", handler: () => "updated" }); } };`,
	);
	expect(await client.listCommands(first)).toEqual([
		{ name: "updated", description: undefined },
	]);
});

it("installs plugins and loads their MCP contributions on the Hub host", async () => {
	const source = join(root, "mcp-plugin.ts");
	await writeFile(
		source,
		`export default { name: "mcp-plugin", manifest: { capabilities: ["mcp"] }, setup(api) { api.registerMcpServer({ name: "docs", transport: { type: "streamableHttp", url: "https://example.com/mcp" } }); } };`,
	);
	const result = await client.install({ source });
	expect(result.installPath).toContain(join(root, "global", "plugins"));
	expect(result.mcpSyncFailures).toEqual([]);
	const settings = JSON.parse(await readFile(join(root, "mcp.json"), "utf8"));
	expect(settings.mcpServers.docs.transport).toMatchObject({
		url: "https://example.com/mcp",
	});
});

it("rejects malformed input and refuses new plugin work while draining", async () => {
	const invalid = await transport.handleCommand({
		version: "v1",
		requestId: "invalid",
		command: "plugins.commands.run",
		payload: { workspaceRoot: root, name: 42, input: "" },
	});
	expect(invalid.ok).toBe(false);
	expect(invalid.error?.message).toContain("name and string input");
	await transport.handleCommand({
		version: "v1",
		requestId: "drain",
		command: "hub.drain",
	});
	await expect(client.listCommands(root)).rejects.toThrow("draining");
});

it("finishes an active command before shutting down its plugin service", async () => {
	const directory = await workspace("shutdown");
	await writeFile(
		join(directory, ".cline/plugins/command.ts"),
		`export default { name: "finish", manifest: { capabilities: ["commands"] }, setup(api) { api.registerCommand({ name: "finish", handler: async () => { await new Promise(resolve => setTimeout(resolve, 50)); return "finished"; } }); } };`,
	);
	await client.listCommands(directory);
	const running = client.runCommand(directory, "finish", "");
	await transport.stop();
	stopped = true;
	expect(await running).toEqual({ reply: "finished", submitPrompt: undefined });
	await expect(client.listCommands(directory)).rejects.toThrow(
		"Hub is stopping",
	);
});
