import type { HubEventEnvelope } from "@cline/shared";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HubClient,
	type HubClientDiagnostic,
	type HubConnectionStateChange,
} from "./client";
import {
	HubMalformedReplyError,
	HubTransportError,
	IncompatibleProtocolError,
} from "./errors";
import type { HubSocketRequestOptions, WebSocketLike } from "./socket";

type Listener = (...args: unknown[]) => void;

type SentFrame = {
	kind: string;
	clientId?: string;
	sessionId?: string;
	envelope?: {
		command?: string;
		requestId?: string;
		payload?: Record<string, unknown>;
	};
};

type ScriptedError = {
	code: string;
	message: string;
	details?: Record<string, unknown>;
};

class ScriptedSocket implements WebSocketLike {
	static instances: ScriptedSocket[] = [];
	static autoReplyRegister = true;
	/** Payload the auto-reply returns for `client.register`. */
	static registerReplyPayload: Record<string, unknown> = {};
	/** When set, `client.register` is auto-replied not-ok with this error. */
	static registerReplyError: ScriptedError | undefined;

	readyState = 0;
	readonly sent: string[] = [];
	readonly url: string;
	readonly protocols: string | string[] | undefined;
	readonly options: HubSocketRequestOptions | undefined;
	private readonly listeners = new Map<string, Set<Listener>>();

	constructor(
		url: string,
		protocols?: string | string[],
		options?: HubSocketRequestOptions,
	) {
		this.url = url;
		this.protocols = protocols;
		this.options = options;
		ScriptedSocket.instances.push(this);
	}

	static reset(): void {
		ScriptedSocket.instances = [];
		ScriptedSocket.autoReplyRegister = true;
		ScriptedSocket.registerReplyPayload = {};
		ScriptedSocket.registerReplyError = undefined;
	}

	static latest(): ScriptedSocket {
		const socket = ScriptedSocket.instances.at(-1);
		if (!socket) {
			throw new Error("no scripted socket was constructed");
		}
		return socket;
	}

	send(data: string): void {
		this.sent.push(data);
		const frame = JSON.parse(data) as SentFrame;
		if (
			ScriptedSocket.autoReplyRegister &&
			frame.kind === "command" &&
			frame.envelope?.command === "client.register" &&
			frame.envelope.requestId
		) {
			const requestId = frame.envelope.requestId;
			const error = ScriptedSocket.registerReplyError;
			queueMicrotask(() => {
				if (error) {
					this.replyError(requestId, error);
					return;
				}
				this.replyOk(requestId, ScriptedSocket.registerReplyPayload);
			});
		}
	}

