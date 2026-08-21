// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopTransportRequest } from "@/lib/desktop-transport";

const desktopMocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	tryTauriInvoke: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: desktopMocks.invoke,
		subscribe: vi.fn(),
	},
	tryTauriInvoke: desktopMocks.tryTauriInvoke,
}));

type FakeEvent = { data?: string };
type FakeListener = (event: FakeEvent) => void;
type RequestHandler = (
	socket: FakeWebSocket,
	request: DesktopTransportRequest,
) => void;

let requestHandler: RequestHandler = () => {};
const sockets: FakeWebSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

class FakeWebSocket {
	readonly requests: DesktopTransportRequest[] = [];
	readonly listeners = new Map<string, Set<FakeListener>>();
	closed = false;

	constructor(readonly url: string) {
		sockets.push(this);
		queueMicrotask(() => this.emit("open"));
	}

	addEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: FakeListener): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(raw: string): void {
		const request = JSON.parse(raw) as DesktopTransportRequest;
		this.requests.push(request);
		queueMicrotask(() => requestHandler(this, request));
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.emit("close");
	}

	respond(request: DesktopTransportRequest, result: unknown): void {
		this.emitMessage({
			type: "response",
			id: request.id,
			ok: true,
			result,
		});
	}

	fail(request: DesktopTransportRequest, error: string): void {
		this.emitMessage({
			type: "response",
			id: request.id,
			ok: false,
			error,
		});
	}

	emitChatEvent(
		sessionId: string,
		clientTurnId: string,
		stream: string,
		value: unknown,
	): void {
		this.emitMessage({
			type: "event",
			event: {
				name: "chat_event",
				payload: {
					sessionId,
					clientTurnId,
					stream,
					chunk: JSON.stringify(value),
				},
			},
		});
	}

	emitEvent(name: string, payload: unknown): void {
		this.emitMessage({ type: "event", event: { name, payload } });
	}

	private emitMessage(value: unknown): void {
		this.emit("message", { data: JSON.stringify(value) });
	}

	private emit(type: string, event: FakeEvent = {}): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}
}

const baseRequest = {
	requestId: "relay-request-1",
	createdAt: "2026-08-18T00:00:00.000Z",
	botName: "Recipe Bot",
	message: "What's your name?",
	mode: "await_reply" as const,
	timeoutMs: 5_000,
};

function actionOf(request: DesktopTransportRequest): string {
	return String(
		(request.args?.request as { action?: string } | undefined)?.action ?? "",
	);
}

function clientTurnIdOf(request: DesktopTransportRequest | undefined): string {
	return String(
		(request?.args?.request as { clientTurnId?: string } | undefined)
			?.clientTurnId ?? "",
	);
}

function respondToStartOr(
	onSend: (socket: FakeWebSocket, request: DesktopTransportRequest) => void,
): void {
	requestHandler = (socket, request) => {
		if (actionOf(request) === "start") {
			socket.respond(request, { sessionId: "target-session" });
			return;
		}
		onSend(socket, request);
	};
}

beforeEach(() => {
	desktopMocks.invoke.mockReset();
	desktopMocks.tryTauriInvoke.mockReset();
	desktopMocks.invoke.mockResolvedValue({
		bots: [
			{ id: "cline", name: "Cline" },
			{ id: "recipe-bot", name: "Recipe Bot" },
		],
	});
	desktopMocks.tryTauriInvoke.mockResolvedValue(
		"ws://127.0.0.1:43126/",
	);
	sockets.length = 0;
	requestHandler = () => {};
	globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
	vi.restoreAllMocks();
});

