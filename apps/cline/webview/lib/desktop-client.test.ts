// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDesktopDebugLog } from "./desktop-client";

type SentDesktopRequest = {
	id: string;
	command: string;
};

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readonly sent: string[] = [];
	readyState = FakeWebSocket.CONNECTING;
	sendError: Error | null = null;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(readonly url: string) {
		sockets.push(this);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	send(data: string): void {
		if (this.sendError) {
			throw this.sendError;
		}
		this.sent.push(data);
	}

	close(): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.();
	}

	respond(result: unknown): void {
		this.respondAt(this.sent.length - 1, result);
	}

	respondAt(index: number, result: unknown): void {
		const raw = this.sent[index];
		if (!raw) {
			throw new Error(`No desktop request was sent at index ${index}`);
		}
		const request = JSON.parse(raw) as SentDesktopRequest;
		this.onmessage?.({
			data: JSON.stringify({
				type: "response",
				id: request.id,
				ok: true,
				result,
			}),
		});
	}

	lastRequest(): SentDesktopRequest {
		const raw = this.sent.at(-1);
		if (!raw) {
			throw new Error("No desktop request was sent");
		}
		return JSON.parse(raw) as SentDesktopRequest;
	}
}

const sockets: FakeWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));

async function connectLatestSocket(options?: {
	sendError?: Error;
}): Promise<FakeWebSocket> {
	await Promise.resolve();
	await Promise.resolve();
	const socket = sockets.at(-1);
	if (!socket) {
		throw new Error("Desktop client did not create a WebSocket");
	}
	socket.sendError = options?.sendError ?? null;
	socket.open();
	for (let attempt = 0; attempt < 10 && socket.sent.length === 0; attempt++) {
		await Promise.resolve();
	}
	return socket;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	sockets.length = 0;
	globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	fetchMock.mockClear();
	(window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__ =
		"ws://127.0.0.1:3126/transport";
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllTimers();
	vi.useRealTimers();
	globalThis.WebSocket = originalWebSocket;
	globalThis.fetch = originalFetch;
	delete (window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__;
});

describe("DesktopClient command deadlines", () => {
	it("reports the same error object only once across local and global handlers", async () => {
		const { desktopClient } = await import("./desktop-client");
		const error = new Error("native command failed");

		desktopClient.reportError({
			operation: "webview.native_command",
			error,
			command: "get_update_status",
		});
		desktopClient.reportError({
			operation: "webview.unhandled_rejection",
			error,
			handled: false,
		});

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
	});

	it("allows the global handler to retry when local error delivery fails", async () => {
		fetchMock
			.mockRejectedValueOnce(new Error("sidecar unavailable"))
			.mockResolvedValueOnce(new Response(null, { status: 202 }));
		const { desktopClient } = await import("./desktop-client");
		const error = new Error("native command failed");

		desktopClient.reportError({
			operation: "webview.native_command",
			error,
			command: "get_update_status",
		});
		desktopClient.reportError({
			operation: "webview.unhandled_rejection",
			error,
			handled: false,
		});

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(
			JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
		).toMatchObject({
			operation: "webview.unhandled_rejection",
			handled: false,
		});

		desktopClient.reportError({
			operation: "webview.unhandled_rejection",
			error,
			handled: false,
		});
		await Promise.resolve();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("keeps an explicitly unbounded command pending past the default deadline", async () => {
		const { desktopClient } = await import("./desktop-client");
		let settled = false;
		const invocation = desktopClient
			.invoke<{ ok: boolean }>(
				"chat_session_command",
				{ request: { action: "send" } },
				{ timeoutMs: null },
			)
			.finally(() => {
				settled = true;
			});
		const socket = await connectLatestSocket();

		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(settled).toBe(false);

		socket.respond({ ok: true });
		await expect(invocation).resolves.toEqual({ ok: true });
	});

	it("retains the default deadline for ordinary commands", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke("get_process_context");
		await connectLatestSocket();
		const rejection = expect(invocation).rejects.toThrow(
			"Desktop command timed out waiting for get_process_context",
		);

		await vi.advanceTimersByTimeAsync(120_000);
		await rejection;
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"http://127.0.0.1:3126/telemetry/error",
		);
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			operation: "webview.command_timeout",
			command: "get_process_context",
			timeoutMs: 120_000,
			transportState: "connected",
		});
	});

	it("rejects an unbounded command when the transport closes", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke(
			"chat_session_command",
			{ request: { action: "send" } },
			{ timeoutMs: null },
		);
		const socket = await connectLatestSocket();
		const rejection = expect(invocation).rejects.toThrow(
			"Desktop backend transport closed",
		);

		socket.close();
		await rejection;
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(
			JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
		).toMatchObject({
			operation: "webview.transport_closed",
		});
	});

	it("does not report a transport closure with no pending requests", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke<{ ok: boolean }>(
			"get_process_context",
		);
		const socket = await connectLatestSocket();
		socket.respond({ ok: true });
		await expect(invocation).resolves.toEqual({ ok: true });

		socket.close();
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("forwards bounded source attribution for uncaught errors", async () => {
		const { desktopClient } = await import("./desktop-client");
		const error = new Error("Unexpected token '<'");
		error.name = "SyntaxError";
		error.stack = `SyntaxError: Unexpected token '<'\n${"x".repeat(600)}`;

		desktopClient.reportError({
			operation: "webview.uncaught_error",
			error,
			handled: false,
			sourceUrl: `tauri://localhost/_vercel/insights/script.js?${"q".repeat(600)}`,
			lineno: 1,
			colno: 1,
		});

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			sourceUrl: string;
			stack: string;
		};
		expect(body).toMatchObject({
			operation: "webview.uncaught_error",
			errorType: "SyntaxError",
			errorMessage: "Unexpected token '<'",
			handled: false,
			lineno: 1,
			colno: 1,
		});
		expect(body.sourceUrl).toHaveLength(500);
		expect(
			body.sourceUrl.startsWith("tauri://localhost/_vercel/insights/script.js"),
		).toBe(true);
		expect(body.stack).toHaveLength(500);
	});

	it("omits source attribution fields when they are not provided", async () => {
		const { desktopClient } = await import("./desktop-client");
		const error = new Error("plain failure");
		error.stack = undefined;

		desktopClient.reportError({
			operation: "webview.uncaught_error",
			error,
			handled: false,
		});

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		const body = JSON.parse(
			String(fetchMock.mock.calls[0]?.[1]?.body),
		) as Record<string, unknown>;
		expect("sourceUrl" in body).toBe(false);
		expect("lineno" in body).toBe(false);
		expect("colno" in body).toBe(false);
		expect("stack" in body).toBe(false);
	});

	it("removes an unbounded request when WebSocket.send throws", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke(
			"chat_session_command",
			{ request: { action: "send" } },
			{ timeoutMs: null },
		);
		await connectLatestSocket({
			sendError: new Error("WebSocket send failed"),
		});

		await expect(invocation).rejects.toThrow("WebSocket send failed");
		expect(
			(
				desktopClient as unknown as {
					pending: Map<string, unknown>;
				}
			).pending.size,
		).toBe(0);
	});
});

