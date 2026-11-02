import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubReplyEnvelope } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import * as McpClient from "../../extensions/mcp/client";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { buildMcpServersResponse } from "../../services/mcp-management";
import { FileSessionService } from "../../session/services/file-session-service";
import { hasActiveHubSessions, NodeHubClient } from "../client";
import { createHubMcpApi } from "../client/mcp";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubServerTransport } from "./hub-server-transport";
import { startHubWebSocketServer } from "./hub-websocket-server";

let root: string;
let path: string;
let transport: HubServerTransport;
let stopped = false;
let api: ReturnType<typeof createHubMcpApi>;
const send = vi.fn();
const runtime = () => ({
	sessionHost: new LocalRuntimeHost({
		sessionService: new FileSessionService(join(root, "sessions")),
	}),
	runtimeHandlers: {
		startSession: vi.fn(),
		sendSession: vi.fn(),
		abortSession: vi.fn(),
		stopSession: vi.fn(),
	},
	eventLog: false as const,
	runQueue: false as const,
	sessionSearchOptions: { dbPath: ":memory:" },
});
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "hub-mcp-management-"));
	path = join(root, "settings", "cline_mcp_settings.json");
	vi.stubEnv("CLINE_DATA_DIR", root);
	vi.stubEnv("CLINE_MCP_SETTINGS_PATH", path);
	stopped = false;
	transport = new HubServerTransport({ ...runtime(), workspaceRoot: root });
	send.mockReset();
	send.mockImplementation((command, payload) =>
		transport.handleCommand({
			version: "v1",
			clientId: "test",
			command,
			payload,
		}),
	);
	api = createHubMcpApi({ command: send });
});
afterEach(async () => {
	if (!stopped) await transport.stop();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
async function seed(servers: Record<string, unknown>) {
	await mkdir(join(root, "settings"), { recursive: true });
	await writeFile(
		path,
		JSON.stringify({ mcpServers: servers, unrelated: "preserved" }),
	);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
describe("Hub MCP management", () => {
	it("uses the shared settings resolver and registers, disables, renames, and removes a stdio server", async () => {
		expect(await api.list()).toMatchObject({
			settingsPath: path,
			hasSettingsFile: false,
			servers: [],
		});
		expect(await api.ensureSettings()).toEqual({ settingsPath: path });
		expect(
			await api.upsert({
				name: "local",
				transportType: "stdio",
				command: "node",
				args: ["server.js"],
			}),
		).toMatchObject({
			servers: [{ name: "local", disabled: false, command: "node" }],
		});
		expect(await api.setDisabled("local", true)).toMatchObject({
			servers: [{ disabled: true }],
		});
		await api.upsert({
			name: "renamed",
			previousName: "local",
			transportType: "stdio",
			command: "node",
			disabled: true,
		});
		expect((await api.list()).servers.map((server) => server.name)).toEqual([
			"renamed",
		]);
		expect(await api.delete("renamed")).toMatchObject({ servers: [] });
		expect(send).toHaveBeenCalledWith(
			"mcp.servers.upsert",
			expect.any(Object),
			undefined,
			expect.objectContaining({ retryAfterDispatch: false }),
		);
	});
	it("keeps malformed entries independently editable without returning OAuth secrets", () => {
		const response = buildMcpServersResponse(path, {
			mcpServers: {
				linear: {
					command: "npx",
					args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"],
					disabled: true,
					oauth: {
						tokens: { access_token: "secret" },
						authorizationRequired: true,
						lastError: "Sign in required",
					},
				},
				broken: {},
			},
		});
		expect(response.servers[0]).toMatchObject({
			name: "linear",
			transportType: "streamableHttp",
			oauthStatus: { configured: true, authorizationRequired: false },
		});
		expect(response.servers[1]).toHaveProperty("configurationError");
		expect(JSON.stringify(response)).not.toContain("secret");
	});
	it("can disable and remove a malformed registration without connecting", async () => {
		await seed({ broken: {} });
		expect((await api.setDisabled("broken", true)).servers[0]).toMatchObject({
			name: "broken",
			disabled: true,
			configurationError: expect.any(String),
		});
		expect((await api.delete("broken")).servers).toEqual([]);
	});

	it("preserves OAuth and machine-managed metadata for the same endpoint and clears credentials on endpoint edits", async () => {
		await seed({
			remote: {
				transport: { type: "streamableHttp", url: "https://example.test/mcp" },
				disabled: false,
				timeout: 42,
				metadata: { pluginName: "test" },
				oauth: { tokens: { access_token: "secret" } },
				oauthClient: { clientId: "id" },
			},
			broken: {},
		});
		const probe = vi.spyOn(McpClient, "probeMcpServerConnection");
		await api.upsert({
			name: "remote",
			transportType: "streamableHttp",
			url: "https://example.test/mcp",
			metadata: { edited: true },
		});
		expect(probe).not.toHaveBeenCalled();
		let stored = JSON.parse(await readFile(path, "utf8"));
		expect(stored.mcpServers.remote).toMatchObject({
			timeout: 42,
			metadata: { edited: true },
			oauth: { tokens: { access_token: "secret" } },
		});
		await api.upsert({
			name: "remote",
			transportType: "streamableHttp",
			url: "https://other.test/mcp",
			disabled: true,
		});
		stored = JSON.parse(await readFile(path, "utf8"));
		expect(stored.mcpServers.remote.oauth).toBeUndefined();
		expect(stored.mcpServers.remote.oauthClient).toBeUndefined();
		expect(stored.mcpServers.remote.metadata).toEqual({ edited: true });
		expect(stored.unrelated).toBe("preserved");
		expect(stored.mcpServers.broken).toEqual({});
	});
	it("leaves remote servers disabled when a passive probe requires authorization", async () => {
		const probe = vi
			.spyOn(McpClient, "probeMcpServerConnection")
			.mockResolvedValue({
				serverName: "remote",
				connected: false,
				authorizationRequired: true,
			});
		const result = await api.upsert({
			name: "remote",
			transportType: "sse",
			url: "https://example.test/mcp",
		});
		expect(probe).toHaveBeenCalledWith({
			serverName: "remote",
			filePath: path,
		});
		expect(result.servers[0].disabled).toBe(true);
		probe.mockResolvedValue({
			serverName: "remote",
			connected: true,
			authorizationRequired: false,
		});
		expect((await api.setDisabled("remote", false)).servers[0].disabled).toBe(
			false,
		);
	});
	it("serializes an enable probe before a later disable and counts it as active work", async () => {
		await seed({
			remote: {
				transport: { type: "sse", url: "https://example.test/mcp" },
				disabled: true,
			},
		});
		const pending = deferred<McpClient.ProbeMcpServerConnectionResult>();
		const probe = vi
			.spyOn(McpClient, "probeMcpServerConnection")
			.mockReturnValue(pending.promise);
		const enabling = api.setDisabled("remote", false);
		await vi.waitFor(() => expect(probe).toHaveBeenCalled());
		const disabling = api.setDisabled("remote", true);
		const status = await transport.handleCommand({
			version: "v1",
			command: "session.list",
		});
		expect(status.payload?.activeMcpRequests).toBe(2);
		expect(hasActiveHubSessions(status.payload)).toBe(true);
		pending.resolve({
			serverName: "remote",
			connected: true,
			authorizationRequired: false,
		});
		await enabling;
		expect((await disabling).servers[0].disabled).toBe(true);
	});
	it("does not enable a replacement endpoint written while a probe is pending", async () => {
		await seed({
			remote: {
				transport: { type: "sse", url: "https://example.test/mcp" },
				disabled: true,
			},
		});
		const pending = deferred<McpClient.ProbeMcpServerConnectionResult>();
		const probe = vi
			.spyOn(McpClient, "probeMcpServerConnection")
			.mockReturnValue(pending.promise);
		const enabling = api.setDisabled("remote", false);
		await vi.waitFor(() => expect(probe).toHaveBeenCalled());
		await seed({
			remote: {
				transport: { type: "sse", url: "https://replacement.test/mcp" },
				disabled: true,
			},
		});
		pending.resolve({
			serverName: "remote",
			connected: true,
			authorizationRequired: false,
		});
		expect((await enabling).servers[0]).toMatchObject({
			url: "https://replacement.test/mcp",
			disabled: true,
		});
	});
	it("waits for accepted probes on shutdown and rejects new work during drain", async () => {
		await seed({
			remote: {
				transport: { type: "sse", url: "https://example.test/mcp" },
				disabled: true,
			},
		});
		const pending = deferred<McpClient.ProbeMcpServerConnectionResult>();
		const probe = vi
			.spyOn(McpClient, "probeMcpServerConnection")
			.mockReturnValue(pending.promise);
		const enabling = api.setDisabled("remote", false);
		await vi.waitFor(() => expect(probe).toHaveBeenCalled());
		await transport.handleCommand({ version: "v1", command: "hub.drain" });
		await expect(api.delete("remote")).rejects.toMatchObject({
			code: "hub_draining",
		});
		const onStop = vi.fn();
		const stopping = transport.stop().then(onStop);
		await Promise.resolve();
		expect(onStop).not.toHaveBeenCalled();
		pending.resolve({
			serverName: "remote",
			connected: true,
			authorizationRequired: false,
		});
		await enabling;
		await stopping;
		stopped = true;
	});
	it("discovers tools and always closes the inspection client", async () => {
		await seed({
			local: { transport: { type: "stdio", command: "node" }, disabled: true },
		});
		const client = {
			connect: vi.fn(),
			disconnect: vi.fn().mockResolvedValue(undefined),
			listTools: vi
				.fn()
				.mockResolvedValue([{ name: "test", inputSchema: { type: "object" } }]),
			callTool: vi.fn(),
		};
		vi.spyOn(McpClient, "createDefaultMcpServerClientFactory").mockReturnValue(
			() => client,
		);
		expect(await api.inspect("local")).toMatchObject({
			connected: true,
			tools: [{ name: "test" }],
		});
		client.listTools.mockRejectedValueOnce(new Error("failed discovery"));
		expect(await api.inspect("local")).toMatchObject({
			connected: false,
			error: "failed discovery",
		});
		expect(client.disconnect).toHaveBeenCalledTimes(2);
		expect((await api.list()).servers[0].disabled).toBe(true);
	});
	it("rejects invalid payloads and caller-chosen file paths before writing", async () => {
		await api.upsert({ name: "keep", transportType: "stdio", command: "node" });
		for (const payload of [
			{ name: "bad", transportType: "stdio", command: "" },
			{ name: "bad", transportType: "sse", url: "file:///tmp/secret" },
			{ name: "__proto__", transportType: "stdio", command: "node" },
			{
				name: "bad",
				transportType: "stdio",
				command: "node",
				settingsPath: "/tmp/other.json",
			},
		]) {
			expect(
				await transport.handleCommand({
					version: "v1",
					command: "mcp.servers.upsert",
					payload,
				}),
			).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
		}
		expect((await api.list()).servers.map((server) => server.name)).toEqual([
			"keep",
		]);
	});
	it("requires registration and token authority for configuration, credentials, and executable inspection", async () => {
		for (const command of [
			"mcp.servers.list",
			"mcp.servers.upsert",
			"mcp.servers.inspect",
		] as const) {
			expect(
				await transport.handleCommand({ version: "v1", command }, null),
			).toMatchObject({ ok: false, error: { code: "client_not_registered" } });
			expect(
				await transport.handleCommand(
					{ version: "v1", command },
					{ clientId: "browser", tokenAuthenticated: false },
				),
			).toMatchObject({
				ok: false,
				error: { code: "authentication_required" },
			});
		}
	});
	it("supports authenticated clients over WebSocket and rejects token-free loopback pages", async () => {
		const server = await startHubWebSocketServer({
			...runtime(),
			host: "127.0.0.1",
			port: 0,
			workspaceRoot: root,
			owner: createInMemoryHubOwnerContext("mcp-wire"),
		});
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "mcp-test",
		});
		const browser = new WebSocket(server.url, {
			origin: "http://localhost:3125",
		});
		try {
			await client.connect();
			const connected = createHubMcpApi(client);
			await connected.install(["local", "--", "node", "server.js"]);
			expect((await connected.list()).servers[0]).toMatchObject({
				name: "local",
				command: "node",
				args: ["server.js"],
			});
			await new Promise<void>((resolve, reject) => {
				if (browser.readyState === WebSocket.OPEN) resolve();
				else {
					browser.once("open", resolve);
					browser.once("error", reject);
				}
			});
			const reply = new Promise<HubReplyEnvelope>((resolve) =>
				browser.once("message", (data) =>
					resolve(JSON.parse(String(data)).envelope),
				),
			);
			browser.send(
				JSON.stringify({
					kind: "command",
					envelope: {
						version: "v1",
						requestId: "untrusted",
						command: "mcp.servers.list",
					},
				}),
			);
			expect(await reply).toMatchObject({
				ok: false,
				error: { code: "client_not_registered" },
			});
		} finally {
			browser.close();
			await client.dispose();
			await server.close();
		}
	});
});
