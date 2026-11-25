import { describe, expect, it, vi } from "vitest";
import {
	MAX_RECORDED_AUDIO_BASE64_BYTES,
	MAX_RECORDED_AUDIO_BYTES,
} from "../webview/lib/voice-input-limits";
import { hubBuildWatchCallbacks } from "./hub-capability";
import { createFetchHandler, createWebSocketHandler } from "./server";
import type { SidecarContext } from "./types";

const { enabledPluginPaths } = vi.hoisted(() => ({
	enabledPluginPaths: { current: [] as string[] },
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		resolveAgentPluginPathsWithDiagnostics: () => ({
			paths: enabledPluginPaths.current,
			disabledPaths: [],
			discoveryFailures: [],
		}),
	};
});

const TEST_APPROVAL_TOKEN = "test-approval-token";

function createTestServer() {
	return {
		port: 3126,
		upgrade: vi.fn(() => true),
	};
}

function createHandler(onShutdown = vi.fn()) {
	return createFetchHandler(
		{} as SidecarContext,
		onShutdown,
		TEST_APPROVAL_TOKEN,
	);
}

function createTelemetryHandler(capture = vi.fn()) {
	return {
		handler: createFetchHandler({ telemetry: { capture } } as never),
		capture,
	};
}

describe("sidecar WebSocket payload limit", () => {
	it("accepts every recording allowed by the voice input size limit", () => {
		const handler = createWebSocketHandler({} as SidecarContext);

		expect(MAX_RECORDED_AUDIO_BYTES).toBe(25 * 1024 * 1024);
		expect(handler.maxPayloadLength).toBeGreaterThan(
			MAX_RECORDED_AUDIO_BASE64_BYTES,
		);
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

	it("does not grant approval authority to originless local clients", async () => {
		const server = createTestServer();
		await createHandler()(
			new Request(
				`http://127.0.0.1:3126/transport?approval_token=${TEST_APPROVAL_TOKEN}`,
			),
			server,
		);

		expect(server.upgrade).toHaveBeenCalledWith(expect.any(Request), {
			data: { canApproveTools: false },
		});
	});

	it("grants approval authority to the trusted desktop webview", async () => {
		const server = createTestServer();
		await createHandler()(
			new Request(
				`http://127.0.0.1:3126/transport?approval_token=${TEST_APPROVAL_TOKEN}`,
				{
					headers: { origin: "tauri://localhost" },
				},
			),
			server,
		);

		expect(server.upgrade).toHaveBeenCalledWith(expect.any(Request), {
			data: { canApproveTools: true },
		});
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

	it("does not grant approval authority to a spoofed trusted origin", async () => {
		const server = createTestServer();
		await createHandler()(
			new Request("http://127.0.0.1:3126/transport", {
				headers: { origin: "tauri://localhost" },
			}),
			server,
		);

		expect(server.upgrade).toHaveBeenCalledWith(expect.any(Request), {
			data: { canApproveTools: false },
		});
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

describe("plugin UI viewers on socket close", () => {
	it("detaches only the sessions the closed socket was the last to view", async () => {
		const { createSidecarContext } = await import("./context");
		const { invokePluginUi } = await import("./plugin-ui");
		const invoke = vi.fn(async () => ({ outcome: "ok" as const }));
		const ctx = createSidecarContext("/workspace/project");
		ctx.runtimeBindings.set("local", {
			environmentId: "local",
			kind: "local",
			workspaceRoot: "/workspace/project",
			sessionManager: { pluginUi: { invoke } },
			hubClient: { updateCapabilities: vi.fn(async () => undefined) },
			unsubscribeSessionEvents: () => {},
		} as never);
		const closing = { data: { canApproveTools: true }, send: vi.fn() };
		const staying = { data: { canApproveTools: true }, send: vi.fn() };
		const attach = (sessionId: string) => ({
			environmentId: "local",
			sessionId,
			slot: "composer.suggestions",
			action: { verb: "attach", surface: "desktop" },
		});
		await invokePluginUi(ctx, attach("shared"), closing);
		await invokePluginUi(ctx, attach("shared"), staying);
		await invokePluginUi(ctx, attach("solo"), closing);
		invoke.mockClear();

		const handler = createWebSocketHandler(ctx);
		handler.open(closing);
		handler.close(closing);

		await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
		expect(invoke).toHaveBeenCalledWith({
			sessionId: "solo",
			slot: "composer.suggestions",
			action: { verb: "detach" },
		});
		expect(ctx.pluginUiViews?.get("shared")).toEqual({
			environmentId: "local",
			sockets: new Set([staying]),
		});
	});
});

describe("replaying a pending Hub mismatch to a new webview", () => {
	const missingPluginUi = {
		url: "ws://127.0.0.1:25463/hub",
		reason: "missing_capability" as const,
		hubBuildId: "source-0.0.93",
		expectedBuildId: "source-0.0.93",
		missingCapabilities: ["plugins.ui"],
	};

	function connectWebview() {
		return { data: { canApproveTools: true }, send: vi.fn() };
	}

	function mismatchesSentTo(
		socket: ReturnType<typeof connectWebview>,
	): unknown[] {
		return socket.send.mock.calls
			.map(
				([encoded]) =>
					JSON.parse(String(encoded)) as {
						event?: { name: string; payload: unknown };
					},
			)
			.filter((message) => message.event?.name === "hub_build_mismatch")
			.map((message) => message.event?.payload);
	}

	async function replayedMismatches(
		hubBuildMismatch: SidecarContext["hubBuildMismatch"],
	): Promise<unknown[]> {
		const { createSidecarContext } = await import("./context");
		const ctx = createSidecarContext("/workspace/project");
		ctx.hubBuildMismatch = hubBuildMismatch;
		const socket = connectWebview();

		createWebSocketHandler(ctx).open(socket);

		return mismatchesSentTo(socket);
	}

	it("holds back the plugin UI notice while no plugin is enabled", async () => {
		enabledPluginPaths.current = [];

		await expect(replayedMismatches(missingPluginUi)).resolves.toEqual([null]);
	});

	it("tells a webview that connects without a mismatch that there is none", async () => {
		await expect(replayedMismatches(null)).resolves.toEqual([null]);
	});

	it("replays the plugin UI notice once a plugin is enabled", async () => {
		enabledPluginPaths.current = ["/plugins/next-turn/index.ts"];

		await expect(replayedMismatches(missingPluginUi)).resolves.toEqual([
			missingPluginUi,
		]);
	});

	it("replays the other Hub prompts regardless of plugins", async () => {
		enabledPluginPaths.current = [];
		const outdated = { ...missingPluginUi, reason: "outdated_hub" as const };

		await expect(replayedMismatches(outdated)).resolves.toEqual([outdated]);
	});

	it("withdraws the notice once the watcher finds the Hub fixed, including from a webview that was reconnecting", async () => {
		enabledPluginPaths.current = ["/plugins/next-turn/index.ts"];
		const { createSidecarContext } = await import("./context");
		const ctx = createSidecarContext("/workspace/project");
		const watcher = hubBuildWatchCallbacks(ctx);
		const handler = createWebSocketHandler(ctx);
		const staying = connectWebview();
		const dropped = connectWebview();
		handler.open(staying);
		handler.open(dropped);

		const broadcastMismatch = expect.objectContaining(missingPluginUi);

		watcher.onMismatch(missingPluginUi);
		handler.close(dropped);
		watcher.onResolved?.();
		const reconnected = connectWebview();
		handler.open(reconnected);

		expect(ctx.hubBuildMismatch).toBeNull();
		expect(mismatchesSentTo(staying)).toEqual([null, broadcastMismatch, null]);
		expect(mismatchesSentTo(dropped)).toEqual([null, broadcastMismatch]);
		expect(mismatchesSentTo(reconnected)).toEqual([null]);

		watcher.onResolved?.();
		expect(mismatchesSentTo(staying)).toEqual([null, broadcastMismatch, null]);
	});
});