describe("DesktopClient initial connect retry", () => {
	it("retries a freshly-spawned backend's not-yet-listening WebSocket instead of failing outright", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke("get_process_context");

		await Promise.resolve();
		await Promise.resolve();
		const firstSocket = sockets.at(-1);
		if (!firstSocket) throw new Error("expected a socket to be created");
		// The server isn't listening yet: closes before ever opening.
		firstSocket.close();

		// Advance past the retry delay - a second attempt should follow.
		await vi.advanceTimersByTimeAsync(1_000);
		const secondSocket = sockets.at(-1);
		expect(secondSocket).not.toBe(firstSocket);

		const socket = await connectLatestSocket();
		socket.respond({ ok: true });
		await expect(invocation).resolves.toEqual({ ok: true });
	});

	it("gives up after exhausting the initial retry budget", async () => {
		const { desktopClient } = await import("./desktop-client");
		const invocation = desktopClient.invoke("get_process_context");
		const rejection = expect(invocation).rejects.toThrow(
			"Desktop backend transport unavailable",
		);

		for (let attempt = 0; attempt < 5; attempt++) {
			await Promise.resolve();
			await Promise.resolve();
			const socket = sockets.at(-1);
			if (!socket) throw new Error("expected a socket to be created");
			socket.close();
			await vi.advanceTimersByTimeAsync(1_000);
		}

		await rejection;
	});
});

