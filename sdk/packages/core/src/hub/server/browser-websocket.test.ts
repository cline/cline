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
		/** Mirrors the heartbeat liveness the `ws` wrapper exposes. */
		alive: true,
		closeCalls: 0,
		isAlive(): boolean {
			return this.alive;
		},
		close(): void {
			this.closeCalls += 1;
		},
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

/** An always-ok transport that records the envelopes it was asked to dispatch. */
function createRecordingTransport(
	replyPayload: (
		envelope: HubCommandEnvelope,
	) => HubReplyEnvelope["payload"] = (envelope) =>
		envelope.command === "client.register"
			? { clientId: envelope.payload?.clientId ?? envelope.clientId }
			: undefined,
) {
	const commands: HubCommandEnvelope[] = [];
	return {
		commands,
		command: vi.fn(async (envelope: HubCommandEnvelope) => {
			commands.push(envelope);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: replyPayload(envelope),
			} satisfies HubReplyEnvelope;
		}),
		subscribe: vi.fn(async () => () => {}),
	};
}

function commandFrame(
	command: string,
	overrides: Partial<HubCommandEnvelope> = {},
): string {
	return JSON.stringify({
		kind: "command",
		envelope: {
			version: "v1",
			command,
			requestId: `req-${command}`,
			...overrides,
		},
	});
}

function replies(socket: { sent: string[] }): HubReplyEnvelope[] {
	return socket.sent
		.map((entry) => JSON.parse(entry))
		.filter((frame) => frame.kind === "reply")
		.map((frame) => frame.envelope as HubReplyEnvelope);
}

/**
 * Registers `clientId` on an already-attached socket while fake timers are
 * installed, then clears the reply so later assertions see only new frames.
 */
async function registerUnderFakeTimers(
	socket: ReturnType<typeof createSocket>,
	clientId: string,
): Promise<void> {
	socket.emitMessage(
		commandFrame("client.register", {
			requestId: `req-register-${clientId}`,
			clientId,
			payload: { clientId, clientType: "test" },
		}),
	);
	await vi.advanceTimersByTimeAsync(0);
	socket.sent.length = 0;
}