describe("message_bot relay", () => {
	it("reads an immediate reply from the nested chat command result", async () => {
		respondToStartOr((socket, request) => {
			expect(actionOf(request)).toBe("send");
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: {
					finishReason: "completed",
					text: "I'm Recipe Bot.",
				},
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(relayMessageBot(baseRequest)).resolves.toEqual({
			delivered: true,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			reply: "I'm Recipe Bot.",
		});
		expect(sockets[0]?.closed).toBe(true);
	});

	it("waits for the matching chat_done when a fresh prompt is queued", async () => {
		respondToStartOr((socket, request) => {
			expect(actionOf(request)).toBe("send");
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: undefined,
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		let settled = false;
		const relay = relayMessageBot(baseRequest).finally(() => {
			settled = true;
		});
		await vi.waitFor(() => expect(sockets[0]?.requests).toHaveLength(2));
		await Promise.resolve();
		expect(settled).toBe(false);

		const socket = sockets[0];
		const clientTurnId = clientTurnIdOf(socket?.requests[1]);
		expect(clientTurnId).toMatch(/^message_bot_turn_/);
		socket?.emitChatEvent("another-session", clientTurnId, "chat_done", {
			reason: "completed",
			text: "Wrong reply",
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		socket?.emitChatEvent("target-session", "older-turn", "chat_done", {
			reason: "completed",
			text: "Older turn reply",
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		socket?.emitChatEvent("target-session", clientTurnId, "chat_done", {
			reason: "completed",
			text: "My name is Recipe Bot.",
		});
		await expect(relay).resolves.toEqual({
			delivered: true,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			reply: "My name is Recipe Bot.",
		});
	});

	it("returns a queued target failure with its core error detail", async () => {
		respondToStartOr((socket, request) => {
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: undefined,
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");
		const relay = relayMessageBot(baseRequest);
		await vi.waitFor(() => expect(sockets[0]?.requests).toHaveLength(2));

		const socket = sockets[0];
		const clientTurnId = clientTurnIdOf(socket?.requests[1]);
		socket?.emitChatEvent("target-session", clientTurnId, "chat_core_log", {
			level: "error",
			message: "Provider authentication failed",
		});
		socket?.emitEvent("chat_session_status", {
			sessionId: "target-session",
			clientTurnId,
			status: "failed",
		});

		await expect(relay).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			error: '"Recipe Bot" ended with error: Provider authentication failed',
		});
	});

	it("acknowledges fire-and-forget only after the target accepts the queue", async () => {
		respondToStartOr((socket, request) => {
			expect(actionOf(request)).toBe("send");
			expect(
				(request.args?.request as { delivery?: string } | undefined)?.delivery,
			).toBe("queue");
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				queued: true,
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(
			relayMessageBot({ ...baseRequest, mode: "fire_and_forget" }),
		).resolves.toEqual({
			delivered: true,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
		});
	});

	it("surfaces a fire-and-forget queue rejection", async () => {
		respondToStartOr((socket, request) => {
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: {
					finishReason: "error",
					text: "Provider is not configured",
				},
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(
			relayMessageBot({ ...baseRequest, mode: "fire_and_forget" }),
		).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			error: '"Recipe Bot" ended with error: Provider is not configured',
		});
	});

	it("returns an immediate in-band runtime error instead of an empty reply", async () => {
		respondToStartOr((socket, request) => {
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: {
					finishReason: "error",
					text: "Model quota exceeded",
				},
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(relayMessageBot(baseRequest)).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			error: '"Recipe Bot" ended with error: Model quota exceeded',
		});
	});

	it("treats a completed turn with no text as an explicit failure", async () => {
		respondToStartOr((socket, request) => {
			socket.respond(request, {
				sessionId: "target-session",
				ok: true,
				result: { finishReason: "completed", text: "" },
			});
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(relayMessageBot(baseRequest)).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			error: '"Recipe Bot" completed without returning reply text',
		});
	});

	it("preserves a newly-created session id when delivery fails", async () => {
		respondToStartOr((socket, request) => {
			socket.fail(request, "target transport failed");
		});
		const { relayMessageBot } = await import("./use-message-bot-relay");

		await expect(relayMessageBot(baseRequest)).resolves.toEqual({
			delivered: false,
			botId: "recipe-bot",
			botName: "Recipe Bot",
			sessionId: "target-session",
			error: "target transport failed",
		});
	});
});