	close(): void {
		if (this.readyState === 3) {
			return;
		}
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	addEventListener(type: string, listener: Listener): void {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	open(): void {
		this.readyState = 1;
		this.emit("open");
	}

	remoteClose(code = 1006, reason = "gone"): void {
		this.readyState = 3;
		this.emit("close", { code, reason });
	}

	deliver(data: unknown): void {
		this.emit("message", data);
	}

	replyOk(requestId: string, payload: Record<string, unknown> = {}): void {
		this.deliver({
			data: JSON.stringify({
				kind: "reply",
				envelope: { version: "v1", requestId, ok: true, payload },
			}),
		});
	}

	replyError(requestId: string, error: ScriptedError): void {
		this.deliver({
			data: JSON.stringify({
				kind: "reply",
				envelope: { version: "v1", requestId, ok: false, error },
			}),
		});
	}

	frames(): SentFrame[] {
		return this.sent.map((raw) => JSON.parse(raw) as SentFrame);
	}

	pendingRequestId(command: string): string {
		const frame = this.frames().find(
			(candidate) => candidate.envelope?.command === command,
		);
		const requestId = frame?.envelope?.requestId;
		if (!requestId) {
			throw new Error(`no ${command} command was sent`);
		}
		return requestId;
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(payload);
		}
	}
}

function newClient(
	overrides: Partial<ConstructorParameters<typeof HubClient>[0]> = {},
): HubClient {
	return new HubClient({
		url: "ws://127.0.0.1:25463/hub",
		WebSocketImpl: ScriptedSocket,
		...overrides,
	});
}

async function flush(times = 6): Promise<void> {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
}

async function connected(client: HubClient): Promise<ScriptedSocket> {
	const promise = client.connect();
	const socket = ScriptedSocket.latest();
	socket.open();
	await promise;
	return socket;
}

afterEach(() => {
	ScriptedSocket.reset();
	vi.useRealTimers();
});

describe("HubClient connect", () => {
	it("registers the client and reports connected state", async () => {
		const client = newClient({ clientType: "mobile", displayName: "Mobile" });
		const socket = await connected(client);
		expect(client.isConnected()).toBe(true);
		expect(client.getConnectionError()).toBeNull();
		const register = socket
			.frames()
			.find((frame) => frame.envelope?.command === "client.register");
		expect(register?.envelope?.payload).toMatchObject({
			clientId: client.getClientId(),
			clientType: "mobile",
			displayName: "Mobile",
			transport: "native",
			actorKind: "client",
			protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
		});
	});

	it("passes the local-hub subprotocol when a credential is supplied", async () => {
		const client = newClient({
			authMode: "hub-subprotocol",
			credential: "tok",
		});
		const socket = await connected(client);
		expect(socket.protocols).toEqual(["cline-hub-auth.tok"]);
		expect(socket.options).toBeUndefined();
	});

	it("passes an Authorization header in bearer-header mode", async () => {
		const client = newClient({ authMode: "bearer-header", credential: "tok" });
		const socket = await connected(client);
		expect(socket.protocols).toBeUndefined();
		expect(socket.options).toEqual({
			headers: { Authorization: "Bearer tok" },
		});
	});

	it("times out when the socket never opens", async () => {
		vi.useFakeTimers();
		const client = newClient();
		const promise = client.connect();
		const expectation = expect(promise).rejects.toMatchObject({
			name: "HubTransportError",
			code: "hub_connect_timeout",
		});
		await vi.advanceTimersByTimeAsync(8_001);
		await expectation;
	});
});

describe("HubClient protocol handshake", () => {
	it("exposes the protocol metadata and capabilities from the register reply", async () => {
		ScriptedSocket.registerReplyPayload = {
			clientId: "client-1",
			protocol: {
				protocolVersion: "v1",
				minClientProtocolVersion: "v1",
				maxClientProtocolVersion: "v1",
			},
			capabilities: ["approval.list_pending"],
		};
		const client = newClient();
		await connected(client);

		expect(client.getServerProtocol()).toEqual({
			protocolVersion: "v1",
			minClientProtocolVersion: "v1",
			maxClientProtocolVersion: "v1",
		});
		expect(client.hasCapability("approval.list_pending")).toBe(true);
		expect(client.hasCapability("session.teleport")).toBe(false);
	});

	it("tolerates a legacy reply without protocol metadata", async () => {
		ScriptedSocket.registerReplyPayload = { clientId: "client-1" };
		const client = newClient();
		await connected(client);

		expect(client.isConnected()).toBe(true);
		expect(client.getServerProtocol()).toBeUndefined();
		expect(client.hasCapability("approval.list_pending")).toBe(false);
	});

	it("fails connect with IncompatibleProtocolError and never retries", async () => {
		vi.useFakeTimers();
		ScriptedSocket.registerReplyError = {
			code: HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
			message: "Hub protocol v1 does not support client protocol v2",
			details: {
				serverProtocolVersion: "v1",
				minClientProtocolVersion: "v1",
				maxClientProtocolVersion: "v1",
				clientProtocolVersion: "v2",
			},
		};
		const client = newClient();
		// An active subscription is what normally arms the reconnect loop.
		client.subscribe(() => {});

		const promise = client.connect();
		const socket = ScriptedSocket.latest();
		socket.open();
		const failure = await promise.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IncompatibleProtocolError);
		expect(failure).toMatchObject({
			name: "IncompatibleProtocolError",
			code: HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
			details: {
				serverProtocolVersion: "v1",
				minClientProtocolVersion: "v1",
				maxClientProtocolVersion: "v1",
				clientProtocolVersion: "v2",
			},
		});
		expect(client.isConnected()).toBe(false);
		expect(socket.readyState).toBe(3);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(ScriptedSocket.instances).toHaveLength(1);
	});

	it("rejects later connect and command attempts with the same error", async () => {
		ScriptedSocket.registerReplyError = {
			code: HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
			message: "incompatible",
		};
		const client = newClient();
		const promise = client.connect();
		ScriptedSocket.latest().open();
		await expect(promise).rejects.toBeInstanceOf(IncompatibleProtocolError);

		await expect(client.connect()).rejects.toBeInstanceOf(
			IncompatibleProtocolError,
		);
		await expect(client.command("client.list")).rejects.toBeInstanceOf(
			IncompatibleProtocolError,
		);
		expect(ScriptedSocket.instances).toHaveLength(1);
	});
});