/** Registers `clientId` on a socket and returns the attached adapter socket. */
async function attachRegistered(
	adapter: BrowserWebSocketHubAdapter,
	socket: ReturnType<typeof createSocket>,
	clientId: string,
): Promise<void> {
	adapter.attach(socket);
	socket.emitMessage(
		commandFrame("client.register", {
			clientId,
			payload: { clientId, clientType: "test" },
		}),
	);
	await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
	socket.sent.length = 0;
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
						code: "client_id_mismatch",
						message:
							"This connection is registered as client-1 and cannot act as other-client.",
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
			crossWorkspace: true,
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
			command: vi.fn((envelope: HubCommandEnvelope) =>
				envelope.command === "client.register"
					? Promise.resolve({
							version: envelope.version,
							requestId: envelope.requestId,
							ok: true,
							payload: { clientId: "client-1" },
						} satisfies HubReplyEnvelope)
					: new Promise<HubReplyEnvelope>((resolve) => {
							resolveCommand = resolve;
						}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);
		await registerUnderFakeTimers(socket, "client-1");

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
			command: vi.fn((envelope: HubCommandEnvelope) =>
				envelope.command === "client.register"
					? Promise.resolve({
							version: envelope.version,
							requestId: envelope.requestId,
							ok: true,
							payload: { clientId: "client-1" },
						} satisfies HubReplyEnvelope)
					: new Promise<HubReplyEnvelope>(() => {}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);
		await registerUnderFakeTimers(socket, "client-1");

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
		const command = createRecordingTransport().command;
		const transport = {
			command,
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
		await attachRegistered(adapter, socket, "late-reader");

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
			command: createRecordingTransport().command,
			subscribe: vi.fn(() => () => {}),
			replayEventsAfter: vi.fn((sinceSequence: number) => {
				if (sinceSequence === 0) return [duplicate(1)];
				if (sinceSequence === 1) return [duplicate(2)];
				return [];
			}),
		};
		const socket = createSocket();
		await attachRegistered(
			new BrowserWebSocketHubAdapter(transport),
			socket,
			"resumer",
		);

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
				clientId: "resumer",
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
			command: createRecordingTransport().command,
			subscribe: vi.fn(() => () => {}),
			// Always returns the same non-empty page regardless of the cursor.
			replayEventsAfter: vi.fn(() => [stuck]),
		};
		const socket = createSocket();
		await attachRegistered(
			new BrowserWebSocketHubAdapter(transport),
			socket,
			"resumer",
		);

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
			command: createRecordingTransport().command,
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
		await attachRegistered(
			new BrowserWebSocketHubAdapter(transport),
			socket,
			"late-reader",
		);

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

describe("BrowserWebSocketHubAdapter frame validation", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("drops a recognized command frame with no envelope instead of throwing", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const rejections: unknown[] = [];
		const onRejection = (error: unknown) => rejections.push(error);
		process.on("unhandledRejection", onRejection);

		try {
			new BrowserWebSocketHubAdapter(transport).attach(socket);

			socket.emitMessage(JSON.stringify({ kind: "command" }));
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(transport.command).not.toHaveBeenCalled();
			// No requestId to answer, so the frame is dropped with a log line only.
			expect(socket.sent).toHaveLength(0);
			expect(rejections).toEqual([]);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					'"message":"rejected malformed websocket frame"',
				),
			);
		} finally {
			process.off("unhandledRejection", onRejection);
			errorSpy.mockRestore();
		}
	});

	it("answers a malformed command frame that carries a requestId", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: { version: "v1", requestId: "req-shape" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(transport.command).not.toHaveBeenCalled();
		expect(replies(socket)[0]).toMatchObject({
			version: "v1",
			requestId: "req-shape",
			ok: false,
			error: { code: "invalid_frame" },
		});
	});

	it("drops subscription frames with no client id", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(JSON.stringify({ kind: "stream.subscribe" }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transport.subscribe).not.toHaveBeenCalled();
	});

	it("ignores reply and event frames without inspecting their envelopes", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(JSON.stringify({ kind: "reply" }));
		socket.emitMessage(JSON.stringify({ kind: "event" }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transport.command).not.toHaveBeenCalled();
		expect(socket.sent).toHaveLength(0);
	});
});

