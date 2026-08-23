import { resolve } from "node:path";
import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";
import type { HubConnectionAuthority } from "./command-transport";

function createSocket() {
	const messageListeners = new Set<(event: { data: string }) => void>();
	const closeListeners = new Set<() => void>();
	return {
		sent: [] as string[],
		send(data: string) {
			this.sent.push(data);
		},
		addEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.add(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.add(listener as () => void);
		},
		removeEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.delete(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.delete(listener as () => void);
		},
		emitMessage(data: string) {
			for (const listener of messageListeners) {
				void listener({ data });
			}
		},
		emitClose() {
			for (const listener of closeListeners) {
				listener();
			}
		},
	};
}

describe("BrowserWebSocketHubAdapter", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("ignores malformed websocket frames instead of throwing", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const adapter = new BrowserWebSocketHubAdapter(transport);
			adapter.attach(socket);

			await expect(async () => {
				socket.emitMessage("{bad json");
				await Promise.resolve();
			}).not.toThrow();

			expect(transport.command).not.toHaveBeenCalled();
			expect(socket.sent).toHaveLength(0);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					'"message":"rejected malformed websocket frame"',
				),
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("binds client identity to the Hub-authorized workspace", async () => {
		const transport = {
			command: vi.fn(
				async (
					envelope: HubCommandEnvelope,
					_authority?: HubConnectionAuthority,
				) => ({
					version: "v1" as const,
					requestId: envelope.requestId,
					ok: true,
				}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(
			transport,
			undefined,
			"/server-workspace",
		).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "register",
					clientId: "client-1",
					payload: {
						clientId: "client-1",
						clientType: "test",
						transport: "websocket",
						workspaceContext: {
							workspaceRoot: "/server-workspace",
							cwd: "/server-workspace/project",
						},
					},
				},
			}),
		);
		await vi.waitFor(() => expect(socket.sent).toHaveLength(1));

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "schedule.list",
					requestId: "list",
					clientId: "client-1",
				},
			}),
		);
		await vi.waitFor(() => expect(transport.command).toHaveBeenCalledTimes(2));
		expect(transport.command.mock.calls[1]?.[1]).toEqual({
			clientId: "client-1",
			workspaceContext: {
				workspaceRoot: resolve("/server-workspace"),
				cwd: resolve("/server-workspace/project"),
			},
		});

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "schedule.list",
					requestId: "spoofed",
					clientId: "other-client",
				},
			}),
		);
		await vi.waitFor(() =>
			expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: "spoofed",
					ok: false,
					error: {
						code: "client_authority_mismatch",
						message: "Command clientId does not belong to this connection.",
					},
				},
			}),
		);
		expect(transport.command).toHaveBeenCalledTimes(2);
	});

	it("rejects a client-declared workspace outside Hub authority", async () => {
		const transport = {
			command: vi.fn(async (envelope: HubCommandEnvelope) => ({
				version: "v1" as const,
				requestId: envelope.requestId,
				ok: true,
			})),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(
			transport,
			undefined,
			"/server-workspace",
		).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "register-spoofed-workspace",
					clientId: "client-1",
					payload: {
						clientId: "client-1",
						workspaceContext: {
							workspaceRoot: "/other-workspace",
						},
					},
				},
			}),
		);

		await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
		expect(JSON.parse(socket.sent[0] ?? "")).toMatchObject({
			kind: "reply",
			envelope: {
				ok: false,
				error: {
					code: "invalid_client_registration",
					message:
						"Registration workspace must match the Hub-authorized workspace",
				},
			},
		});
		expect(transport.command).not.toHaveBeenCalled();
	});

	it("allows a token-authenticated client to bind its registered workspace", async () => {
		const transport = {
			command: vi.fn(
				async (
					envelope: HubCommandEnvelope,
					_authority?: HubConnectionAuthority | null,
				) => ({
					version: "v1" as const,
					requestId: envelope.requestId,
					ok: true,
				}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(
			transport,
			undefined,
			"/daemon-workspace",
		).attach(socket, { allowRegisteredWorkspace: true });

		for (const [requestId, command] of [
			["register", "client.register"],
			["list", "schedule.list"],
		] as const) {
			socket.emitMessage(
				JSON.stringify({
					kind: "command",
					envelope: {
						version: "v1",
						command,
						requestId,
						clientId: "client-1",
						payload:
							command === "client.register"
								? {
										clientId: "client-1",
										clientType: "test",
										transport: "websocket",
										workspaceContext: {
											workspaceRoot: "/second-workspace",
											cwd: "/second-workspace/project",
										},
									}
								: undefined,
					},
				}),
			);
			await vi.waitFor(() =>
				expect(transport.command).toHaveBeenCalledTimes(
					requestId === "register" ? 1 : 2,
				),
			);
			if (requestId === "register") {
				await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
			}
		}

		expect(transport.command.mock.calls[1]?.[1]).toEqual({
			clientId: "client-1",
			workspaceContext: {
				workspaceRoot: resolve("/second-workspace"),
				cwd: resolve("/second-workspace/project"),
			},
		});
	});

	it("marks commands before registration as explicitly unauthorized", async () => {
		const transport = {
			command: vi.fn(async (envelope: HubCommandEnvelope) => ({
				version: "v1" as const,
				requestId: envelope.requestId,
				ok: false,
			})),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(
			transport,
			undefined,
			"/server-workspace",
		).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "schedule.list",
					requestId: "before-register",
					clientId: "spoofed-client",
				},
			}),
		);

		await vi.waitFor(() => expect(transport.command).toHaveBeenCalledOnce());
		expect(transport.command).toHaveBeenCalledWith(
			expect.objectContaining({ command: "schedule.list" }),
			null,
		);
	});

	it("keeps run.start open past the default command timeout", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		let resolveCommand: ((reply: HubReplyEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(
				() =>
					new Promise<HubReplyEnvelope>((resolve) => {
						resolveCommand = resolve;
					}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "run.start",
					requestId: "req-run",
					clientId: "client-1",
					sessionId: "session-1",
					payload: { input: "hello" },
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);
		expect(socket.sent).toHaveLength(0);

		resolveCommand?.({
			version: "v1",
			requestId: "req-run",
			ok: true,
			payload: { result: { finishReason: "completed" } },
		});
		await Promise.resolve();

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-run",
				ok: true,
				payload: { result: { finishReason: "completed" } },
			},
		});
	});

	it("applies the default command timeout to fast commands", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = {
			command: vi.fn(() => new Promise<HubReplyEnvelope>(() => {})),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.list",
					requestId: "req-list",
					clientId: "client-1",
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-list",
				ok: false,
				error: {
					code: "hub_command_timeout",
					message:
						"Hub command client.list did not complete within 30000ms. Check hub-daemon.log for command.start/command.slow logs with requestId req-list.",
				},
			},
		});
	});

	it("does not duplicate a pending approval replayed via both the live gate and the durable log", async () => {
		// Mirrors HubServerTransport.subscribe(): a pending approval predates
		// any durable-log append, so it's re-issued sequence-less through the
		// live listener (queued as a microtask, same as the real reissue).
		const pendingApproval: HubEventEnvelope = {
			version: "v1",
			event: "approval.requested",
			eventId: "hevt_pending_approval",
			sessionId: "session-1",
			timestamp: Date.now(),
			payload: { approvalId: "approval_1" },
		};
		// HubEventLogStore.append() returns a *new* object stamped with a
		// sequence rather than mutating the original — same eventId, though.
		const stampedApproval: HubEventEnvelope = {
			...pendingApproval,
			sequence: 1,
		};

		let replayCalls = 0;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(_clientId: string, listener: (event: HubEventEnvelope) => void) => {
					queueMicrotask(() => listener(pendingApproval));
					return () => {};
				},
			),
			replayEventsAfter: vi.fn(() => {
				replayCalls += 1;
				return replayCalls === 1 ? [stampedApproval] : [];
			}),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "late-reader",
				sessionId: "session-1",
				sinceSequence: 0,
			}),
		);

		const deadline = Date.now() + 2_000;
		while (transport.replayEventsAfter.mock.calls.length < 2 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 5));
		}
		// Let the buffered-flush finally-block run past the last replay page.
		await new Promise((r) => setTimeout(r, 25));

		const delivered = socket.sent
			.map((entry) => JSON.parse(entry))
			.filter(
				(frame) =>
					frame.kind === "event" &&
					frame.envelope.eventId === "hevt_pending_approval",
			);
		expect(delivered).toHaveLength(1);
	});

	it("advances the replay cursor past events skipped by eventId dedupe", async () => {
		// The same eventId appended twice to the durable log (e.g. a pending
		// approval re-issued and re-logged) used to wedge replay: the skipped
		// duplicate never advanced lastDelivered, so the same page was
		// refetched forever.
		const duplicate = (sequence: number): HubEventEnvelope => ({
			version: "v1",
			event: "approval.requested",
			eventId: "hevt_duplicated",
			sessionId: "session-1",
			timestamp: Date.now(),
			sequence,
		});
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			replayEventsAfter: vi.fn((sinceSequence: number) => {
				if (sinceSequence === 0) return [duplicate(1)];
				if (sinceSequence === 1) return [duplicate(2)];
				return [];
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "resumer",
				sessionId: "session-1",
				sinceSequence: 0,
			}),
		);

		await vi.waitFor(() =>
			expect(transport.replayEventsAfter).toHaveBeenCalledWith(2, {
				sessionId: "session-1",
				limit: 200,
			}),
		);
		expect(transport.replayEventsAfter).toHaveBeenCalledTimes(3);
		const delivered = socket.sent
			.map((entry) => JSON.parse(entry))
			.filter((frame) => frame.kind === "event");
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.envelope.sequence).toBe(1);
	});

	it("stops replay when a misbehaving source never advances the cursor", async () => {
		const stuck: HubEventEnvelope = {
			version: "v1",
			event: "assistant.delta",
			eventId: "hevt_stuck",
			sessionId: "session-1",
			timestamp: Date.now(),
			sequence: 1,
		};
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			// Always returns the same non-empty page regardless of the cursor.
			replayEventsAfter: vi.fn(() => [stuck]),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "resumer",
				sessionId: "session-1",
				sinceSequence: 0,
			}),
		);

		await vi.waitFor(() =>
			expect(transport.replayEventsAfter).toHaveBeenCalledTimes(2),
		);
		// Give a would-be third iteration time to run; the guard must break out.
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(transport.replayEventsAfter).toHaveBeenCalledTimes(2);
		const delivered = socket.sent
			.map((entry) => JSON.parse(entry))
			.filter((frame) => frame.kind === "event");
		expect(delivered).toHaveLength(1);
	});

	it("drops replay dedupe state once the buffered flush completes", async () => {
		const stamped: HubEventEnvelope = {
			version: "v1",
			event: "approval.requested",
			eventId: "hevt_reissued",
			sessionId: "session-1",
			timestamp: Date.now(),
			sequence: 1,
		};
		let liveListener: ((event: HubEventEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(_clientId: string, listener: (event: HubEventEnvelope) => void) => {
					liveListener = listener;
					return () => {};
				},
			),
			replayEventsAfter: vi.fn((sinceSequence: number) =>
				sinceSequence === 0 ? [stamped] : [],
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "late-reader",
				sessionId: "session-1",
				sinceSequence: 0,
			}),
		);
		await vi.waitFor(() =>
			expect(transport.replayEventsAfter).toHaveBeenCalledTimes(2),
		);
		// Let the buffered-flush finally-block complete.
		await new Promise((resolve) => setTimeout(resolve, 25));

		// A live re-issue after replay (sequence-less, e.g. a pending approval
		// re-raised much later) follows the live-only contract: it is delivered,
		// not swallowed by replay-era dedupe state.
		liveListener?.({ ...stamped, sequence: undefined });
		const delivered = socket.sent
			.map((entry) => JSON.parse(entry))
			.filter(
				(frame) =>
					frame.kind === "event" &&
					frame.envelope.eventId === "hevt_reissued",
			);
		expect(delivered).toHaveLength(2);
	});
});