describe("HubClient command correlation", () => {
	it("observes each actual concurrent wire request before its delayed reply", async () => {
		const client = newClient();
		const socket = await connected(client);
		const firstSent = vi.fn();
		const secondSent = vi.fn();
		const first = client.command(
			"session.send_input",
			{ prompt: "first" },
			"s1",
			{ onSent: firstSent },
		);
		const second = client.command("session.get", {}, "s1", {
			onSent: secondSent,
		});
		expect(firstSent).not.toHaveBeenCalled();
		await flush();
		const firstId = socket.pendingRequestId("session.send_input");
		const secondId = socket.pendingRequestId("session.get");
		expect(firstSent).toHaveBeenCalledExactlyOnceWith(firstId);
		expect(secondSent).toHaveBeenCalledExactlyOnceWith(secondId);
		expect(firstId).not.toBe(secondId);
		socket.replyOk(secondId);
		socket.replyOk(firstId);
		await Promise.all([first, second]);
	});
	it("keeps observer exceptions diagnostic instead of failing an already sent command", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		const command = client.command("session.get", {}, "s1", {
			onSent: () => {
				throw new Error("observer failed");
			},
		});
		await flush();
		socket.replyOk(socket.pendingRequestId("session.get"));
		await expect(command).resolves.toMatchObject({ ok: true });
		expect(diagnostics).toContainEqual({
			type: "listener_error",
			reason: "listener_threw",
			detail: "observer failed",
		});
	});
	it("does not report a send when the socket write throws", async () => {
		const client = newClient();
		const socket = await connected(client);
		const onSent = vi.fn();
		vi.spyOn(socket, "send").mockImplementationOnce(() => {
			throw new Error("socket write failed");
		});
		await expect(
			client.command("session.get", {}, "s1", { onSent }),
		).rejects.toThrow("socket write failed");
		expect(onSent).not.toHaveBeenCalled();
	});
	it("reports a distinct wire request id for each transport recovery attempt", async () => {
		class RecoveringClient extends HubClient {
			protected override isTransportRecoverable(): boolean {
				return true;
			}
			protected override async resolveRecoveredUrl(): Promise<string> {
				return "ws://127.0.0.1:25464/hub";
			}
		}
		const client = new RecoveringClient({
			url: "ws://127.0.0.1:25463/hub",
			WebSocketImpl: ScriptedSocket,
		});
		const first = await connected(client);
		const onSent = vi.fn();
		const command = client.command(
			"session.send_input",
			{ prompt: "recover" },
			"s1",
			{ onSent },
		);
		await flush();
		const firstId = first.pendingRequestId("session.send_input");
		first.remoteClose();
		await flush(20);
		const second = ScriptedSocket.latest();
		expect(second).not.toBe(first);
		second.open();
		await flush(20);
		const secondId = second.pendingRequestId("session.send_input");
		expect(secondId).not.toBe(firstId);
		expect(onSent.mock.calls).toEqual([[firstId], [secondId]]);
		second.replyOk(secondId, { result: {} });
		await expect(command).resolves.toMatchObject({ ok: true });
	});
	it("resolves concurrent commands against their own requestIds", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const first = client.command("client.list");
		const second = client.command("session.list");
		await flush();

		const firstId = socket.pendingRequestId("client.list");
		const secondId = socket.pendingRequestId("session.list");
		expect(firstId).not.toBe(secondId);

		socket.replyOk(secondId, { sessions: ["b"] });
		socket.replyOk(firstId, { clients: ["a"] });

		await expect(first).resolves.toMatchObject({ payload: { clients: ["a"] } });
		await expect(second).resolves.toMatchObject({
			payload: { sessions: ["b"] },
		});
	});

	it("rejects with a command error when the hub replies not-ok", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("client.list");
		await flush();
		const requestId = socket.pendingRequestId("client.list");
		socket.deliver({
			data: JSON.stringify({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId,
					ok: false,
					error: { code: "boom", message: "kaboom" },
				},
			}),
		});
		await expect(promise).rejects.toMatchObject({
			name: "HubCommandError",
			code: "boom",
			message: "kaboom",
		});
	});

	it("maps session_not_found replies onto SessionNotFoundError", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("session.get", { sessionId: "ses_1" });
		await flush();
		const requestId = socket.pendingRequestId("session.get");
		socket.deliver({
			data: JSON.stringify({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId,
					ok: false,
					error: { code: "session_not_found", message: "gone" },
				},
			}),
		});
		await expect(promise).rejects.toMatchObject({
			name: "SessionNotFoundError",
			sessionId: "ses_1",
		});
	});

	it("times out a command that never receives a reply", async () => {
		vi.useFakeTimers();
		const client = newClient();
		await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("client.list");
		const expectation = expect(promise).rejects.toThrow(
			"Hub command client.list timed out after 30000ms",
		);
		await vi.advanceTimersByTimeAsync(30_001);
		await expectation;
	});

	it("honours timeoutMs: null opt-outs", async () => {
		vi.useFakeTimers();
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("client.list", undefined, undefined, {
			timeoutMs: null,
		});
		await vi.advanceTimersByTimeAsync(60_000);
		let settled = false;
		void promise.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		await flush();
		expect(settled).toBe(false);

		socket.replyOk(socket.pendingRequestId("client.list"), { clients: [] });
		await expect(promise).resolves.toMatchObject({ ok: true });
	});
});