describe("BrowserWebSocketHubAdapter client identity binding", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("refuses commands that name a client id other than the registered one", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(
			commandFrame("approval.respond", {
				clientId: "client-victim",
				payload: { approvalId: "approval-1", approved: true },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({
			requestId: "req-approval.respond",
			ok: false,
			error: { code: "client_id_mismatch" },
		});
		// The spoofed command never reaches the hub.
		expect(
			transport.commands.some(
				(envelope) => envelope.command === "approval.respond",
			),
		).toBe(false);
	});

	it("treats an absent client id as the bound identity", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(commandFrame("approval.list_pending", { payload: {} }));
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({ ok: true });
		expect(
			transport.commands.find(
				(envelope) => envelope.command === "approval.list_pending",
			)?.clientId,
		).toBe("client-1");
	});

	it("binds the id the hub allocated when the client named none", async () => {
		const transport = createRecordingTransport(() => ({
			clientId: "client_generated",
		}));
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(commandFrame("client.register", { payload: {} }));
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
		socket.sent.length = 0;

		socket.emitMessage(
			commandFrame("approval.list_pending", {
				clientId: "client_generated",
				payload: {},
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
		expect(replies(socket)[0]).toMatchObject({ ok: true });

		socket.emitMessage(
			commandFrame("approval.list_pending", {
				clientId: "client-other",
				payload: {},
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(2));
		expect(replies(socket)[1]).toMatchObject({
			ok: false,
			error: { code: "client_id_mismatch" },
		});
	});

	it("refuses a second registration that claims a different client id", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-2",
				payload: { clientId: "client-2" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({
			ok: false,
			error: { code: "client_id_mismatch" },
		});
		expect(
			transport.commands.filter(
				(envelope) => envelope.command === "client.register",
			),
		).toHaveLength(1);
	});

	it("re-registering the same client id stays allowed", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-1",
				payload: { clientId: "client-1" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({ ok: true });
	});

	it("refuses identity-bound commands before registration and unregisters the bound id on close", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		socket.emitMessage(
			commandFrame("approval.respond", {
				clientId: "client-victim",
				payload: { approvalId: "approval-1", approved: true },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
		expect(replies(socket)[0]).toMatchObject({
			ok: false,
			error: { code: "not_registered" },
		});
		expect(transport.command).not.toHaveBeenCalled();

		// Commands that carry no identity semantics still work unregistered: the CLI
		// drives schedules over a bare socket via sendHubCommand.
		socket.emitMessage(
			commandFrame("schedule.list", { clientId: "cline-schedule" }),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(2));
		expect(replies(socket)[1]).toMatchObject({ ok: true });

		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-1",
				payload: { clientId: "client-1" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(3));
		socket.emitClose();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(
			transport.commands.filter(
				(envelope) => envelope.command === "client.unregister",
			),
		).toEqual([
			expect.objectContaining({
				command: "client.unregister",
				clientId: "client-1",
			}),
		]);
	});

	it("refuses unregistering another client, before and after registering", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		adapter.attach(socket);

		// Unregistering evicts a client and detaches it from every session, so an
		// anonymous connection must not be able to aim it at somebody else.
		socket.emitMessage(
			commandFrame("client.unregister", { clientId: "client-victim" }),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
		expect(replies(socket)[0]).toMatchObject({
			ok: false,
			error: { code: "not_registered" },
		});

		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-1",
				payload: { clientId: "client-1" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(2));

		socket.emitMessage(
			commandFrame("client.unregister", { clientId: "client-victim" }),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(3));
		expect(replies(socket)[2]).toMatchObject({
			ok: false,
			error: { code: "client_id_mismatch" },
		});
		expect(
			transport.commands.some(
				(envelope) => envelope.command === "client.unregister",
			),
		).toBe(false);
	});

	it("drops subscription frames that name another client id", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(
			JSON.stringify({ kind: "stream.subscribe", clientId: "client-victim" }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(transport.subscribe).not.toHaveBeenCalled();

		socket.emitMessage(
			JSON.stringify({ kind: "stream.subscribe", clientId: "client-1" }),
		);
		await vi.waitFor(() =>
			expect(transport.subscribe).toHaveBeenCalledTimes(1),
		);
	});
});

describe("BrowserWebSocketHubAdapter stream authorization", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("refuses stream.subscribe from a connection that never registered", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		// The whole ACL keys off the registered identity; an anonymous socket that
		// can subscribe as anybody reads the hub firehose.
		socket.emitMessage(
			JSON.stringify({ kind: "stream.subscribe", clientId: "client-victim" }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transport.subscribe).not.toHaveBeenCalled();
	});

	it("refuses stream.unsubscribe from a connection that never registered", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({ kind: "stream.unsubscribe", clientId: "client-victim" }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(transport.subscribe).not.toHaveBeenCalled();
	});

	it("subscribes as the bound identity once registered", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		await attachRegistered(adapter, socket, "client-1");

		socket.emitMessage(
			JSON.stringify({ kind: "stream.subscribe", clientId: "client-1" }),
		);
		await vi.waitFor(() =>
			expect(transport.subscribe).toHaveBeenCalledTimes(1),
		);
		expect(transport.subscribe).toHaveBeenCalledWith(
			"client-1",
			expect.any(Function),
			{ sessionId: undefined },
		);
	});
});

describe("BrowserWebSocketHubAdapter pre-registration command allowlist", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const refusedBeforeRegistration = [
		"run.abort",
		"session.send_input",
		"run.start",
		"session.create",
		"session.delete",
		"session.update",
		"session.hook",
		"capability.respond",
		"capability.progress",
		"capability.request",
		"session.restore",
		"approval.respond",
		"approval.list_pending",
		"session.attach",
		"session.detach",
		"client.unregister",
		"client.update",
	];

	for (const command of refusedBeforeRegistration) {
		it(`refuses ${command} before registration`, async () => {
			const transport = createRecordingTransport();
			const socket = createSocket();
			vi.spyOn(console, "error").mockImplementation(() => {});
			new BrowserWebSocketHubAdapter(transport).attach(socket);

			socket.emitMessage(
				commandFrame(command, {
					clientId: "client-victim",
					sessionId: "session-1",
					payload: { approvalId: "approval-1", approved: false },
				}),
			);
			await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

			expect(replies(socket)[0]).toMatchObject({
				ok: false,
				error: { code: "not_registered" },
			});
			expect(transport.command).not.toHaveBeenCalled();
		});
	}

	it("keeps the CLI's bare-socket schedule commands working", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			commandFrame("schedule.list", { clientId: "cline-schedule" }),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));
		expect(replies(socket)[0]).toMatchObject({ ok: true });
	});
});

describe("BrowserWebSocketHubAdapter registration integrity", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("refuses a new connection that claims a live client id", async () => {
		const transport = createRecordingTransport();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const victim = createSocket();
		await attachRegistered(adapter, victim, "client-victim");

		const impostor = createSocket();
		adapter.attach(impostor);
		impostor.emitMessage(
			commandFrame("client.register", {
				clientId: "client-victim",
				payload: { clientId: "client-victim" },
			}),
		);
		await vi.waitFor(() => expect(replies(impostor)).toHaveLength(1));

		expect(replies(impostor)[0]).toMatchObject({
			ok: false,
			error: { code: "client_id_in_use" },
		});
		expect(
			transport.commands.filter(
				(envelope) => envelope.command === "client.register",
			),
		).toHaveLength(1);
	});

	it("does not unregister the victim when an impostor's socket closes", async () => {
		const transport = createRecordingTransport();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const victim = createSocket();
		await attachRegistered(adapter, victim, "client-victim");

		const impostor = createSocket();
		adapter.attach(impostor);
		impostor.emitMessage(
			commandFrame("client.register", {
				clientId: "client-victim",
				payload: { clientId: "client-victim" },
			}),
		);
		await vi.waitFor(() => expect(replies(impostor)).toHaveLength(1));
		impostor.emitClose();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(
			transport.commands.some(
				(envelope) => envelope.command === "client.unregister",
			),
		).toBe(false);
	});

	it("lets the same client id reconnect on a new socket after a real drop", async () => {
		const transport = createRecordingTransport();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const first = createSocket();
		await attachRegistered(adapter, first, "client-mobile");
		first.emitClose();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const second = createSocket();
		adapter.attach(second);
		second.emitMessage(
			commandFrame("client.register", {
				clientId: "client-mobile",
				payload: { clientId: "client-mobile" },
			}),
		);
		await vi.waitFor(() => expect(replies(second)).toHaveLength(1));

		expect(replies(second)[0]).toMatchObject({ ok: true });
	});

	it("hands the id over when the previous socket failed its heartbeat", async () => {
		const transport = createRecordingTransport();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const stale = createSocket();
		await attachRegistered(adapter, stale, "client-mobile");
		// Half-open socket: the heartbeat already marked it unhealthy but `close`
		// has not fired yet. A mobile reconnect must not be refused here.
		stale.alive = false;

		const fresh = createSocket();
		adapter.attach(fresh);
		fresh.emitMessage(
			commandFrame("client.register", {
				clientId: "client-mobile",
				payload: { clientId: "client-mobile" },
			}),
		);
		await vi.waitFor(() => expect(replies(fresh)).toHaveLength(1));

		expect(replies(fresh)[0]).toMatchObject({ ok: true });
		expect(stale.closeCalls).toBe(1);
	});

	it("lets only one of two connections win a concurrent claim on an id", async () => {
		const transport = createRecordingTransport();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const first = createSocket();
		const second = createSocket();
		adapter.attach(first);
		adapter.attach(second);

		// Both frames are handled before either registration settles, so the claim
		// has to be reserved rather than merely checked.
		const frame = commandFrame("client.register", {
			clientId: "client-victim",
			payload: { clientId: "client-victim" },
		});
		first.emitMessage(frame);
		second.emitMessage(frame);
		await vi.waitFor(() => {
			expect(replies(first)).toHaveLength(1);
			expect(replies(second)).toHaveLength(1);
		});

		expect(
			[...replies(first), ...replies(second)].filter((reply) => reply.ok),
		).toHaveLength(1);
		expect(
			transport.commands.filter(
				(envelope) => envelope.command === "client.register",
			),
		).toHaveLength(1);
	});

	it("frees a reserved id when the registration itself fails", async () => {
		let failNext = true;
		const transport = {
			commands: [] as HubCommandEnvelope[],
			command: vi.fn(async (envelope: HubCommandEnvelope) => {
				transport.commands.push(envelope);
				const ok = !(envelope.command === "client.register" && failNext);
				failNext = false;
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok,
					...(ok
						? { payload: { clientId: envelope.payload?.clientId } }
						: { error: { code: "register_failed", message: "no" } }),
				} as HubReplyEnvelope;
			}),
			subscribe: vi.fn(async () => () => {}),
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter(transport);
		const first = createSocket();
		await attachRegistered(adapter, first, "client-mobile");
		expect(replies(first)).toHaveLength(0);

		const second = createSocket();
		adapter.attach(second);
		second.emitMessage(
			commandFrame("client.register", {
				clientId: "client-mobile",
				payload: { clientId: "client-mobile" },
			}),
		);
		await vi.waitFor(() => expect(replies(second)).toHaveLength(1));

		expect(replies(second)[0]).toMatchObject({ ok: true });
	});

	it("registers one identity when two register frames race on one socket", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-a",
				requestId: "req-a",
				payload: { clientId: "client-a" },
			}),
		);
		socket.emitMessage(
			commandFrame("client.register", {
				clientId: "client-b",
				requestId: "req-b",
				payload: { clientId: "client-b" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(2));

		// Only the first identity may bind; the second would be orphaned in
		// ctx.clients because close only unregisters the bound one.
		expect(
			transport.commands.filter(
				(envelope) => envelope.command === "client.register",
			),
		).toHaveLength(1);
		expect(replies(socket).filter((reply) => reply.ok)).toHaveLength(1);
	});
});

describe("BrowserWebSocketHubAdapter payload validation", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("answers invalid_frame for a register payload with a non-string clientId", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "req-bad-payload",
					payload: { clientId: 123 },
				},
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({
			requestId: "req-bad-payload",
			ok: false,
			error: { code: "invalid_frame" },
		});
		expect(transport.command).not.toHaveBeenCalled();
	});

	it("answers invalid_frame for a non-object payload", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "session.get",
					requestId: "req-scalar-payload",
					payload: "nope",
				},
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]).toMatchObject({
			requestId: "req-scalar-payload",
			ok: false,
			error: { code: "invalid_frame" },
		});
	});

	it("does not echo an attacker-controlled version in an invalid_frame reply", async () => {
		const transport = createRecordingTransport();
		const socket = createSocket();
		vi.spyOn(console, "error").mockImplementation(() => {});
		new BrowserWebSocketHubAdapter(transport).attach(socket);

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: { version: "v9000-<script>", requestId: "req-version" },
			}),
		);
		await vi.waitFor(() => expect(replies(socket)).toHaveLength(1));

		expect(replies(socket)[0]?.version).toBe("v1");
	});
});
