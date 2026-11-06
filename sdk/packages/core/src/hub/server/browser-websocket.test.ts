import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function createHistorySocket() {
	const socket = createSocket();
	return {
		...socket,
		command(
			requestId: string,
			command: HubCommandEnvelope["command"],
			payload: Record<string, unknown> = {},
			fields: Record<string, unknown> = {},
		) {
			socket.emitMessage(
				JSON.stringify({
					kind: "command",
					envelope: {
						version: "v1",
						clientId: "client-1",
						sessionId: "session-1",
						requestId,
						command,
						payload,
						...fields,
					},
				}),
			);
		},
		reply(requestId: string): HubReplyEnvelope | undefined {
			return socket.sent
				.map((frame) => JSON.parse(frame).envelope as HubReplyEnvelope)
				.find((reply) => reply.requestId === requestId);
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("BrowserWebSocketHubAdapter history", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "hub-browser-history-"));
		vi.stubEnv("CLINE_DATA_DIR", directory);
	});
	it.each([
		"cancel",
		"unregister",
		"close",
	] as const)("%s cancels queued history and never sends an abandoned full reply", async (mode) => {
		vi.useFakeTimers();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const finishers: Array<(reply: HubReplyEnvelope) => void> = [];
		const transport = {
			command: vi.fn(
				(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> => {
					if (envelope.command === "session.messages")
						return new Promise((resolve) => {
							finishers.push((reply) =>
								resolve({ ...reply, requestId: envelope.requestId }),
							);
						});
					return Promise.resolve({
						version: "v1",
						requestId: envelope.requestId,
						ok: true,
					});
				},
			),
			subscribe: vi.fn(),
		};
		const socket = createHistorySocket();
		const detach = new BrowserWebSocketHubAdapter(transport).attach(socket);
		const send = socket.command;
		const response = socket.reply;
		try {
			send("register", "client.register", { clientId: "client-1" });
			await vi.waitFor(() => expect(response("register")?.ok).toBe(true));
			for (let i = 0; i < 3; i++)
				send(`history-${i}`, "session.messages", { chunkHistory: true });
			expect(finishers).toHaveLength(2);
			if (mode === "cancel") {
				for (let i = 0; i < 3; i++)
					socket.emitMessage(
						JSON.stringify({
							kind: "history.cancel",
							clientId: "client-1",
							sessionId: "session-1",
							requestId: `history-${i}`,
						}),
					);
			} else if (mode === "unregister") {
				send("unregister", "client.unregister");
				await vi.waitFor(() => expect(response("unregister")?.ok).toBe(true));
			} else socket.emitClose();
			await vi.advanceTimersByTimeAsync(30_001);
			expect(errors).not.toHaveBeenCalled();
			for (let i = 0; i < 3; i++) {
				const reply = response(`history-${i}`);
				if (mode === "close") expect(reply).toBeUndefined();
				else {
					expect(reply).toMatchObject({
						ok: false,
						error: { code: "history_transfer_closed" },
					});
					expect(reply?.payload).toBeUndefined();
				}
			}
			const repliesBeforeLateRead = [...socket.sent];
			for (const finish of finishers)
				finish({
					version: "v1",
					ok: true,
					payload: { messages: ["x".repeat(200_000)] },
				});
			await vi.advanceTimersByTimeAsync(0);
			expect(socket.sent).toEqual(repliesBeforeLateRead);
			expect(finishers).toHaveLength(2);
		} finally {
			detach();
		}
	});

	it("rejects malformed history without blocking chunked or legacy reads", async () => {
		const messages = [{ role: "user", content: "saved text ".repeat(30_000) }];
		const transport = {
			command: vi.fn(
				async (envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> => ({
					version: "v1",
					requestId: envelope.requestId,
					ok: true,
					payload: envelope.command === "session.messages" ? { messages } : {},
				}),
			),
			subscribe: vi.fn(),
		};
		const socket = createHistorySocket();
		const detach = new BrowserWebSocketHubAdapter(transport).attach(socket);
		const send = async (
			command: HubCommandEnvelope["command"],
			payload: Record<string, string | boolean> = {},
			fields: {
				sessionId?: unknown;
				clientId?: string;
				requestId?: unknown;
			} = {},
		) => {
			const count = socket.sent.length;
			socket.command(`req-${count}`, command, payload, fields);
			await vi.waitFor(() => expect(socket.sent.length).toBe(count + 1));
			return JSON.parse(socket.sent[count]).envelope as HubReplyEnvelope;
		};
		try {
			await send("client.register", { clientId: "client-1" });
			for (const sessionId of [42, {}]) {
				const rejected = await send(
					"session.messages",
					{ chunkHistory: true },
					{ sessionId },
				);
				expect(rejected.error?.code).toBe("command_failed");
			}
			for (const requestId of [undefined, "", " ", 42, {}]) {
				const rejected = await send(
					"session.messages",
					{ chunkHistory: true },
					{ requestId },
				);
				expect(rejected.error?.message).toBe(
					"Chunked history requires an initial request ID",
				);
			}
			expect((await send("session.messages")).payload?.messages).toEqual(
				messages,
			);
			let reply = await send(
				"session.messages",
				{ chunkHistory: true },
				{ clientId: "client-1 " },
			);
			await send("session.get");
			const chunks = [reply.payload?.historyChunk];
			while (typeof reply.payload?.historyCursor === "string") {
				reply = await send("session.messages", {
					chunkHistory: true,
					historyCursor: reply.payload.historyCursor,
				});
				chunks.push(reply.payload?.historyChunk);
			}
			expect(JSON.parse(chunks.join(""))).toEqual(messages);
			expect(
				transport.command.mock.calls.filter(
					([envelope]) => envelope.command === "session.messages",
				),
			).toHaveLength(2);
		} finally {
			detach();
		}
	});

	it("cancels a lost first reply by its request without disturbing another read or events", async () => {
		const messages = [{ role: "assistant", content: "x".repeat(200_000) }];
		let publish: ((event: HubEventEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(
				async (envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> => ({
					version: "v1",
					requestId: envelope.requestId,
					ok: true,
					payload: envelope.command === "session.messages" ? { messages } : {},
				}),
			),
			subscribe: vi.fn(
				(_clientId: string, listener: (event: HubEventEnvelope) => void) => {
					publish = listener;
					return () => undefined;
				},
			),
		};
		const socket = createHistorySocket();
		const foreign = createHistorySocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const detach = adapter.attach(socket);
		const detachForeign = adapter.attach(foreign);
		let firstReplyDropped = false;
		const sendFrame = socket.send.bind(socket);
		vi.spyOn(socket, "send").mockImplementation((data) => {
			if (JSON.parse(data).envelope?.requestId === "history-1") {
				firstReplyDropped = true;
			} else sendFrame(data);
		});
		const response = socket.reply;
		const cancel = (
			target: ReturnType<typeof createSocket>,
			overrides: Record<string, unknown> = {},
		) =>
			target.emitMessage(
				JSON.stringify({
					kind: "history.cancel",
					clientId: "client-1",
					sessionId: "session-1",
					requestId: "history-1",
					...overrides,
				}),
			);
		try {
			socket.command("register", "client.register", { clientId: "client-1" });
			await vi.waitFor(() => expect(response("register")?.ok).toBe(true));
			socket.emitMessage(
				JSON.stringify({ kind: "stream.subscribe", clientId: "client-1" }),
			);
			socket.command("history-1", "session.messages", { chunkHistory: true });
			socket.command("history-2", "session.messages", { chunkHistory: true });
			await vi.waitFor(() => {
				expect(firstReplyDropped).toBe(true);
				expect(response("history-2")?.payload?.historyCursor).toBeTypeOf(
					"string",
				);
			});
			socket.command("history-3", "session.messages", { chunkHistory: true });
			cancel(foreign);
			foreign.command("foreign-register", "client.register", {
				clientId: "client-1",
			});
			await vi.waitFor(() => expect(foreign.sent).toHaveLength(1));
			foreign.command("foreign-history", "session.messages", {
				chunkHistory: true,
			});
			await vi.waitFor(() =>
				expect(
					foreign.reply("foreign-history")?.payload?.historyCursor,
				).toBeTypeOf("string"),
			);
			cancel(foreign);
			for (const overrides of [
				{ clientId: "other-client" },
				{ clientId: {} },
				{ sessionId: "other-session" },
				{ sessionId: {} },
				{ requestId: "" },
				{ requestId: 42 },
			])
				cancel(socket, overrides);
			socket.command("status", "session.get");
			await vi.waitFor(() => expect(response("status")?.ok).toBe(true));
			expect(response("history-3")).toBeUndefined();
			expect(
				transport.command.mock.calls.filter(
					([request]) => request.command === "session.messages",
				),
			).toHaveLength(3);
			const event: HubEventEnvelope = {
				version: "v1",
				event: "run.completed",
				sessionId: "session-1",
			};
			expect(publish).toBeTypeOf("function");
			publish?.(event);
			expect(socket.sent.map((frame) => JSON.parse(frame))).toContainEqual({
				kind: "event",
				envelope: event,
			});
			cancel(socket, { clientId: " client-1 ", sessionId: " session-1 " });
			await vi.waitFor(() =>
				expect(response("history-3")?.payload?.historyCursor).toBeTypeOf(
					"string",
				),
			);
			cancel(socket);
			for (const id of ["history-2", "history-3"]) {
				socket.command(`${id}-next`, "session.messages", {
					chunkHistory: true,
					historyCursor: response(id)?.payload?.historyCursor,
				});
				await vi.waitFor(() => expect(response(`${id}-next`)?.ok).toBe(true));
				expect(response(`${id}-next`)?.payload?.historyCursor).toBeUndefined();
			}
			expect(
				transport.command.mock.calls.filter(
					([request]) => request.command === "session.messages",
				),
			).toHaveLength(4);
		} finally {
			detach();
			detachForeign();
		}
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});
});

describe("BrowserWebSocketHubAdapter", () => {
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
		).attach(socket, { tokenAuthenticated: true });

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
			crossWorkspace: true,
			tokenAuthenticated: true,
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
		while (
			transport.replayEventsAfter.mock.calls.length < 2 &&
			Date.now() < deadline
		) {
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
					frame.kind === "event" && frame.envelope.eventId === "hevt_reissued",
			);
		expect(delivered).toHaveLength(2);
	});
});