describe("HubClient.listPendingApprovals", () => {
	it("issues approval.list_pending and returns the approvals array", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.listPendingApprovals("ses_a");
		await flush();
		const frame = socket
			.frames()
			.find((entry) => entry.envelope?.command === "approval.list_pending");
		expect(frame?.envelope?.payload).toEqual({ sessionId: "ses_a" });
		socket.replyOk(socket.pendingRequestId("approval.list_pending"), {
			approvals: [{ approvalId: "apr_1" }],
		});
		await expect(promise).resolves.toEqual([{ approvalId: "apr_1" }]);
	});

	it("returns an empty array for an authoritative empty snapshot", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.listPendingApprovals();
		await flush();
		socket.replyOk(socket.pendingRequestId("approval.list_pending"), {
			approvals: [],
		});
		await expect(promise).resolves.toEqual([]);
	});

	it("throws when the hub omits the approvals array", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.listPendingApprovals();
		await flush();
		socket.replyOk(socket.pendingRequestId("approval.list_pending"), {});
		await expect(promise).rejects.toBeInstanceOf(HubMalformedReplyError);
	});

	it("throws when an approval entry is malformed", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.listPendingApprovals();
		await flush();
		socket.replyOk(socket.pendingRequestId("approval.list_pending"), {
			approvals: [{ toolName: "bash" }],
		});
		await expect(promise).rejects.toBeInstanceOf(HubMalformedReplyError);
	});
});

describe("HubClient subscriptions", () => {
	it("fans out events and honours session scoping", async () => {
		const client = newClient();
		const socket = await connected(client);
		const global: string[] = [];
		const scoped: string[] = [];
		client.subscribe((event) => global.push(event.sessionId ?? "-"));
		client.subscribe((event) => scoped.push(event.sessionId ?? "-"), {
			sessionId: "ses_a",
		});

		const emit = (sessionId?: string) =>
			socket.deliver({
				data: JSON.stringify({
					kind: "event",
					envelope: {
						version: "v1",
						event: "session.updated",
						sessionId,
						payload: {},
					} satisfies Partial<HubEventEnvelope>,
				}),
			});

		emit("ses_a");
		emit("ses_b");
		emit(undefined);

		expect(global).toEqual(["ses_a", "ses_b", "-"]);
		expect(scoped).toEqual(["ses_a"]);
	});

	it("sends subscribe and unsubscribe frames for scoped listeners", async () => {
		const client = newClient();
		const socket = await connected(client);
		const dispose = client.subscribe(() => {}, { sessionId: "ses_a" });
		expect(
			socket
				.frames()
				.filter(
					(frame) =>
						frame.kind === "stream.subscribe" && frame.sessionId === "ses_a",
				),
		).toHaveLength(1);
		dispose();
		expect(
			socket
				.frames()
				.filter(
					(frame) =>
						frame.kind === "stream.unsubscribe" && frame.sessionId === "ses_a",
				),
		).toHaveLength(1);
	});

	it("reconnects with backoff and resubscribes active listeners", async () => {
		vi.useFakeTimers();
		const client = newClient();
		const first = await connected(client);
		client.subscribe(() => {}, { sessionId: "ses_a" });
		client.subscribe(() => {});

		first.remoteClose();
		expect(ScriptedSocket.instances).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(500);
		expect(ScriptedSocket.instances).toHaveLength(2);
		const second = ScriptedSocket.latest();
		second.open();
		await vi.advanceTimersByTimeAsync(1);

		const kinds = second.frames();
		expect(kinds[0]?.envelope?.command).toBe("client.register");
		const resubscribed = kinds
			.filter((frame) => frame.kind === "stream.subscribe")
			.map((frame) => frame.sessionId ?? "*");
		expect(resubscribed.sort()).toEqual(["*", "ses_a"]);
		expect(client.isConnected()).toBe(true);
	});

	it("does not reconnect when the client closed the socket", async () => {
		vi.useFakeTimers();
		const client = newClient();
		await connected(client);
		client.subscribe(() => {});
		client.close();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(ScriptedSocket.instances).toHaveLength(1);
	});
});

