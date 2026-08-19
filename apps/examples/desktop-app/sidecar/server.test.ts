import { afterEach, describe, expect, it, vi } from "vitest";
import {
	MAX_RECORDED_AUDIO_BASE64_BYTES,
	MAX_RECORDED_AUDIO_BYTES,
} from "../webview/lib/voice-input-limits";
import {
	createFetchHandler,
	createWebSocketHandler,
	type SidecarAuth,
} from "./server";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

const TEST_AUTH: SidecarAuth = { token: "test-sidecar-token" };

function createTestServer() {
	return {
		port: 3126,
		upgrade: vi.fn(() => true),
	};
}

function createHandler(onShutdown = vi.fn(), auth: SidecarAuth = TEST_AUTH) {
	return createFetchHandler({} as SidecarContext, onShutdown, auth);
}

function createTelemetryHandler(capture = vi.fn()) {
	return {
		handler: createFetchHandler(
			{ telemetry: { capture } } as never,
			undefined,
			TEST_AUTH,
		),
		capture,
	};
}

function createFakeWebSocketClient() {
	const sent: string[] = [];
	return {
		sent,
		close: vi.fn(),
		send: vi.fn((message: string) => {
			sent.push(message);
		}),
	};
}

describe("sidecar WebSocket payload limit", () => {
	it("accepts every recording allowed by the voice input size limit", () => {
		const handler = createWebSocketHandler({} as SidecarContext, TEST_AUTH);

		expect(MAX_RECORDED_AUDIO_BYTES).toBe(25 * 1024 * 1024);
		expect(handler.maxPayloadLength).toBeGreaterThan(
			MAX_RECORDED_AUDIO_BASE64_BYTES,
		);
	});
});

describe("sidecar WebSocket auth handshake", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("serves no commands and closes connections that never authenticate", async () => {
		vi.useFakeTimers();
		const ctx = { wsClients: new Set() } as unknown as SidecarContext;
		const handler = createWebSocketHandler(ctx, TEST_AUTH);
		const ws = createFakeWebSocketClient();

		handler.open(ws as SidecarWebSocketClient);
		await handler.message(
			ws as SidecarWebSocketClient,
			JSON.stringify({
				type: "command",
				id: "1",
				command: "get_process_context",
			}),
		);

		expect(ctx.wsClients.size).toBe(0);
		expect(ws.close).toHaveBeenCalled();
		const authResult = JSON.parse(ws.sent[0] ?? "{}") as {
			type?: string;
			ok?: boolean;
		};
		expect(authResult).toMatchObject({ type: "auth", ok: false });
	});

	it("rejects a wrong token and accepts the correct one", async () => {
		const ctx = {
			wsClients: new Set(),
			hubBuildMismatch: null,
		} as unknown as SidecarContext;
		const handler = createWebSocketHandler(ctx, TEST_AUTH);

		const intruder = createFakeWebSocketClient();
		handler.open(intruder as SidecarWebSocketClient);
		await handler.message(
			intruder as SidecarWebSocketClient,
			JSON.stringify({ type: "auth", token: "wrong-token" }),
		);
		expect(intruder.close).toHaveBeenCalled();
		expect(ctx.wsClients.size).toBe(0);

		const client = createFakeWebSocketClient();
		handler.open(client as SidecarWebSocketClient);
		await handler.message(
			client as SidecarWebSocketClient,
			JSON.stringify({ type: "auth", token: TEST_AUTH.token }),
		);

		expect(client.close).not.toHaveBeenCalled();
		expect(ctx.wsClients.size).toBe(1);
		const messages = client.sent.map(
			(raw) => JSON.parse(raw) as { type: string },
		);
		expect(messages[0]).toMatchObject({ type: "auth", ok: true });
		// host_ready follows the handshake so event consumers see the same
		// connect sequence as before transport auth existed.
		expect(messages[1]?.type).toBe("event");
	});

	it("drops connections that never complete the handshake", () => {
		vi.useFakeTimers();
		const ctx = { wsClients: new Set() } as unknown as SidecarContext;
		const handler = createWebSocketHandler(ctx, TEST_AUTH);
		const ws = createFakeWebSocketClient();

		handler.open(ws as SidecarWebSocketClient);
		vi.advanceTimersByTime(10_000);

		expect(ws.close).toHaveBeenCalled();
		expect(ctx.wsClients.size).toBe(0);
	});
});

describe("sidecar HTTP origin checks", () => {
	it("rejects cross-origin shutdown preflight requests", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "OPTIONS",
				headers: {
					origin: "https://attacker.example",
					"access-control-request-method": "POST",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("rejects cross-origin shutdown POST requests", async () => {
		const onShutdown = vi.fn();
		const server = createTestServer();
		const response = await createHandler(onShutdown)(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "POST",
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(onShutdown).not.toHaveBeenCalled();
	});

	it("rejects cross-origin websocket upgrades", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/transport", {
				headers: {
					origin: "https://attacker.example",
				},
			}),
			server,
		);

		expect(response?.status).toBe(404);
		expect(server.upgrade).not.toHaveBeenCalled();
	});

	it("allows desktop webview origins in preflight responses", async () => {
		const server = createTestServer();
		const response = await createHandler()(
			new Request("http://127.0.0.1:3126/api/marketplace/catalog", {
				method: "OPTIONS",
				headers: {
					origin: "tauri://localhost",
					"access-control-request-method": "GET",
				},
			}),
			server,
		);

		expect(response?.status).toBe(204);
		expect(response?.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);
	});
});

