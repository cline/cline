import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubReplyEnvelope } from "@cline/shared";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateMcpServerOAuthStateAsync } from "../../extensions/mcp/config-loader";
import * as McpOAuth from "../../extensions/mcp/oauth";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import { NodeHubClient } from "../client";
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
const remote = {
	transport: {
		type: "streamableHttp" as const,
		url: "https://example.test/mcp",
	},
	disabled: true,
};
const success = {
	serverName: "remote",
	authorized: true as const,
	message: "authorized",
};
function awaitAbort(signal?: AbortSignal) {
	return new Promise<never>((_, reject) => {
		if (signal?.aborted) reject(signal.reason);
		else
			signal?.addEventListener("abort", () => reject(signal.reason), {
				once: true,
			});
	});
}
describe("Hub-owned MCP OAuth", () => {
	it("does not open browser URLs from a cancelled terminal snapshot", async () => {
		const client = {
			command: vi.fn(async (command: string) => ({
				version: "v1" as const,
				ok: true,
				payload:
					command === "mcp.oauth.next"
						? {
								urls: ["https://stale.test/auth"],
								error: { code: "mcp_oauth_cancelled", message: "cancelled" },
							}
						: { servers: [] },
			})),
		};
		const openUrl = vi.fn();
		await createHubMcpApi(client).authorize("remote", { openUrl });
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("delivers browser URLs only to the initiating client and enables on completion", async () => {
		await seed({ remote });
		vi.spyOn(McpOAuth, "authorizeMcpServerOAuth").mockImplementation(
			async (options) => {
				await options.openUrl?.("https://example.test/auth?state=private");
				return success;
			},
		);
		const openUrl = vi.fn();
		expect(
			(await api.authorize("remote", { openUrl })).servers[0].disabled,
		).toBe(false);
		expect(openUrl).toHaveBeenCalledWith(
			"https://example.test/auth?state=private",
		);
	});
	it.each([
		"disable",
		"delete",
		"edit",
		"install",
	] as const)("cancels OAuth before a %s mutation and never re-enables a late completion", async (action) => {
		await seed({ remote });
		const pending = deferred<typeof success>();
		let signal: AbortSignal | undefined;
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockImplementation(async (options) => {
				signal = options.signal;
				return pending.promise;
			});
		const login = api.authorize("remote", { openUrl: vi.fn() });
		await vi.waitFor(() => expect(auth).toHaveBeenCalled());
		if (action === "disable") await api.setDisabled("remote", true);
		if (action === "delete") await api.delete("remote");
		if (action === "edit")
			await api.upsert({
				name: "remote",
				transportType: "streamableHttp",
				url: "https://other.test/mcp",
				disabled: true,
			});
		if (action === "install") await api.install(["remote", "--", "node"]);
		expect(signal?.aborted).toBe(true);
		pending.resolve(success);
		const result = await login;
		if (action === "delete") expect(result.servers).toEqual([]);
		else if (action === "install")
			expect(result.servers[0]).toMatchObject({ transportType: "stdio" });
		else expect(result.servers[0].disabled).toBe(true);
	});
	it("does not let a late user cancel override a server-disable cancellation", async () => {
		await seed({ remote: { ...remote, disabled: false } });
		const pending = deferred<typeof success>();
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockReturnValue(pending.promise);
		await send("mcp.oauth.start", { name: "remote", loginId: "late-cancel" });
		await vi.waitFor(() => expect(auth).toHaveBeenCalled());
		await api.setDisabled("remote", true);
		expect(
			(
				await send("mcp.oauth.cancel", {
					loginId: "late-cancel",
					reason: "user",
				})
			).payload,
		).toEqual({ cancelled: false });
		pending.resolve(success);
		const snapshot = await send("mcp.oauth.next", { loginId: "late-cancel" });
		expect(snapshot.payload?.error).toBeDefined();
		expect((await api.list()).servers[0].disabled).toBe(true);
	});
	it("waits for a superseded authorization to clean up before starting the next", async () => {
		await seed({ remote });
		const closed = vi.fn();
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockImplementationOnce(async (options) => {
				try {
					await awaitAbort(options.signal);
					return success;
				} finally {
					closed();
				}
			})
			.mockImplementationOnce(async () => {
				expect(closed).toHaveBeenCalled();
				return success;
			});
		const first = api.authorize("remote", { openUrl: vi.fn() });
		await vi.waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
		const second = api.authorize("remote", { openUrl: vi.fn() });
		await Promise.all([first, second]);
		expect(auth).toHaveBeenCalledTimes(2);
		expect((await api.list()).servers[0].disabled).toBe(false);
	});
	it("requires registration and token authentication for every OAuth command", async () => {
		for (const command of [
			"mcp.oauth.start",
			"mcp.oauth.next",
			"mcp.oauth.cancel",
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

	it.each([
		false,
		true,
	])("restores the original enabled state only for user cancellation (disabled=%s)", async (disabled) => {
		await seed({ remote: { ...remote, disabled } });
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockImplementation((options) => awaitAbort(options.signal));
		const controller = new AbortController();
		const login = api.authorize("remote", {
			openUrl: vi.fn(),
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(auth).toHaveBeenCalled());
		controller.abort();
		expect((await login).servers[0].disabled).toBe(disabled);
	});
	it("rejects cross-client polls/cancellation and unregistered unregister attacks", async () => {
		await seed({ remote });
		vi.spyOn(McpOAuth, "authorizeMcpServerOAuth").mockImplementation(
			(options) => awaitAbort(options.signal),
		);
		await send("mcp.oauth.start", { name: "remote", loginId: "private" });
		for (const command of ["mcp.oauth.next", "mcp.oauth.cancel"] as const)
			expect(
				await transport.handleCommand({
					version: "v1",
					clientId: "other",
					command,
					payload: {
						loginId: "private",
						...(command === "mcp.oauth.cancel" ? { reason: "user" } : {}),
					},
				}),
			).toMatchObject({ ok: false });
		expect(
			await transport.handleCommand(
				{ version: "v1", clientId: "test", command: "client.unregister" },
				null,
			),
		).toMatchObject({ ok: false, error: { code: "client_not_registered" } });
		expect(
			await transport.handleCommand(
				{ version: "v1", clientId: "test", command: "client.unregister" },
				{ clientId: "other" },
			),
		).toMatchObject({
			ok: false,
			error: { code: "client_authority_mismatch" },
		});
	});
	it("aborts when its client unregisters or the hub shuts down", async () => {
		await seed({ remote });
		const signals: AbortSignal[] = [];
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockImplementation((options) => {
				if (!options.signal) throw new Error("Missing abort signal");
				signals.push(options.signal);
				return awaitAbort(options.signal);
			});
		await send("mcp.oauth.start", { name: "remote", loginId: "disconnect" });
		await vi.waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
		await transport.handleCommand({
			version: "v1",
			clientId: "test",
			command: "client.unregister",
		});
		expect(signals[0].aborted).toBe(true);
		await send("mcp.oauth.start", { name: "remote", loginId: "shutdown" });
		await vi.waitFor(() => expect(auth).toHaveBeenCalledTimes(2));
		await transport.stop();
		stopped = true;
		expect(signals[1].aborted).toBe(true);
	});
	it("protects active authorization from replacement and refuses new starts during drain", async () => {
		await seed({ remote });
		const auth = vi
			.spyOn(McpOAuth, "authorizeMcpServerOAuth")
			.mockImplementation((options) => awaitAbort(options.signal));
		await send("mcp.oauth.start", { name: "remote", loginId: "drain" });
		await vi.waitFor(() => expect(auth).toHaveBeenCalled());
		expect(
			(await transport.handleCommand({ version: "v1", command: "hub.status" }))
				.payload,
		).toMatchObject({ idle: false, activeMcpRequests: 1 });
		await transport.handleCommand({ version: "v1", command: "hub.drain" });
		expect(
			await send("mcp.oauth.start", { name: "remote", loginId: "refused" }),
		).toMatchObject({ ok: false, error: { code: "hub_draining" } });
		expect(
			await send("mcp.oauth.cancel", { loginId: "drain", reason: "user" }),
		).toMatchObject({
			ok: true,
		});
	});
	it("guards OAuth persistence after a lock wait and after external endpoint edits", async () => {
		await seed({ remote });
		const controller = new AbortController();
		const lock = `${path}.lock`;
		await mkdir(lock);
		await writeFile(join(lock, "owner.external"), "external");
		const saving = updateMcpServerOAuthStateAsync(
			"remote",
			() => ({ tokens: { access_token: "late" } }),
			{
				filePath: path,
				signal: controller.signal,
				expectedTransport: remote.transport,
			},
		);
		const rejection = expect(saving).rejects.toThrow();
		controller.abort();
		await rm(lock, { recursive: true, force: true });
		await rejection;
		await seed({
			remote: {
				...remote,
				transport: { type: "streamableHttp", url: "https://other.test/mcp" },
			},
		});
		await expect(
			updateMcpServerOAuthStateAsync(
				"remote",
				() => ({ tokens: { access_token: "late" } }),
				{ filePath: path, expectedTransport: remote.transport },
			),
		).rejects.toThrow("transport changed");
		expect(
			JSON.parse(await readFile(path, "utf8")).mcpServers.remote.oauth,
		).toBeUndefined();
	});
	it("runs the owner-scoped OAuth flow over an authenticated WebSocket", async () => {
		await seed({ remote });
		vi.spyOn(McpOAuth, "authorizeMcpServerOAuth").mockImplementation(
			async (options) => {
				await options.openUrl?.("https://example.test/auth");
				return success;
			},
		);
		const server = await startHubWebSocketServer({
			...runtime(),
			host: "127.0.0.1",
			port: 0,
			owner: createInMemoryHubOwnerContext("mcp-oauth-wire"),
		});
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "test",
		});
		try {
			await client.connect();
			const openUrl = vi.fn();
			expect(
				(await createHubMcpApi(client).authorize("remote", { openUrl }))
					.servers[0].disabled,
			).toBe(false);
			expect(openUrl).toHaveBeenCalled();
		} finally {
			await client.dispose();
			await server.close();
		}
	});
});

it("leaves an originally enabled server disabled when its viewer disconnects", async () => {
	await seed({ remote: { ...remote, disabled: false } });
	const auth = vi
		.spyOn(McpOAuth, "authorizeMcpServerOAuth")
		.mockImplementation((options) => awaitAbort(options.signal));
	const controller = new AbortController();
	const login = api.authorize("remote", {
		openUrl: vi.fn(),
		signal: controller.signal,
	});
	await vi.waitFor(() => expect(auth).toHaveBeenCalled());
	controller.abort("disconnected");
	expect((await login).servers[0].disabled).toBe(true);
});
it("checks cancellation between asynchronous browser launches", async () => {
	const controller = new AbortController();
	const first = deferred<void>();
	const command = vi.fn(async (name: string) => ({
		version: "v1" as const,
		ok: true,
		payload:
			name === "mcp.oauth.next"
				? {
						urls: ["https://first.test", "https://second.test"],
						result: { name: "remote", authorized: true },
					}
				: { servers: [] },
	}));
	const openUrl = vi.fn(async () => {
		controller.abort();
		await first.promise;
	});
	const login = createHubMcpApi({ command }).authorize("remote", {
		openUrl,
		signal: controller.signal,
	});
	await vi.waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
	first.resolve();
	await login;
	expect(openUrl).toHaveBeenCalledTimes(1);
	expect(command).toHaveBeenCalledWith(
		"mcp.oauth.cancel",
		expect.objectContaining({ reason: "user" }),
		undefined,
		expect.any(Object),
	);
});
it("binds OAuth ownership to the registered connection even when another socket copies its clientId", async () => {
	await seed({ remote: { ...remote, disabled: false } });
	let signal: AbortSignal | undefined;
	const auth = vi
		.spyOn(McpOAuth, "authorizeMcpServerOAuth")
		.mockImplementation((options) => {
			signal = options.signal;
			return awaitAbort(signal);
		});
	const server = await startHubWebSocketServer({
		...runtime(),
		host: "127.0.0.1",
		port: 0,
		owner: createInMemoryHubOwnerContext("mcp-spoof-wire"),
		workspaceRoot: root,
	});
	const victim = new NodeHubClient({
		url: server.url,
		authToken: server.authToken,
		clientId: "victim",
		clientType: "test",
	});
	const sockets: WebSocket[] = [];
	try {
		await victim.connect();
		await victim.command("mcp.oauth.start", {
			name: "remote",
			loginId: "victim-login",
		});
		await vi.waitFor(() => expect(auth).toHaveBeenCalled());
		for (const explicit of [true, false]) {
			const socket = new WebSocket(server.url, {
				origin: "http://localhost:3125",
			});
			sockets.push(socket);
			await new Promise<void>((resolve, reject) => {
				socket.once("open", resolve);
				socket.once("error", reject);
			});
			let sequence = 0;
			const command = (name: string, payload: Record<string, unknown> = {}) =>
				new Promise<HubReplyEnvelope>((resolve) => {
					socket.once("message", (data) =>
						resolve(JSON.parse(String(data)).envelope),
					);
					socket.send(
						JSON.stringify({
							kind: "command",
							envelope: {
								version: "v1",
								clientId: "victim",
								requestId: String(++sequence),
								command: name,
								payload,
							},
						}),
					);
				});
			expect((await command("client.list")).ok).toBe(true);
			expect(
				(
					await command("client.register", {
						clientId: "victim",
						clientType: "browser",
						workspaceContext: { workspaceRoot: root, cwd: root },
					})
				).ok,
			).toBe(true);
			if (explicit) expect((await command("client.unregister")).ok).toBe(true);
			const closed = new Promise((resolve) => socket.once("close", resolve));
			socket.close();
			await closed;
			expect(signal?.aborted).toBe(false);
		}
		await victim.dispose();
		await vi.waitFor(() => expect(signal?.aborted).toBe(true));
		expect((await api.list()).servers[0].disabled).toBe(true);
	} finally {
		for (const socket of sockets) socket.terminate();
		await victim.dispose();
		await server.close();
	}
});