describe("HubClient close", () => {
	it("rejects pending replies with a transport error", async () => {
		const client = newClient();
		await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("client.list");
		await flush();
		client.close();
		await expect(promise).rejects.toBeInstanceOf(HubTransportError);
		await expect(promise).rejects.toMatchObject({
			code: "hub_connection_closed",
		});
		expect(client.isConnected()).toBe(false);
	});

	it("rejects pending replies when the socket closes remotely", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;

		const promise = client.command("client.list");
		await flush();
		socket.remoteClose(1006, "boom");
		await expect(promise).rejects.toMatchObject({
			code: "hub_connection_closed",
			message: "Hub connection closed (code=1006, reason=boom)",
		});
	});

	it("unregisters before closing on dispose", async () => {
		const client = newClient();
		const socket = await connected(client);
		ScriptedSocket.autoReplyRegister = false;
		const dispose = client.dispose();
		await flush();
		socket.replyOk(socket.pendingRequestId("client.unregister"));
		await dispose;
		expect(socket.readyState).toBe(3);
	});
});

describe("HubClient malformed frames", () => {
	it("drops invalid JSON without throwing and reports a diagnostic", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		const received: HubEventEnvelope[] = [];
		client.subscribe((event) => received.push(event));

		expect(() => socket.deliver({ data: "{not json" })).not.toThrow();
		expect(diagnostics).toEqual([
			expect.objectContaining({
				type: "malformed_frame",
				reason: "invalid_json",
			}),
		]);
		expect(client.getDroppedFrameCount()).toBe(1);

		socket.deliver({
			data: JSON.stringify({
				kind: "event",
				envelope: { version: "v1", event: "ping", payload: {} },
			}),
		});
		expect(received).toHaveLength(1);
	});

	it("drops frames with an unusable shape", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		socket.deliver({ data: JSON.stringify({ nope: true }) });
		socket.deliver({ data: JSON.stringify([1, 2, 3]) });
		expect(diagnostics.map((entry) => entry.reason)).toEqual([
			"invalid_shape",
			"invalid_shape",
		]);
		expect(client.getDroppedFrameCount()).toBe(2);
	});

	it("drops undecodable binary payloads", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		socket.deliver({ data: { arrayBuffer: () => Promise.resolve(null) } });
		expect(diagnostics.map((entry) => entry.reason)).toEqual([
			"undecodable_data",
		]);
	});

	it("never lets a listener throw escape the socket handler", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		client.subscribe(() => {
			throw new Error("listener exploded");
		});
		expect(() =>
			socket.deliver({
				data: JSON.stringify({
					kind: "event",
					envelope: { version: "v1", event: "ping", payload: {} },
				}),
			}),
		).not.toThrow();
		expect(diagnostics.map((entry) => entry.type)).toEqual(["listener_error"]);
	});

	it("decodes binary text frames delivered as Uint8Array", async () => {
		const client = newClient();
		const socket = await connected(client);
		const received: HubEventEnvelope[] = [];
		client.subscribe((event) => received.push(event));
		socket.deliver({
			data: new TextEncoder().encode(
				JSON.stringify({
					kind: "event",
					envelope: { version: "v1", event: "ping", payload: {} },
				}),
			),
		});
		expect(received).toHaveLength(1);
	});
});

