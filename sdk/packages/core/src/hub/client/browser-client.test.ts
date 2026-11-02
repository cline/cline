import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import { createInMemoryHubOwnerContext } from "../discovery";
import { startHubWebSocketServer } from "../server/hub-websocket-server";
import { BrowserHubClient } from "./browser-client";
import { createHubMcpApi } from "./mcp";
import { createHubProvidersApi } from "./providers";
import { createHubProviderAuthApi } from "./provider-auth";
let root: string;
let server: Awaited<ReturnType<typeof startHubWebSocketServer>>;
let client: BrowserHubClient;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "hub-browser-"));
	vi.stubEnv("CLINE_DATA_DIR", root);
	vi.stubEnv("CLINE_MCP_SETTINGS_PATH", join(root, "settings", "mcp.json"));
	server = await startHubWebSocketServer({
		host: "127.0.0.1",
		port: 0,
		owner: createInMemoryHubOwnerContext("browser-test"),
		workspaceRoot: root,
		sessionHost: new LocalRuntimeHost({
			sessionService: new FileSessionService(join(root, "sessions")),
		}),
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
	});
	client = new BrowserHubClient(async () => ({
		url: server.url,
		authToken: server.authToken,
		workspaceRoot: root,
	}));
});
afterEach(async () => {
	await client.dispose();
	await server.close();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(root, { recursive: true, force: true });
});
describe("native browser Hub transport", () => {
	it("registers over the browser auth subprotocol and manages providers, account and MCP directly", async () => {
		const providers = createHubProvidersApi(client);
		await providers.saveSettings({
			providerId: "anthropic",
			apiKey: "test-only",
		});
		expect(
			(await providers.list()).providers.find((p) => p.id === "anthropic"),
		).toMatchObject({ apiKey: "test-only" });
		expect(
			await createHubProviderAuthApi(client).account({
				action: "clineAccount",
				operation: "fetchMe",
			}),
		).toMatchObject({ signedIn: false });
		const mcp = createHubMcpApi(client);
		await mcp.upsert({
			name: "remote",
			transportType: "streamableHttp",
			url: "https://example.test/mcp",
			disabled: true,
		});
		expect((await mcp.list()).servers).toEqual([
			expect.objectContaining({ name: "remote", disabled: true }),
		]);
		expect((await mcp.delete("remote")).servers).toEqual([]);
	});
	it("shares one registration for concurrent first commands", async () => {
		const bootstrap = vi.fn(async () => ({
			url: server.url,
			authToken: server.authToken,
			workspaceRoot: root,
		}));
		client = new BrowserHubClient(bootstrap);
		await Promise.all([
			createHubProvidersApi(client).list(),
			createHubMcpApi(client).list(),
		]);
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});
	it("rejects pending mutations on socket loss without replay and refreshes bootstrap for the next connection", async () => {
		class Socket extends EventTarget {
			static instances: Socket[] = [];
			readyState = 0;
			sent: string[] = [];
			constructor(
				readonly url: string,
				readonly protocols: string[],
			) {
				super();
				Socket.instances.push(this);
				queueMicrotask(() => {
					this.readyState = 1;
					this.dispatchEvent(new Event("open"));
				});
			}
			send(data: string) {
				this.sent.push(data);
				const { envelope } = JSON.parse(data);
				if (
					envelope.command === "client.register" ||
					envelope.command === "client.unregister"
				)
					queueMicrotask(() =>
						this.dispatchEvent(
							new MessageEvent("message", {
								data: JSON.stringify({
									kind: "reply",
									envelope: {
										version: "v1",
										requestId: envelope.requestId,
										ok: true,
									},
								}),
							}),
						),
					);
			}
			close() {
				this.readyState = 3;
				this.dispatchEvent(new Event("close"));
			}
		}
		vi.stubGlobal("WebSocket", Socket);
		let token = "first";
		const bootstrap = vi.fn(async () => ({
			url: "ws://localhost/hub",
			authToken: token,
			workspaceRoot: root,
		}));
		client = new BrowserHubClient(bootstrap);
		await client.connect();
		const pending = client.command("mcp.servers.delete", { name: "remote" });
		const rejected = expect(pending).rejects.toThrow("Hub connection closed");
		await vi.waitFor(() => expect(Socket.instances[0].sent).toHaveLength(2));
		Socket.instances[0].close();
		await rejected;
		token = "rotated";
		await client.connect();
		expect(bootstrap).toHaveBeenCalledTimes(2);
		expect(Socket.instances[1].protocols).toEqual(["cline-hub-auth.rotated"]);
		expect(
			Socket.instances[1].sent.map((data) => JSON.parse(data).envelope.command),
		).toEqual(["client.register"]);
	});
	it("does not open a socket when disposed during bootstrap", async () => {
		let resolve!: (value: {
			url: string;
			authToken: string;
			workspaceRoot: string;
		}) => void;
		client = new BrowserHubClient(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const rejected = expect(client.connect()).rejects.toThrow("disposed");
		await client.dispose();
		resolve({
			url: server.url,
			authToken: server.authToken,
			workspaceRoot: root,
		});
		await rejected;
	});
	it("rejects credentials embedded in URLs without exposing them in the error", async () => {
		client = new BrowserHubClient(async () => ({
			url: "ws://localhost/hub?token=secret",
			authToken: "secret",
			workspaceRoot: root,
		}));
		await expect(client.connect()).rejects.toThrow(
			/^Invalid Hub connection bootstrap$/,
		);
	});
});
