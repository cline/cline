import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SocketOptions = {
	agent?: HttpProxyAgent<string> | HttpsProxyAgent<string>;
	headers?: Record<string, string>;
};

const { FakeNodeWebSocket } = vi.hoisted(() => {
	class FakeNodeWebSocket {
		static instances: FakeNodeWebSocket[] = [];
		readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
		readyState = 0;

		constructor(
			readonly url: string,
			readonly options: SocketOptions,
		) {
			FakeNodeWebSocket.instances.push(this);
			queueMicrotask(() => {
				this.readyState = 1;
				this.emit("open");
			});
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			const listeners = this.listeners.get(type) ?? [];
			listeners.push(listener);
			this.listeners.set(type, listeners);
		}

		send(data: string): void {
			const frame = JSON.parse(data) as {
				kind?: string;
				envelope?: { command?: string; requestId?: string };
			};
			if (
				frame.kind !== "command" ||
				frame.envelope?.command !== "client.register" ||
				!frame.envelope.requestId
			) {
				return;
			}
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							command: "client.register",
							requestId: frame.envelope?.requestId,
							clientId: "hub",
							ok: true,
							payload: {},
						},
					}),
				});
			});
		}

		close(): void {
			if (this.readyState === 3) return;
			this.readyState = 3;
			this.emit("close", { code: 1000, reason: "" });
		}

		disconnect(): void {
			this.readyState = 3;
			this.emit("close", { code: 1006, reason: "" });
		}

		private emit(type: string, ...args: unknown[]): void {
			for (const listener of this.listeners.get(type) ?? []) {
				listener(...args);
			}
		}
	}

	return { FakeNodeWebSocket };
});

vi.mock("node-ws", () => ({ default: FakeNodeWebSocket }));

import { NodeHubClient } from ".";

const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
	"NO_PROXY",
	"no_proxy",
] as const;

const originalProxyEnv = new Map(
	PROXY_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) delete process.env[key];
}

function agentProxyUrl(agent: SocketOptions["agent"]): string | undefined {
	return agent?.proxy.href;
}

beforeEach(() => {
	clearProxyEnv();
	FakeNodeWebSocket.instances.length = 0;
});

afterEach(() => {
	clearProxyEnv();
	for (const [key, value] of originalProxyEnv) {
		if (value !== undefined) process.env[key] = value;
	}
	vi.restoreAllMocks();
});

describe("NodeHubClient proxy selection", () => {
	it("maps WSS to HTTPS_PROXY and preserves destination headers and URL", async () => {
		process.env.HTTPS_PROXY = "http://proxy.example:8443";
		const client = new NodeHubClient({
			url: "wss://api.cline.bot/api/v1/session/session-1",
			resolveConnectionHeaders: () => ({
				Authorization: "Bearer workos:account-token",
			}),
		});

		try {
			await client.connect();
			const socket = FakeNodeWebSocket.instances[0];
			expect(socket.url).toBe("wss://api.cline.bot/api/v1/session/session-1");
			expect(socket.options.headers).toEqual({
				Authorization: "Bearer workos:account-token",
			});
			expect(socket.options.agent).toBeInstanceOf(HttpsProxyAgent);
			expect(agentProxyUrl(socket.options.agent)).toBe(
				"http://proxy.example:8443/",
			);
		} finally {
			client.close();
		}
	});

	it("maps WS to HTTP_PROXY", async () => {
		process.env.HTTP_PROXY = "http://proxy.example:8080";
		const client = new NodeHubClient({
			url: "ws://remote.example/hub",
			resolveConnectionHeaders: () => ({ Authorization: "Bearer token" }),
		});

		try {
			await client.connect();
			const agent = FakeNodeWebSocket.instances[0].options.agent;
			expect(agent).toBeInstanceOf(HttpProxyAgent);
			expect(agentProxyUrl(agent)).toBe("http://proxy.example:8080/");
		} finally {
			client.close();
		}
	});

	it.each([
		["wss://remote.example/hub", "https_proxy", HttpsProxyAgent],
		["ws://remote.example/hub", "http_proxy", HttpProxyAgent],
	] as const)("supports lowercase proxy variables for %s", async (url, key, Agent) => {
		process.env[key] = "http://lowercase-proxy.example:8080";
		const client = new NodeHubClient({
			url,
			resolveConnectionHeaders: () => ({ Authorization: "Bearer token" }),
		});

		try {
			await client.connect();
			const agent = FakeNodeWebSocket.instances[0].options.agent;
			expect(agent).toBeInstanceOf(Agent);
			expect(agentProxyUrl(agent)).toBe("http://lowercase-proxy.example:8080/");
		} finally {
			client.close();
		}
	});

	it("bypasses the proxy for an exact NO_PROXY host and port", async () => {
		process.env.HTTPS_PROXY = "http://proxy.example:8443";
		process.env.NO_PROXY = "remote.example:443";
		const client = new NodeHubClient({
			url: "wss://remote.example:443/hub",
			resolveConnectionHeaders: () => ({ Authorization: "Bearer token" }),
		});

		try {
			await client.connect();
			expect(FakeNodeWebSocket.instances[0].options.agent).toBeUndefined();
		} finally {
			client.close();
		}
	});

	it("preserves direct behavior when no proxy is configured", async () => {
		const client = new NodeHubClient({
			url: "wss://remote.example/hub",
			resolveConnectionHeaders: () => ({ Authorization: "Bearer token" }),
		});

		try {
			await client.connect();
			expect(FakeNodeWebSocket.instances[0].options.agent).toBeUndefined();
		} finally {
			client.close();
		}
	});

	it("reports malformed proxy configuration as a connection failure", async () => {
		process.env.HTTPS_PROXY = "not a url";
		const client = new NodeHubClient({
			url: "wss://remote.example/hub",
			resolveConnectionHeaders: () => ({ Authorization: "Bearer token" }),
		});

		await expect(client.connect()).rejects.toMatchObject({
			code: "hub_connect_failed",
			message: expect.stringContaining("Invalid URL"),
		});
		expect(client.getConnectionError()).toMatchObject({
			code: "hub_connect_failed",
			message: expect.stringContaining("Invalid URL"),
		});
		expect(FakeNodeWebSocket.instances).toHaveLength(0);
	});

	it("re-resolves proxy selection and headers on reconnect", async () => {
		process.env.HTTPS_PROXY = "http://first-proxy.example:8080";
		let headerVersion = 0;
		const client = new NodeHubClient({
			url: "wss://remote.example/hub",
			resolveConnectionHeaders: () => ({
				Authorization: `Bearer token-${++headerVersion}`,
			}),
		});
		client.subscribe(() => {});

		try {
			await client.connect();
			process.env.HTTPS_PROXY = "http://second-proxy.example:8080";
			FakeNodeWebSocket.instances[0].disconnect();
			await vi.waitFor(() => {
				expect(FakeNodeWebSocket.instances).toHaveLength(2);
				expect(client.isConnected()).toBe(true);
			});

			expect(
				FakeNodeWebSocket.instances.map((socket) => ({
					proxy: agentProxyUrl(socket.options.agent),
					authorization: socket.options.headers?.Authorization,
				})),
			).toEqual([
				{
					proxy: "http://first-proxy.example:8080/",
					authorization: "Bearer token-1",
				},
				{
					proxy: "http://second-proxy.example:8080/",
					authorization: "Bearer token-2",
				},
			]);
		} finally {
			client.close();
		}
	});
});