describe("HubClient frame shape validation", () => {
	/**
	 * A recognized `kind` used to be enough to reach dispatch, so a frame like
	 * `{"kind":"reply"}` threw a TypeError inside the socket `message` handler
	 * instead of being dropped with a diagnostic.
	 */
	it("drops recognized kinds whose envelope cannot be dispatched", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		const received: HubEventEnvelope[] = [];
		client.subscribe((event) => received.push(event));

		const malformed = [
			{ kind: "reply" },
			{ kind: "event" },
			{ kind: "command" },
			{ kind: "reply", envelope: null },
			{ kind: "reply", envelope: [] },
			{ kind: "reply", envelope: { version: "v1", ok: true } },
			{ kind: "event", envelope: "nope" },
			{
				kind: "event",
				envelope: { version: "v1", event: "ping", sessionId: 7 },
			},
		];
		for (const frame of malformed) {
			expect(() =>
				socket.deliver({ data: JSON.stringify(frame) }),
			).not.toThrow();
		}

		expect(diagnostics).toHaveLength(malformed.length);
		expect(new Set(diagnostics.map((entry) => entry.reason))).toEqual(
			new Set(["invalid_shape"]),
		);
		expect(client.getDroppedFrameCount()).toBe(malformed.length);
		expect(received).toHaveLength(0);

		// Control: a well-shaped event still reaches subscribers afterwards.
		socket.deliver({
			data: JSON.stringify({
				kind: "event",
				envelope: { version: "v1", event: "ping", sessionId: "ses_a" },
			}),
		});
		expect(received).toHaveLength(1);
		expect(client.getDroppedFrameCount()).toBe(malformed.length);
	});

	it("keeps subscription frames dispatchable without an envelope", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		socket.deliver({
			data: JSON.stringify({ kind: "stream.subscribe", clientId: "c1" }),
		});
		expect(diagnostics).toHaveLength(0);
		expect(client.getDroppedFrameCount()).toBe(0);
	});

	it("drops frames larger than maxFrameBytes before parsing them", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			maxFrameBytes: 512,
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		const received: HubEventEnvelope[] = [];
		client.subscribe((event) => received.push(event));

		const oversized = JSON.stringify({
			kind: "event",
			envelope: {
				version: "v1",
				event: "assistant.delta",
				payload: { text: "x".repeat(2_000) },
			},
		});
		expect(() => socket.deliver({ data: oversized })).not.toThrow();

		expect(diagnostics).toEqual([
			{
				type: "oversized_frame",
				reason: "oversized_frame",
				size: oversized.length,
				limit: 512,
				detail: expect.any(String),
			},
		]);
		expect(client.getDroppedFrameCount()).toBe(1);
		expect(received).toHaveLength(0);

		// Under-limit frames are untouched by the guard.
		socket.deliver({
			data: JSON.stringify({
				kind: "event",
				envelope: { version: "v1", event: "ping" },
			}),
		});
		expect(received).toHaveLength(1);
	});
});