describe("DesktopClient setActiveProject mid-connect", () => {
	it("waits for a shared in-flight connection before sending session hydration commands", async () => {
		const { desktopClient } = await import("./desktop-client");
		const messagesInvocation = desktopClient.invoke("read_session_messages", {
			sessionId: "older-session",
		});

		await Promise.resolve();
		await Promise.resolve();
		const socket = sockets.at(-1);
		if (!socket) throw new Error("expected a socket to be created");
		expect(socket.readyState).toBe(FakeWebSocket.CONNECTING);

		const attachInvocation = desktopClient.invoke("chat_session_command", {
			request: { action: "attach", sessionId: "older-session" },
		});
		let attachSettled = false;
		void attachInvocation.then(
			() => {
				attachSettled = true;
			},
			() => {
				attachSettled = true;
			},
		);
		await Promise.resolve();
		expect(attachSettled).toBe(false);

		socket.open();
		await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
		socket.respondAt(0, []);
		socket.respondAt(1, { sessionId: "older-session" });

		await expect(messagesInvocation).resolves.toEqual([]);
		await expect(attachInvocation).resolves.toEqual({
			sessionId: "older-session",
		});
	});

	it("does not let endpoint resolution for the previous project create a stale socket", async () => {
		const { desktopClient, PROJECT_SWITCH_ERROR_MESSAGE } = await import(
			"./desktop-client"
		);
		const previousInvocation = desktopClient.invoke("get_process_context");
		const previousRejection = expect(previousInvocation).rejects.toThrow(
			PROJECT_SWITCH_ERROR_MESSAGE,
		);

		// Switch before endpoint resolution has yielded back and constructed the
		// first socket. The superseded continuation must not create a socket later.
		desktopClient.setActiveProject("cline", "/some/other/project");
		const currentInvocation = desktopClient.invoke("read_session_messages", {
			sessionId: "older-session",
		});

		for (let attempt = 0; attempt < 10 && sockets.length === 0; attempt++) {
			await Promise.resolve();
		}
		expect(sockets).toHaveLength(1);
		const socket = sockets[0];
		if (!socket) throw new Error("expected the current project's socket");
		socket.open();
		await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
		socket.respond([]);

		await previousRejection;
		await expect(currentInvocation).resolves.toEqual([]);
	});

	it("uses a fresh initial-connect retry budget for each project", async () => {
		const { desktopClient } = await import("./desktop-client");
		const initialInvocation = desktopClient.invoke("get_process_context");
		const initialSocket = await connectLatestSocket();
		initialSocket.respond({ ok: true });
		await expect(initialInvocation).resolves.toEqual({ ok: true });

		desktopClient.setActiveProject("cline", "/some/other/project");
		const switchedInvocation = desktopClient.invoke("read_session_messages", {
			sessionId: "older-session",
		});
		await Promise.resolve();
		await Promise.resolve();
		const firstProjectSocket = sockets.at(-1);
		if (!firstProjectSocket) {
			throw new Error("expected the switched project's first socket");
		}
		firstProjectSocket.close();

		await vi.advanceTimersByTimeAsync(1_000);
		const retriedProjectSocket = sockets.at(-1);
		expect(retriedProjectSocket).not.toBe(firstProjectSocket);
		if (!retriedProjectSocket) {
			throw new Error("expected the switched project's retry socket");
		}
		retriedProjectSocket.open();
		await vi.waitFor(() => expect(retriedProjectSocket.sent).toHaveLength(1));
		retriedProjectSocket.respond([]);

		await expect(switchedInvocation).resolves.toEqual([]);
	});

	it("fails an in-flight connect immediately when the project changes before it opens, instead of hanging forever", async () => {
		const { desktopClient, PROJECT_SWITCH_ERROR_MESSAGE } = await import(
			"./desktop-client"
		);
		const firstInvocation = desktopClient.invoke("get_process_context");

		await Promise.resolve();
		await Promise.resolve();
		const firstSocket = sockets.at(-1);
		if (!firstSocket) throw new Error("expected a socket to be created");
		expect(firstSocket.readyState).toBe(FakeWebSocket.CONNECTING);

		desktopClient.setActiveProject("cline", "/some/other/project");

		await expect(firstInvocation).rejects.toThrow(PROJECT_SWITCH_ERROR_MESSAGE);
	});

	it("still lets a fresh connection go through for the new project after aborting the old one", async () => {
		const { desktopClient } = await import("./desktop-client");
		const firstInvocation = desktopClient.invoke("get_process_context");

		await Promise.resolve();
		await Promise.resolve();
		const firstSocket = sockets.at(-1);
		if (!firstSocket) throw new Error("expected a socket to be created");

		desktopClient.setActiveProject("cline", "/some/other/project");
		await expect(firstInvocation).rejects.toThrow();

		const secondInvocation = desktopClient.invoke("get_process_context");
		await Promise.resolve();
		await Promise.resolve();
		const secondSocket = sockets.at(-1);
		expect(secondSocket).not.toBe(firstSocket);

		const socket = await connectLatestSocket();
		expect(socket).toBe(secondSocket);
		socket.respond({ ok: true });
		await expect(secondInvocation).resolves.toEqual({ ok: true });
	});
});

describe("writeDesktopDebugLog", () => {
	it.each([
		"debug",
		"info",
		"error",
	] as const)("prints valid %s sidecar diagnostics with a static format string", (level) => {
		const consoleSpy = vi.spyOn(console, level).mockImplementation(() => {});

		writeDesktopDebugLog({
			scope: "voice-input",
			level,
			message: "Starting audio transcription",
			timestamp: "2026-07-28T00:00:00.000Z",
			metadata: {
				providerId: "vercel-ai-gateway",
				modelId: "openai/whisper-1",
				endpoint: "https://ai-gateway.vercel.sh/v1/ai/transcription-model",
			},
		});

		expect(consoleSpy).toHaveBeenCalledWith(
			"%s %o",
			"[desktop:voice-input] Starting audio transcription",
			expect.objectContaining({
				providerId: "vercel-ai-gateway",
				modelId: "openai/whisper-1",
				endpoint: "https://ai-gateway.vercel.sh/v1/ai/transcription-model",
			}),
		);
	});

	it("ignores malformed debug events", () => {
		const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

		writeDesktopDebugLog({
			scope: "voice-input",
			level: "verbose",
			message: "invalid",
		});

		expect(debugSpy).not.toHaveBeenCalled();
	});
});