describe("sidecar shutdown auth", () => {
	it("rejects shutdown requests from trusted origins when the token is missing", async () => {
		const onShutdown = vi.fn();
		const server = createTestServer();
		const response = await createHandler(onShutdown)(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "POST",
				headers: { origin: "tauri://localhost" },
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(onShutdown).not.toHaveBeenCalled();
	});

	it("rejects shutdown requests bearing a wrong token", async () => {
		const onShutdown = vi.fn();
		const server = createTestServer();
		const response = await createHandler(onShutdown)(
			new Request("http://127.0.0.1:3126/shutdown", {
				method: "POST",
				headers: { authorization: "Bearer wrong-token" },
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(onShutdown).not.toHaveBeenCalled();
	});

	it("accepts shutdown requests bearing the auth token", async () => {
		const onShutdown = vi.fn(async () => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		try {
			const server = createTestServer();
			const response = await createHandler(onShutdown)(
				new Request("http://127.0.0.1:3126/shutdown", {
					method: "POST",
					headers: { authorization: `Bearer ${TEST_AUTH.token}` },
				}),
				server,
			);

			expect(response?.status).toBe(200);
			// The shutdown chain ends in process.exit; wait for the spy to see
			// it so the real exit never fires inside the test runner.
			await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledOnce());
			expect(onShutdown).toHaveBeenCalledOnce();
		} finally {
			exitSpy.mockRestore();
		}
	});
});

describe("desktop error telemetry", () => {
	it("captures sanitized webview error reports with structured context", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: {
					origin: "tauri://localhost",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "webview.command_timeout",
					errorMessage:
						"Desktop command timed out waiting for get_process_context",
					errorType: "Error",
					command: "get_process_context",
					timeoutMs: 120_000,
					transportState: "connected",
				}),
			}),
			server,
		);

		expect(response?.status).toBe(202);
		expect(capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "desktop",
				operation: "webview.command_timeout",
				error_message:
					"Desktop command timed out waiting for get_process_context",
				command: "get_process_context",
				timeoutMs: 120_000,
				transportState: "connected",
			}),
		});
	});

	it("forwards bounded source attribution for uncaught webview errors", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: {
					origin: "tauri://localhost",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "webview.uncaught_error",
					errorMessage: "Unexpected token '<'",
					errorType: "SyntaxError",
					handled: false,
					transportState: "connecting",
					sourceUrl: `tauri://localhost/_vercel/insights/script.js?${"q".repeat(600)}`,
					lineno: 1,
					colno: 1,
					stack: `SyntaxError: Unexpected token '<'\n${"x".repeat(600)}`,
				}),
			}),
			server,
		);

		expect(response?.status).toBe(202);
		expect(capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "desktop",
				operation: "webview.uncaught_error",
				error_type: "SyntaxError",
				error_message: "Unexpected token '<'",
				handled: false,
				transportState: "connecting",
				lineno: 1,
				colno: 1,
			}),
		});
		const properties = capture.mock.calls[0]?.[0]?.properties as Record<
			string,
			unknown
		>;
		expect(properties.sourceUrl).toHaveLength(500);
		expect(
			String(properties.sourceUrl).startsWith(
				"tauri://localhost/_vercel/insights/script.js",
			),
		).toBe(true);
		expect(properties.stack).toHaveLength(500);
	});

	it("drops malformed source attribution fields", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: {
					origin: "tauri://localhost",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					operation: "webview.uncaught_error",
					errorMessage: "boom",
					sourceUrl: 42,
					lineno: "one",
					colno: null,
					stack: "   ",
				}),
			}),
			server,
		);

		expect(response?.status).toBe(202);
		const properties = capture.mock.calls[0]?.[0]?.properties as Record<
			string,
			unknown
		>;
		expect("sourceUrl" in properties).toBe(false);
		expect("lineno" in properties).toBe(false);
		expect("colno" in properties).toBe(false);
		expect("stack" in properties).toBe(false);
	});

	it("rejects error reports from untrusted origins", async () => {
		const server = createTestServer();
		const { handler, capture } = createTelemetryHandler();
		const response = await handler(
			new Request("http://127.0.0.1:3126/telemetry/error", {
				method: "POST",
				headers: { origin: "https://attacker.example" },
				body: JSON.stringify({ operation: "webview.uncaught_error" }),
			}),
			server,
		);

		expect(response?.status).toBe(403);
		expect(capture).not.toHaveBeenCalled();
	});
});