describe("HubClient connection state observability", () => {
	it("increments the epoch across a drop and an internal reconnect", async () => {
		vi.useFakeTimers();
		const changes: HubConnectionStateChange[] = [];
		const client = newClient({
			onConnectionState: (change) => changes.push(change),
		});
		expect(client.getConnectionEpoch()).toBe(0);

		const first = await connected(client);
		client.subscribe(() => {});
		expect(changes.map((change) => change.state)).toEqual([
			"connecting",
			"connected",
		]);
		expect(changes.at(-1)?.connectionEpoch).toBe(1);
		expect(client.getConnectionEpoch()).toBe(1);

		first.remoteClose();
		expect(changes.at(-1)).toMatchObject({
			state: "reconnecting",
			connectionEpoch: 1,
		});

		await vi.advanceTimersByTimeAsync(500);
		const second = ScriptedSocket.latest();
		expect(second).not.toBe(first);
		second.open();
		await vi.advanceTimersByTimeAsync(1);

		expect(changes.map((change) => change.state)).toEqual([
			"connecting",
			"connected",
			"reconnecting",
			"connecting",
			"connected",
		]);
		// A consumer that only ever compares epochs still sees the reconnect.
		expect(changes.at(-1)?.connectionEpoch).toBe(2);
		expect(client.getConnectionEpoch()).toBe(2);
	});

	it("emits a new epoch for the close+connect cycle transport recovery uses", async () => {
		const changes: HubConnectionStateChange[] = [];
		const client = newClient({
			onConnectionState: (change) => changes.push(change),
		});
		await connected(client);
		client.close();
		await connected(client);
		expect(changes.map((change) => change.state)).toEqual([
			"connecting",
			"connected",
			"closed",
			"connecting",
			"connected",
		]);
		expect(changes.map((change) => change.connectionEpoch)).toEqual([
			0, 1, 1, 1, 2,
		]);
	});

	it("stops emitting after dispose", async () => {
		const changes: HubConnectionStateChange[] = [];
		const client = newClient({
			onConnectionState: (change) => changes.push(change),
		});
		const socket = await connected(client);
		await client.dispose();
		expect(changes.map((change) => change.state)).toEqual([
			"connecting",
			"connected",
			"closed",
		]);

		socket.remoteClose();
		await connected(client);
		expect(changes.map((change) => change.state)).toEqual([
			"connecting",
			"connected",
			"closed",
		]);
	});

	it("stays in reconnecting while retries keep failing", async () => {
		vi.useFakeTimers();
		const changes: HubConnectionStateChange[] = [];
		const client = newClient({
			onConnectionState: (change) => changes.push(change),
		});
		const first = await connected(client);
		client.subscribe(() => {});
		first.remoteClose();

		// Let the retry fire and time out without ever opening.
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(8_001);

		expect(changes.slice(0, 4).map((change) => change.state)).toEqual([
			"connecting",
			"connected",
			"reconnecting",
			"connecting",
		]);
		// A retry that failed is not a terminal `closed`.
		expect(changes.every((change) => change.state !== "closed")).toBe(true);
		expect(client.getConnectionEpoch()).toBe(1);
		// One socket per attempt: a retry never races a second socket alongside an
		// attempt that is still connecting.
		expect(ScriptedSocket.instances).toHaveLength(
			changes.filter((change) => change.state === "connecting").length,
		);
	});

	it("never lets an onConnectionState listener throw into the socket", async () => {
		const client = newClient({
			onConnectionState: () => {
				throw new Error("observer exploded");
			},
		});
		await expect(connected(client)).resolves.toBeDefined();
		expect(client.isConnected()).toBe(true);
	});
});

describe("HubClient registration gating", () => {
	it("re-registers instead of reusing a connection whose register failed", async () => {
		ScriptedSocket.registerReplyError = {
			code: "client_id_in_use",
			message: "id held elsewhere",
		};
		const client = newClient();
		const failing = client.connect();
		ScriptedSocket.latest().open();
		await expect(failing).rejects.toThrow();
		expect(client.isConnected()).toBe(false);
		const firstSocket = ScriptedSocket.latest();

		// The socket is still open, so a connect() that only looks at readyState
		// short-circuits and wedges the client as permanently unregistered.
		ScriptedSocket.registerReplyError = undefined;
		const retry = client.connect();
		await flush();
		const secondSocket = ScriptedSocket.latest();
		expect(secondSocket).not.toBe(firstSocket);
		secondSocket.open();
		await retry;

		expect(client.isConnected()).toBe(true);
	});

	it("sends client.register before any command that races the first connect", async () => {
		const client = newClient();
		const command = client.command("approval.respond", {
			approvalId: "approval-1",
			approved: true,
		});
		const socket = ScriptedSocket.latest();
		socket.open();
		await vi.waitFor(() =>
			expect(socket.pendingRequestId("approval.respond")).toBeTruthy(),
		);
		socket.replyOk(socket.pendingRequestId("approval.respond"));
		await command;

		expect(socket.frames().map((frame) => frame.envelope?.command)).toEqual([
			"client.register",
			"approval.respond",
		]);
	});
});

describe("HubClient frame size accounting", () => {
	it("measures the frame in bytes rather than UTF-16 code units", async () => {
		const diagnostics: HubClientDiagnostic[] = [];
		const client = newClient({
			maxFrameBytes: 200,
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const socket = await connected(client);
		const events: HubEventEnvelope[] = [];
		client.subscribe((event) => events.push(event));

		// Three-byte characters: fewer UTF-16 units than bytes, so a length-based
		// check waves the frame past a byte budget it actually blows.
		const frame = JSON.stringify({
			kind: "event",
			envelope: {
				version: "v1",
				event: "session.notice",
				payload: { text: "あ".repeat(50) },
			},
		});
		expect(frame.length).toBeLessThanOrEqual(200);
		expect(new TextEncoder().encode(frame).byteLength).toBeGreaterThan(200);
		socket.deliver({ data: frame });
		await flush();

		expect(events).toHaveLength(0);
		expect(diagnostics.map((diagnostic) => diagnostic.reason)).toContain(
			"oversized_frame",
		);
	});
});
