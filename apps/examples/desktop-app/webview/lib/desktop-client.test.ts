// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		const request = this.lastRequest();
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
	(window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__ =
		"ws://127.0.0.1:3126/transport";
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	globalThis.WebSocket = originalWebSocket;
	delete (window as unknown as Record<string, unknown>).__SIDECAR_WS_ENDPOINT__;
});

describe("DesktopClient command deadlines", () => {
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
