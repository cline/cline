import {
	HubClient,
	type HubClientOptions,
	HubCommandError,
	type HubConnectionState,
	type HubConnectionStateChange,
	type HubConnectionStateListener,
	HubMalformedReplyError,
	HubTransportError,
} from "@cline/hub-client";
import {
	HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE,
	HUB_CAPABILITIES,
	HUB_NOT_AUTHORIZED_ERROR_CODE,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	type PendingApprovalInfo,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type AttentionEvent,
	CloudLaunches,
} from "../connection/cloud-launches";
import { SessionConnectionController } from "../connection/controller";
import type { ApprovalPolicy } from "./approval-policy";
import type { SessionHandle } from "./cloud-resolver";
import { asHubSessionId, asRemoteSessionId } from "./ids";
import type { SessionDiagnostic, SessionViewModel } from "./reducer";
import { SessionAttachError, SessionConnection } from "./session-connection";

type CommandHandler = (
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** A `HubClient` whose transport is replaced by direct test control. */
class ControlledHubClient extends HubClient {
	readonly log: string[] = [];
	readonly handlers = new Map<string, CommandHandler>();
	capabilities = new Set<string>(["approval.list_pending"]);
	connected = true;
	private readonly eventListeners = new Set<
		(event: HubEventEnvelope) => void
	>();
	private readonly connectionListeners = new Set<HubConnectionStateListener>();
	private epoch = 0;

	constructor(options: Partial<HubClientOptions> = {}) {
		super({ url: "ws://127.0.0.1:1/hub", ...options });
	}

	override async connect(): Promise<void> {
		this.log.push("connect");
		this.epoch += 1;
	}

	override isConnected(): boolean {
		return this.connected;
	}

	override getConnectionEpoch(): number {
		return this.epoch;
	}

	/** Registers a lifecycle observer the way the resolver's factory input does. */
	observeConnectionState(listener: HubConnectionStateListener): () => void {
		this.connectionListeners.add(listener);
		return () => {
			this.connectionListeners.delete(listener);
		};
	}

	/**
	 * Reports a transport transition. `connected` bumps the epoch, exactly like the
	 * real client, so "same socket, new epoch" is not expressible by accident.
	 */
	reportConnectionState(
		state: HubConnectionState,
		extra: Partial<HubConnectionStateChange> = {},
	): void {
		if (state === "connected") {
			this.epoch += 1;
			this.connected = true;
		}
		if (state === "reconnecting" || state === "closed") {
			this.connected = false;
		}
		for (const listener of [...this.connectionListeners]) {
			listener({ state, connectionEpoch: this.epoch, ...extra });
		}
	}

	override hasCapability(name: string): boolean {
		return this.capabilities.has(name);
	}

	override subscribe(listener: (event: HubEventEnvelope) => void): () => void {
		this.log.push("subscribe");
		this.eventListeners.add(listener);
		return () => {
			this.log.push("unsubscribe");
			this.eventListeners.delete(listener);
		};
	}

	override async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	): Promise<HubReplyEnvelope> {
		this.log.push(command);
		const handler = this.handlers.get(command);
		if (!handler) {
			throw new HubCommandError(
				command,
				"unsupported",
				`no handler: ${command}`,
			);
		}
		return { version: "v1", ok: true, payload: await handler(payload) };
	}

	override async listPendingApprovals(): Promise<PendingApprovalInfo[]> {
		const reply = await this.command("approval.list_pending", {});
		return (reply.payload?.approvals ?? []) as PendingApprovalInfo[];
	}

	override getConnectionError(): HubTransportError | null {
		return this.connected
			? null
			: new HubTransportError("hub_connection_closed", "Hub connection closed");
	}

	override close(): void {
		this.log.push("close");
	}

	emit(envelope: HubEventEnvelope): void {
		for (const listener of this.eventListeners) {
			listener(envelope);
		}
	}
}

function approval(overrides: Partial<PendingApprovalInfo> = {}) {
	return {
		approvalId: "ap_1",
		sessionId: "ses_1",
		agentId: "ag_1",
		conversationId: "cv_1",
		iteration: 1,
		toolCallId: "tc_1",
		toolName: "bash",
		inputJson: '{"command":"ls"}',
		policy: { autoApprove: false } as PendingApprovalInfo["policy"],
		createdAt: 10,
		...overrides,
	} satisfies PendingApprovalInfo;
}

function handleFor(
	client: ControlledHubClient,
	options: { hubSessionId?: string } = { hubSessionId: "ses_1" },
): SessionHandle {
	let hubSessionId = options.hubSessionId
		? asHubSessionId(options.hubSessionId)
		: undefined;
	return {
		client,
		remoteSession: {
			id: asRemoteSessionId("rs_1"),
			sandboxUrl: "wss://sandbox-1.cline.bot/hub",
			status: "running",
			expiredAt: null,
		},
		get hubSessionId() {
			return hubSessionId;
		},
		get needsCreate() {
			return hubSessionId === undefined;
		},
		onConnectionState(listener) {
			return client.observeConnectionState(listener);
		},
		async ensureSession() {
			if (!hubSessionId) {
				const reply = await client.command("session.create", {});
				hubSessionId = asHubSessionId(
					(reply.payload?.session as { sessionId: string }).sessionId,
				);
			}
			return hubSessionId;
		},
	};
}

function delta(eventId: string, text: string): HubEventEnvelope {
	return {
		version: "v1",
		event: "assistant.delta",
		eventId,
		sessionId: "ses_1",
		payload: { text },
	};
}

function sessionRecord(status: string) {
	return { session: { sessionId: "ses_1", status } };
}

function setUp(
	options: {
		onReasoningApplied?: (
			choice: import("./reasoning").ReasoningChoice,
		) => void;
		getReasoningChoice?: () =>
			| import("./reasoning").ReasoningChoice
			| undefined;
		handlers?: Record<string, CommandHandler>;
		hubSessionId?: string | undefined;
		capabilities?: string[];
	} = {},
) {
	const client = new ControlledHubClient();
	if (options.capabilities) {
		client.capabilities = new Set(options.capabilities);
	}
	client.handlers.set("session.attach", () => sessionRecord("idle"));
	client.handlers.set("session.get", () => sessionRecord("idle"));
	client.handlers.set("session.messages", () => ({
		sessionId: "ses_1",
		messages: [],
	}));
	client.handlers.set("approval.list_pending", () => ({ approvals: [] }));
	client.handlers.set("session.pending_prompts", () => ({ prompts: [] }));
	client.handlers.set("session.send_input", () => ({
		result: { text: "done", finishReason: "stop" },
	}));
	client.handlers.set("run.abort", () => ({ applied: true }));
	client.handlers.set("approval.respond", () => ({ approved: true }));
	client.handlers.set("capability.respond", () => ({ ok: true }));
	for (const [command, handler] of Object.entries(options.handlers ?? {})) {
		client.handlers.set(command, handler);
	}
	const diagnostics: SessionDiagnostic[] = [];
	const views: SessionViewModel[] = [];
	const connection = new SessionConnection({
		getReasoningChoice: options.getReasoningChoice,
		onReasoningApplied: options.onReasoningApplied,
		handle: handleFor(client, {
			hubSessionId: "hubSessionId" in options ? options.hubSessionId : "ses_1",
		}),
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	connection.subscribe((view) => views.push(view));
	return { client, connection, diagnostics, views };
}

/** Lets `start()`/`resync()` run to their first awaited command reply. */
async function settle(): Promise<void> {
	for (let round = 0; round < 20; round += 1) {
		await Promise.resolve();
	}
}

describe("start ordering", () => {
	it("subscribes before hydrating and never loses an event in between", async () => {
		const hydrate = deferred<Record<string, unknown>>();
		const { client, connection } = setUp({
			handlers: { "session.messages": () => hydrate.promise },
		});

		const started = connection.start();
		// Let start() reach the awaited hydrate command.
		await settle();
		expect(client.log).toEqual([
			"connect",
			"subscribe",
			"session.attach",
			"session.messages",
		]);
		expect(connection.getView().connectionStatus).toBe("hydrating");

		// Events published during the hydrate window are buffered, not rendered.
		client.emit(delta("e1", "streamed"));
		expect(connection.getView().messages).toEqual([]);

		hydrate.resolve({ sessionId: "ses_1", messages: [] });
		await started;

		const view = connection.getView();
		expect(view.connectionStatus).toBe("live");
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "streamed" },
		]);
		connection.dispose();
	});

	it("does not duplicate a buffered event that the hydrate already reflects", async () => {
		const hydrate = deferred<Record<string, unknown>>();
		const { client, connection } = setUp({
			handlers: { "session.messages": () => hydrate.promise },
		});
		const started = connection.start();
		await settle();

		client.emit(delta("e1", "part two"));
		client.emit({
			version: "v1",
			event: "assistant.finished",
			eventId: "e2",
			sessionId: "ses_1",
			payload: { text: "part two" },
		});
		client.emit({
			version: "v1",
			event: "run.completed",
			eventId: "e3",
			sessionId: "ses_1",
			payload: { reason: "completed" },
		});
		hydrate.resolve({
			sessionId: "ses_1",
			messages: [
				{ role: "user", content: "stream in two parts" },
				{ role: "assistant", content: "part one part two" },
			],
		});
		await started;

		const view = connection.getView();
		expect(view.messages.map((message) => message.id)).toEqual(["h0", "h1"]);
		expect(view.runStatus).toBe("completed");
		connection.dispose();
	});

	it("goes live with a diagnostic when the hydrate command fails", async () => {
		const { client, connection, diagnostics } = setUp({
			handlers: {
				"session.messages": () => {
					throw new HubCommandError(
						"session.messages",
						"session_not_found",
						"Unknown session",
					);
				},
			},
		});
		await connection.start();
		client.emit(delta("e1", "live anyway"));
		expect(connection.getView().connectionStatus).toBe("live");
		expect(connection.getView().messages).toHaveLength(1);
		expect(diagnostics).toEqual([
			expect.objectContaining({ level: "error", type: "hydrate_failed" }),
		]);
		connection.dispose();
	});

	it("skips the hydrate entirely for a session that does not exist yet", async () => {
		const { client, connection } = setUp({ hubSessionId: undefined });
		await connection.start();
		expect(client.log).not.toContain("session.messages");
		// Nothing to attach to: `session.create` records this client as the creator,
		// which is the same relationship `session.attach` would grant.
		expect(client.log).not.toContain("session.attach");
		expect(connection.getView().connectionStatus).toBe("live");
		connection.dispose();
	});

	it("attaches to a pre-existing session so the hub knows this client", async () => {
		const attached: Array<Record<string, unknown> | undefined> = [];
		const { client, connection } = setUp({
			handlers: {
				"session.attach": (payload) => {
					attached.push(payload);
					return sessionRecord("idle");
				},
			},
		});
		await connection.start();
		expect(client.log.indexOf("session.attach")).toBeGreaterThan(
			client.log.indexOf("subscribe"),
		);
		expect(client.log.indexOf("session.attach")).toBeLessThan(
			client.log.indexOf("session.messages"),
		);
		expect(attached).toEqual([{ sessionId: "ses_1" }]);
		connection.dispose();
	});

	it("fails the start with a typed error when the attach is refused", async () => {
		const { connection, diagnostics, client } = setUp({
			handlers: {
				"session.attach": () => {
					throw new HubCommandError(
						"session.attach",
						"session_not_found",
						"Unknown session: ses_1",
					);
				},
			},
		});
		const error = await connection.start().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SessionAttachError);
		expect((error as SessionAttachError).hubSessionId).toBe("ses_1");
		expect(connection.getView().connectionStatus).toBe("error");
		expect(diagnostics).toEqual([
			expect.objectContaining({ level: "error", type: "attach_failed" }),
		]);
		// A refused attach is terminal for this start: no hydrate is attempted with a
		// session the hub will not let us act on.
		expect(client.log).not.toContain("session.messages");
		connection.dispose();
	});

	it("takes the authoritative run status from the attach reply", async () => {
		const { connection } = setUp({
			handlers: {
				"session.attach": () => sessionRecord("completed"),
				"session.messages": () => ({
					sessionId: "ses_1",
					messages: [
						{ role: "user", content: "do it" },
						{ role: "assistant", content: "did it" },
					],
				}),
			},
		});
		await connection.start();
		expect(connection.getView().runStatus).toBe("completed");
		connection.dispose();
	});

	it("falls back to session.get when the attach reply carries no record", async () => {
		const { client, connection, diagnostics } = setUp({
			handlers: {
				"session.attach": () => ({}),
				"session.get": () => sessionRecord("failed"),
			},
		});
		await connection.start();
		expect(client.log).toContain("session.get");
		expect(connection.getView().runStatus).toBe("failed");
		expect(diagnostics).toEqual([]);
		connection.dispose();
	});

	it("ignores events addressed to another session", async () => {
		const { client, connection } = setUp();
		await connection.start();
		client.emit({ ...delta("e1", "mine") });
		client.emit({ ...delta("e2", "theirs"), sessionId: "ses_other" });
		expect(connection.getView().messages).toHaveLength(1);
		connection.dispose();
	});

	it("never renders another client's stream while this session has no id yet", async () => {
		const { client, connection } = setUp({ hubSessionId: undefined });
		await connection.start();
		client.emit({
			...delta("e1", "someone else's answer"),
			sessionId: "ses_b",
		});
		expect(connection.getView().messages).toEqual([]);
		connection.dispose();
	});

	it("never queues another client's approval while this session has no id yet", async () => {
		const { client, connection } = setUp({ hubSessionId: undefined });
		await connection.start();
		client.emit({
			version: "v1",
			event: "approval.requested",
			eventId: "e1",
			sessionId: "ses_b",
			payload: approval({ approvalId: "ap_theirs", sessionId: "ses_b" }),
		});
		expect(connection.getView().pendingApprovals).toEqual([]);
		connection.dispose();
	});

	it("replays events held during the unknown-id window once the session is created", async () => {
		const { client, connection } = setUp({
			hubSessionId: undefined,
			handlers: {
				"session.create": () => ({ session: { sessionId: "ses_new" } }),
			},
		});
		await connection.start();
		// Published between `session.create` landing on the hub and the handle
		// learning the id: ours, and it must not be lost.
		client.emit({ ...delta("e1", "ours"), sessionId: "ses_new" });
		client.emit({ ...delta("e2", "theirs"), sessionId: "ses_b" });
		expect(connection.getView().messages).toEqual([]);

		await connection.sendInput("go");
		const texts = connection
			.getView()
			.messages.flatMap((message) => message.blocks)
			.map((block) => (block.kind === "text" ? block.text : ""));
		expect(texts).toContain("ours");
		expect(texts).not.toContain("theirs");
		connection.dispose();
	});
});

describe("ask_question capability", () => {
	it.each([
		"reconnecting",
		"closed",
		"connected",
	] as const)("retires a disconnected question on %s without answering its old request", async (state) => {
		const { client, connection } = setUp();
		await connection.start();
		client.emit({
			version: "v1",
			event: "capability.requested",
			sessionId: "ses_1",
			payload: {
				requestId: "lost",
				targetClientId: client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Ready?", ["Yes", "No"]] },
			},
		});
		expect(connection.getView().pendingQuestions).toHaveLength(1);
		client.reportConnectionState(state);
		expect(connection.getView().pendingQuestions).toEqual([]);
		expect(connection.getView().questionInterrupted).toBe(true);
		await connection.respondQuestion("lost", "Yes");
		expect(client.log).not.toContain("capability.respond");
		connection.dispose();
	});
	it("handles a question published before session.create replies", async () => {
		const { client, connection } = setUp({ hubSessionId: undefined });
		client.handlers.set("session.create", () => {
			client.emit({
				version: "v1",
				event: "capability.requested",
				sessionId: "ses_1",
				payload: {
					requestId: "early",
					targetClientId: client.getClientId(),
					capabilityName: "tool_executor.askQuestion",
					payload: { args: ["Ready?", ["Yes", "No"]] },
				},
			});
			return sessionRecord("running");
		});
		await connection.start();
		await connection.sendInput("Ask me a question");
		expect(connection.getView().pendingQuestions).toEqual([
			{ requestId: "early", question: "Ready?", options: ["Yes", "No"] },
		]);
		await connection.respondQuestion("early", "Yes");
		expect(client.log).toContain("capability.respond");
		connection.dispose();
	});
	it.each([
		"Use Hub",
		"  A different approach  ",
	])("returns a suggested or custom answer: %s", async (answer) => {
		let response: Record<string, unknown> | undefined;
		const { client, connection } = setUp({
			handlers: {
				"capability.respond": (payload) => {
					response = payload;
					return { ok: true };
				},
			},
		});
		await connection.start();
		client.emit({
			version: "v1",
			event: "capability.requested",
			sessionId: "ses_1",
			payload: {
				requestId: "capreq_1",
				targetClientId: client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Which path?", ["Use Hub", "Use REST"]] },
			},
		});

		expect(connection.getView().pendingQuestions).toEqual([
			{
				requestId: "capreq_1",
				question: "Which path?",
				options: ["Use Hub", "Use REST"],
			},
		]);
		await connection.respondQuestion("capreq_1", "  \n ");
		await connection.respondQuestion("missing", answer);
		expect(response).toBeUndefined();
		await connection.respondQuestion("capreq_1", answer);
		expect(response).toEqual({
			requestId: "capreq_1",
			ok: true,
			payload: { result: answer.trim() },
		});
		expect(connection.getView().pendingQuestions).toEqual([]);
		connection.dispose();
	});

	it("ignores another client's question and rejects malformed owned options", async () => {
		const responses: Array<Record<string, unknown> | undefined> = [];
		const { client, connection } = setUp({
			handlers: {
				"capability.respond": (payload) => {
					responses.push(payload);
					return { ok: true };
				},
			},
		});
		await connection.start();
		const base = {
			version: "v1" as const,
			event: "capability.requested" as const,
			sessionId: "ses_1",
		};
		client.emit({
			...base,
			payload: {
				requestId: "capreq_other",
				targetClientId: "another-client",
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Theirs?", ["A", "B"]] },
			},
		});
		client.emit({
			...base,
			payload: {
				requestId: "capreq_bad",
				targetClientId: client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Bad?", ["Only one"]] },
			},
		});
		await settle();

		expect(connection.getView().pendingQuestions).toEqual([]);
		expect(responses).toEqual([
			{
				requestId: "capreq_bad",
				ok: false,
				error: "ask_question requires one question and 2-5 text options.",
			},
		]);
		connection.dispose();
	});
});

describe("approval recovery", () => {
	it("merges pending approvals on connect when the hub advertises the capability", async () => {
		const { connection, client } = setUp({
			handlers: {
				"approval.list_pending": () => ({ approvals: [approval()] }),
			},
		});
		await connection.start();
		expect(client.log).toContain("approval.list_pending");
		expect(
			connection.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);
		connection.dispose();
	});

	it("skips recovery against a hub without the capability", async () => {
		const { connection, client } = setUp({
			capabilities: [],
			handlers: {
				"approval.list_pending": () => ({ approvals: [approval()] }),
			},
		});
		await connection.start();
		expect(client.log).not.toContain("approval.list_pending");
		expect(connection.getView().pendingApprovals).toEqual([]);
		connection.dispose();
	});

	it("renders and answers upstream replayed approvals without payload timestamps or list support", async () => {
		const { connection, client } = setUp({ capabilities: [] });
		await connection.start();
		const { createdAt: _createdAt, ...payload } = approval();
		const event: HubEventEnvelope = {
			version: "v1",
			event: "approval.requested",
			eventId: "upstream-approval",
			sessionId: "ses_1",
			timestamp: 1234,
			payload,
		};
		client.emit(event);
		client.emit(event);
		expect(connection.getView().pendingApprovals).toEqual([
			expect.objectContaining({ approvalId: "ap_1", createdAt: 1234 }),
		]);
		connection.setApprovalPolicy({
			read: "ask",
			write: "ask",
			execute: "auto",
		});
		await settle();
		client.emit(event);
		await settle();
		expect(
			client.log.filter((name) => name === "approval.respond"),
		).toHaveLength(1);
		expect(client.log).not.toContain("approval.list_pending");
		connection.dispose();
	});

	it.each([
		"reconnecting",
		"closed",
	] as const)("rebuilds upstream approvals after %s from replay before the connected callback", async (droppedState) => {
		const { connection, client } = setUp({ capabilities: [] });
		await connection.start();
		const event = (id: string): HubEventEnvelope => ({
			version: "v1",
			event: "approval.requested",
			eventId: `event-${id}`,
			sessionId: "ses_1",
			timestamp: 1234,
			payload: approval({ approvalId: id }),
		});
		client.emit(event("resolved-elsewhere"));
		client.emit(event("still-pending"));
		expect(connection.getView().pendingApprovals).toHaveLength(2);
		client.reportConnectionState(droppedState);
		expect(connection.getView().pendingApprovals).toEqual([]);
		client.emit(event("still-pending"));
		connection.setApprovalPolicy({
			read: "ask",
			write: "ask",
			execute: "auto",
		});
		await settle();
		expect(client.log).not.toContain("approval.respond");
		client.reportConnectionState("connected");
		await waitFor(() => connection.getView().connectionStatus === "live");
		await settle();
		client.emit(event("still-pending"));
		await settle();
		expect(
			connection.getView().pendingApprovals.map((item) => item.approvalId),
		).toEqual(["still-pending"]);
		expect(
			client.log.filter((name) => name === "approval.respond"),
		).toHaveLength(1);
		connection.dispose();
	});

	it("counts unusable rows without losing the answerable ones", async () => {
		const { connection, diagnostics } = setUp({
			handlers: {
				"approval.list_pending": () => ({
					approvals: [approval(), { approvalId: "broken" }],
				}),
			},
		});
		await connection.start();
		expect(connection.getView().pendingApprovals).toHaveLength(1);
		expect(diagnostics).toEqual([
			expect.objectContaining({ type: "invalid_pending_approvals", count: 1 }),
		]);
		connection.dispose();
	});

	it.each([
		HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE,
		"approval_not_found",
	])("treats %s as an info-level local drop", async (code) => {
		const { connection, diagnostics } = setUp({
			handlers: {
				"approval.list_pending": () => ({ approvals: [approval()] }),
				"approval.respond": () => {
					throw new HubCommandError(
						"approval.respond",
						code,
						"Approval ap_1 is no longer pending",
					);
				},
			},
		});
		await connection.start();
		await expect(connection.respond("ap_1", true)).resolves.toBeUndefined();
		expect(connection.getView().pendingApprovals).toEqual([]);
		expect(diagnostics).toEqual([
			{
				level: "info",
				type: "approval_already_resolved",
				approvalId: "ap_1",
			},
		]);
		connection.dispose();
	});

	it("propagates any other approval.respond failure", async () => {
		const { connection, diagnostics } = setUp({
			handlers: {
				"approval.list_pending": () => ({ approvals: [approval()] }),
				"approval.respond": () => {
					throw new HubCommandError("approval.respond", "boom", "nope");
				},
			},
		});
		await connection.start();
		await expect(connection.respond("ap_1", true)).rejects.toThrow(/nope/);
		expect(connection.getView().pendingApprovals).toHaveLength(1);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				type: "command_failed",
				command: "approval.respond",
			}),
		]);
		connection.dispose();
	});

	it("keeps an approval that arrived live while list_pending was in flight", async () => {
		// The snapshot is captured (empty) before the approval exists; the reply is
		// held open so the live `approval.requested` lands during the round trip.
		const gate = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			handlers: {
				"approval.list_pending": () => gate.promise,
			},
		});
		const startPromise = connection.start();
		await settle();
		expect(client.log).toContain("approval.list_pending");

		client.emit({
			version: "v1",
			event: "approval.requested",
			eventId: "e1",
			payload: approval() as unknown as Record<string, unknown>,
		});
		expect(
			connection.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);

		// The stale, empty snapshot resolves last and must not wipe the live approval.
		gate.resolve({ approvals: [] });
		await startPromise;
		expect(
			connection.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);
		connection.dispose();
	});

	it("keeps the pending set and reports a diagnostic when list_pending throws malformed", async () => {
		const { connection, client, diagnostics } = setUp({
			handlers: {
				"approval.list_pending": () => ({ approvals: [] }),
			},
		});
		await connection.start();
		client.emit({
			version: "v1",
			event: "approval.requested",
			eventId: "e1",
			payload: approval() as unknown as Record<string, unknown>,
		});
		expect(
			connection.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);

		// The hub now sends a structurally broken reply; the client surfaces it
		// instead of coercing to an authoritative empty snapshot.
		client.handlers.set("approval.list_pending", () => {
			throw new HubMalformedReplyError(
				"approval.list_pending",
				"reply is missing an approvals array",
			);
		});
		const before = diagnostics.length;
		await connection.refreshPendingApprovals();

		expect(
			connection.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);
		expect(diagnostics.slice(before)).toContainEqual(
			expect.objectContaining({
				level: "error",
				type: "command_failed",
				command: "approval.list_pending",
			}),
		);
		connection.dispose();
	});
});

describe("pending queue recovery", () => {
	const queued = {
		id: "q1",
		prompt: "After this",
		delivery: "queue",
		attachmentCount: 0,
	};
	it.each([
		"remove",
		"edit",
		"steer",
	])("applies the acknowledged %s snapshot without a broadcast", async (operation) => {
		const expected =
			operation === "remove"
				? []
				: [
						{
							...queued,
							...(operation === "edit"
								? { prompt: "Edited" }
								: { delivery: "steer" }),
						},
					];
		const { connection } = setUp({
			handlers: {
				"session.pending_prompts": () => ({ prompts: [queued] }),
				"session.remove_pending_prompt": () => ({ prompts: expected }),
				"session.update_pending_prompt": () => ({ prompts: expected }),
			},
		});
		await connection.start();
		if (operation === "remove") await connection.removePendingPrompt(queued.id);
		else
			await connection.updatePendingPrompt(
				queued.id,
				operation === "edit" ? { prompt: "Edited" } : { delivery: "steer" },
			);
		expect(connection.getView().pendingPrompts).toEqual(expected);
		connection.dispose();
	});

	it("does not let an older mutation acknowledgement replace a newer acknowledgement", async () => {
		const old = deferred<Record<string, unknown>>();
		const newer = deferred<Record<string, unknown>>();
		let count = 0;
		const { connection } = setUp({
			handlers: {
				"session.pending_prompts": () => ({ prompts: [queued] }),
				"session.update_pending_prompt": () =>
					++count === 1 ? old.promise : newer.promise,
			},
		});
		await connection.start();
		const first = connection.updatePendingPrompt(queued.id, {
			prompt: "Older",
		});
		const second = connection.updatePendingPrompt(queued.id, {
			prompt: "Newer",
		});
		await settle();
		newer.resolve({ prompts: [{ ...queued, prompt: "Newer" }] });
		await second;
		old.resolve({ prompts: [{ ...queued, prompt: "Older" }] });
		await first;
		expect(connection.getView().pendingPrompts[0]?.prompt).toBe("Newer");
		connection.dispose();
	});

	it("preserves a live queue event over a delayed mutation acknowledgement", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			handlers: {
				"session.pending_prompts": () => ({ prompts: [queued] }),
				"session.update_pending_prompt": () => ack.promise,
			},
		});
		await connection.start();
		const edit = connection.updatePendingPrompt(queued.id, { prompt: "Older" });
		await settle();
		client.emit({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "ses_1",
			payload: { prompts: [{ ...queued, prompt: "Other client" }] },
		});
		ack.resolve({ prompts: [{ ...queued, prompt: "Older" }] });
		await edit;
		expect(connection.getView().pendingPrompts[0]?.prompt).toBe("Other client");
		connection.dispose();
	});

	it("does not let an earlier queue read overwrite an acknowledged edit", async () => {
		const read = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			handlers: {
				"session.pending_prompts": () => ({ prompts: [queued] }),
				"session.update_pending_prompt": () => ({
					prompts: [{ ...queued, prompt: "Edited" }],
				}),
			},
		});
		await connection.start();
		client.handlers.set("session.pending_prompts", () => read.promise);
		const refresh = connection.resync();
		await settle();
		await connection.updatePendingPrompt(queued.id, { prompt: "Edited" });
		read.resolve({ prompts: [queued] });
		await refresh;
		expect(connection.getView().pendingPrompts[0]?.prompt).toBe("Edited");
		connection.dispose();
	});
	it("hands only the acknowledged send to the queue, even with identical concurrent text", async () => {
		const first = deferred<Record<string, unknown>>();
		const second = deferred<Record<string, unknown>>();
		let sends = 0;
		const { connection } = setUp({
			capabilities: [...HUB_CAPABILITIES],
			handlers: {
				"session.send_input": () =>
					++sends === 1 ? first.promise : second.promise,
				"session.pending_prompts": () => ({ prompts: [queued] }),
			},
		});
		await connection.start();
		const one = connection.sendInput(queued.prompt);
		const two = connection.sendInput(queued.prompt);
		await settle();
		// RuntimeHost.runTurn returns no result when it accepts a queued input.
		first.resolve({});
		await one;
		await settle();
		expect(connection.getView().messages.map((message) => message.id)).toEqual([
			"u2",
		]);
		expect(connection.getView().pendingPrompts).toEqual([queued]);
		second.reject(new Error("not delivered"));
		await expect(two).rejects.toThrow("not delivered");
		expect(connection.getView().messages[0]).toMatchObject({
			id: "u2",
			failed: true,
		});
		connection.dispose();
	});

	it("does not withdraw an immediately executed input on a queue-capable hub", async () => {
		const { connection } = setUp({
			capabilities: ["session.pending_prompts"],
			handlers: {
				"session.send_input": () => ({
					result: { text: "done", finishReason: "stop" },
				}),
				"session.pending_prompts": () => ({ prompts: [] }),
			},
		});
		await connection.start();
		await connection.sendInput("hello");
		expect(connection.getView().messages[0]?.blocks).toEqual([
			{ kind: "text", text: "hello" },
		]);
		connection.dispose();
	});

	it("refreshes the real submitted text and retries at turn end if persistence lagged", async () => {
		let messages: Array<{ role: string; content: string }> = [];
		const { connection, client } = setUp({
			capabilities: ["session.pending_prompts"],
			handlers: {
				// A session record can lag behind the terminal event on the live stream.
				"session.attach": () => sessionRecord("running"),
				"session.messages": () => ({ messages }),
				"session.pending_prompts": () => ({ prompts: [] }),
			},
		});
		await connection.start();
		const reads = () =>
			client.log.filter((command) => command === "session.messages").length;
		client.emit({
			version: "v1",
			event: "session.pending_prompt_submitted",
			eventId: "submitted",
			sessionId: "ses_1",
			payload: { prompt: { ...queued, prompt: "edited" } },
		});
		await waitFor(() => reads() === 2);
		await settle();
		expect(connection.getView().messages[0]?.blocks).toEqual([
			{ kind: "text", text: "edited" },
		]);
		client.emit({
			version: "v1",
			event: "session.pending_prompt_submitted",
			eventId: "submitted-again",
			sessionId: "ses_1",
			payload: { prompt: { ...queued, prompt: "edited" } },
		});
		expect(connection.getView().messages).toHaveLength(1);
		messages = [
			{ role: "user", content: "edited" },
			{ role: "assistant", content: "done" },
		];
		client.emit({
			version: "v1",
			event: "run.completed",
			eventId: "completed",
			sessionId: "ses_1",
			payload: {},
		});
		await waitFor(() => connection.getView().messages.length === 2);
		expect(
			connection.getView().messages.map((message) => message.blocks),
		).toEqual([
			[{ kind: "text", text: "edited" }],
			[{ kind: "text", text: "done" }],
		]);
		expect(reads()).toBe(3);
		expect(connection.getView().runStatus).toBe("completed");
		connection.dispose();
	});

	it("does not turn an accepted queued input into a retry when refresh fails", async () => {
		const { connection, client } = setUp({
			capabilities: [...HUB_CAPABILITIES],
			handlers: { "session.send_input": () => ({}) },
		});
		await connection.start();
		client.handlers.set("session.messages", () => {
			throw new Error("offline");
		});
		await expect(connection.sendInput("queued")).resolves.toBeUndefined();
		await settle();
		expect(connection.getView().messages).toEqual([]);
		connection.dispose();
	});
	it("reloads the queue on open and clears stale entries on resync", async () => {
		const { connection, client } = setUp({
			capabilities: [...HUB_CAPABILITIES],
			handlers: { "session.pending_prompts": () => ({ prompts: [queued] }) },
		});
		await connection.start();
		expect(connection.getView().pendingPrompts).toEqual([queued]);
		client.handlers.set("session.pending_prompts", () => ({ prompts: [] }));
		await connection.resync();
		expect(connection.getView().pendingPrompts).toEqual([]);
		connection.dispose();
	});
	it("does not overwrite a live queue mutation with an older snapshot", async () => {
		const gate = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			capabilities: ["session.pending_prompts"],
			handlers: { "session.pending_prompts": () => gate.promise },
		});
		const started = connection.start();
		await settle();
		expect(client.log).toContain("session.pending_prompts");
		client.emit({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "ses_1",
			payload: { prompts: [queued] },
		});
		gate.resolve({ prompts: [] });
		await started;
		expect(connection.getView().pendingPrompts).toEqual([queued]);
		connection.dispose();
	});
	it("preserves the queue when recovery is malformed or unavailable", async () => {
		const { connection, client, diagnostics } = setUp({
			capabilities: ["session.pending_prompts"],
			handlers: { "session.pending_prompts": () => ({ prompts: [queued] }) },
		});
		await connection.start();
		client.handlers.set("session.pending_prompts", () => ({ prompts: null }));
		await connection.resync();
		expect(connection.getView().pendingPrompts).toEqual([queued]);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ command: "session.pending_prompts" }),
		);
		connection.dispose();
	});
});

describe("operations", () => {
	it("does not apply thinking or send while a model change is awaiting acknowledgement", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { client, connection } = setUp({
			getReasoningChoice: () => "high",
			handlers: { "session.update_connection": () => ack.promise },
		});
		await connection.start();
		const changing = connection.updateModel("new-model");
		await settle();
		await expect(connection.sendInput("Keep this message")).rejects.toThrow(
			"model is still changing",
		);
		expect(
			client.log.filter((command) => command === "session.update_connection"),
		).toHaveLength(1);
		expect(client.log).not.toContain("session.send_input");
		ack.resolve({});
		await changing;
		await connection.sendInput("Ready now");
		expect(client.log).toContain("session.send_input");
		connection.dispose();
	});
	it.each([
		false,
		true,
	])("acknowledges thinking before sending (queued=%s), clears None budget, and prevents races", async (queued) => {
		const ack = deferred<Record<string, unknown>>();
		const update = vi.fn(() => ack.promise);
		const { client, connection } = setUp({
			getReasoningChoice: () => "none",
			handlers: {
				"session.update_connection": update,
				"session.send_input": () => (queued ? {} : { result: {} }),
			},
		});
		await connection.start();
		const sending = connection.sendInput("Do it");
		await settle();
		expect(update).toHaveBeenCalledWith({
			sessionId: "ses_1",
			updates: {
				thinking: false,
				reasoningEffort: null,
				thinkingBudgetTokens: null,
			},
		});
		expect(client.log).not.toContain("session.send_input");
		await expect(connection.updateModel("other")).rejects.toThrow(
			"thinking level",
		);
		await expect(connection.sendInput("Second")).rejects.toThrow(
			"Thinking level is still",
		);
		ack.resolve({});
		await sending;
		expect(
			client.log.filter((command) => command === "session.send_input"),
		).toHaveLength(1);
		connection.dispose();
	});
	it("keeps a failed thinking update retryable and never sends the prompt before success", async () => {
		const update = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue({});
		const { client, connection } = setUp({
			getReasoningChoice: () => "high",
			handlers: { "session.update_connection": update },
		});
		await connection.start();
		await expect(connection.sendInput("Keep my text")).rejects.toThrow(
			"Your message was not sent",
		);
		expect(client.log).not.toContain("session.send_input");
		expect(
			connection.getView().messages.find((message) => message.role === "user"),
		).toMatchObject({
			failed: true,
			blocks: [{ kind: "text", text: "Keep my text" }],
		});
		await connection.retrySend("u1");
		expect(
			client.log.filter((command) => command === "session.send_input"),
		).toHaveLength(1);
		connection.dispose();
	});
	it("does not send after navigation disposes a pending thinking update", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { client, connection } = setUp({
			getReasoningChoice: () => "low",
			handlers: { "session.update_connection": () => ack.promise },
		});
		await connection.start();
		const sending = connection.sendInput("Do not send after disposal");
		await settle();
		connection.dispose();
		ack.resolve({});
		await expect(sending).rejects.toThrow("Session closed");
		expect(client.log).not.toContain("session.send_input");
	});
	it("reflects acknowledged reasoning before consuming its pending choice on a hub without broadcasts", async () => {
		const ack = deferred<Record<string, unknown>>();
		const consumed = vi.fn(() => {
			expect(connection.getView().model?.reasoning).toBe("high");
		});
		const { connection } = setUp({
			getReasoningChoice: () => "high",
			onReasoningApplied: consumed,
			handlers: {
				"session.attach": () => ({
					session: {
						sessionId: "ses_1",
						model: "m",
						provider: "cline",
						metadata: { reasoningEffort: "low" },
					},
				}),
				"session.update_connection": () => ack.promise,
			},
		});
		await connection.start();
		const sending = connection.sendInput("Apply High");
		await settle();
		expect(connection.getView().model?.reasoning).toBe("low");
		expect(consumed).not.toHaveBeenCalled();
		ack.resolve({ updated: true });
		await sending;
		expect(consumed).toHaveBeenCalledWith("high");
		expect(connection.getView().model).toMatchObject({
			modelId: "m",
			providerId: "cline",
			reasoning: "high",
		});
		connection.dispose();
	});

	it("does not overwrite a newer broadcast reasoning setting on acknowledgement", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			getReasoningChoice: () => "high",
			handlers: { "session.update_connection": () => ack.promise },
		});
		await connection.start();
		const sending = connection.sendInput("Apply High");
		await settle();
		client.emit({
			version: "v1",
			event: "session.updated",
			eventId: "newer-reasoning",
			sessionId: "ses_1",
			payload: {
				session: {
					sessionId: "ses_1",
					model: "newer",
					provider: "cline",
					metadata: { reasoningEffort: "low" },
				},
			},
		});
		ack.resolve({ updated: true });
		await sending;
		expect(connection.getView().model).toMatchObject({
			modelId: "newer",
			reasoning: "low",
		});
		connection.dispose();
	});

	it("updates model readback after acknowledgement without a session.updated event", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { connection } = setUp({
			handlers: {
				"session.attach": () => ({
					session: { sessionId: "ses_1", model: "old", provider: "cline" },
				}),
				"session.update_connection": () => ack.promise,
			},
		});
		await connection.start();
		const pending = connection.updateModel("new", { providerId: "other" });
		await Promise.resolve();
		expect(connection.getView().model).toEqual({
			modelId: "old",
			providerId: "cline",
		});
		ack.resolve({ updated: true });
		await pending;
		expect(connection.getView().model).toEqual({
			modelId: "new",
			providerId: "other",
		});
		connection.dispose();
	});

	it("keeps the previous model when changing it is rejected", async () => {
		const { connection } = setUp({
			handlers: {
				"session.attach": () => ({
					session: { sessionId: "ses_1", model: "old", provider: "cline" },
				}),
				"session.update_connection": () => {
					throw new Error("Model unavailable");
				},
			},
		});
		await connection.start();
		await expect(connection.updateModel("new")).rejects.toThrow(
			"Model unavailable",
		);
		expect(connection.getView().model).toEqual({
			modelId: "old",
			providerId: "cline",
		});
		connection.dispose();
	});

	it("does not overwrite a newer broadcast model with an older acknowledgement", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			handlers: {
				"session.update_connection": () => ack.promise,
			},
		});
		await connection.start();
		const pending = connection.updateModel("requested");
		await Promise.resolve();
		client.emit({
			version: "v1",
			event: "session.updated",
			eventId: "model-change",
			sessionId: "ses_1",
			payload: {
				session: { sessionId: "ses_1", model: "newer", provider: "cline" },
			},
		});
		ack.resolve({ updated: true });
		await pending;
		expect(connection.getView().model?.modelId).toBe("newer");
		connection.dispose();
	});

	it("renders the user message optimistically before the run replies", async () => {
		const send = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			handlers: { "session.send_input": () => send.promise },
		});
		await connection.start();
		const pending = connection.sendInput("hello");
		await Promise.resolve();
		expect(connection.getView().messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				createdAt: expect.any(Number),
				pending: true,
				blocks: [{ kind: "text", text: "hello" }],
			},
		]);
		await waitFor(() => client.log.includes("session.send_input"));
		send.resolve({});
		await pending;
		connection.dispose();
	});

	it("creates the inner session on the first send", async () => {
		const { connection, client } = setUp({
			hubSessionId: undefined,
			handlers: {
				"session.create": () => ({ session: { sessionId: "ses_new" } }),
			},
		});
		await connection.start();
		await connection.sendInput("first");
		expect(client.log).toContain("session.create");
		expect(connection.getView().messages[0]?.blocks).toEqual([
			{ kind: "text", text: "first" },
		]);
		connection.dispose();
	});

	it("changes the model on the exact live session through ClineCore", async () => {
		const updates: Array<Record<string, unknown> | undefined> = [];
		const { connection } = setUp({
			handlers: {
				"session.update_connection": (payload) => {
					updates.push(payload);
					return { updated: true };
				},
			},
		});
		await connection.start();
		await connection.updateModel("cline/new-model");
		expect(updates).toEqual([
			{
				sessionId: "ses_1",
				updates: { modelId: "cline/new-model" },
			},
		]);
		connection.dispose();
	});

	it("materializes a fresh session before applying its selected model", async () => {
		const { connection, client } = setUp({
			hubSessionId: undefined,
			handlers: {
				"session.create": () => ({ session: { sessionId: "ses_new" } }),
				"session.update_connection": () => ({ updated: true }),
			},
		});
		await connection.start();
		await connection.updateModel("cline/new-model");
		expect(client.log.indexOf("session.create")).toBeLessThan(
			client.log.indexOf("session.update_connection"),
		);
		expect(connection.handle.hubSessionId).toBe("ses_new");
		connection.dispose();
	});

	it("aborts the active run", async () => {
		const { connection, client } = setUp();
		await connection.start();
		client.emit({
			version: "v1",
			event: "run.started",
			eventId: "e1",
			sessionId: "ses_1",
		});
		expect(connection.getView().runStatus).toBe("running");
		await connection.abort("user cancelled");
		expect(client.log).toContain("run.abort");
		client.emit({
			version: "v1",
			event: "run.aborted",
			eventId: "e2",
			sessionId: "ses_1",
			payload: { reason: "aborted" },
		});
		expect(connection.getView().runStatus).toBe("aborted");
		connection.dispose();
	});

	it("reports a failed send as a diagnostic and rethrows", async () => {
		const { connection, diagnostics } = setUp({
			handlers: {
				"session.send_input": () => {
					throw new HubCommandError("session.send_input", "boom", "nope");
				},
			},
		});
		await connection.start();
		await expect(connection.sendInput("hi")).rejects.toThrow(/nope/);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				type: "command_failed",
				command: "session.send_input",
			}),
		]);
		connection.dispose();
	});

	it("leaves a failed send in a retryable state instead of pending forever", async () => {
		let attempts = 0;
		const { connection, client } = setUp({
			handlers: {
				"session.send_input": () => {
					attempts += 1;
					if (attempts === 1) {
						throw new HubTransportError(
							"hub_connection_closed",
							"Hub connection closed",
						);
					}
					return { result: { text: "done", finishReason: "stop" } };
				},
			},
		});
		await connection.start();
		await expect(connection.sendInput("deploy it")).rejects.toThrow(
			/connection closed/i,
		);
		expect(connection.getView().messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				createdAt: expect.any(Number),
				pending: true,
				failed: true,
				error: "Hub connection closed",
				blocks: [{ kind: "text", text: "deploy it" }],
			},
		]);

		// The retry re-sends the same text under the same bubble: no queue, no
		// duplicate optimistic message.
		await connection.retrySend("u1");
		expect(attempts).toBe(2);
		expect(connection.getView().messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				createdAt: expect.any(Number),
				pending: true,
				blocks: [{ kind: "text", text: "deploy it" }],
			},
		]);
		expect(
			client.log.filter((entry) => entry === "session.send_input"),
		).toHaveLength(2);
		connection.dispose();
	});

	it("re-marks the bubble failed when the retry fails too", async () => {
		const { connection } = setUp({
			handlers: {
				"session.send_input": () => {
					throw new HubCommandError("session.send_input", "boom", "still down");
				},
			},
		});
		await connection.start();
		await expect(connection.sendInput("again")).rejects.toThrow(/still down/);
		await expect(connection.retrySend("u1")).rejects.toThrow(/still down/);
		expect(connection.getView().messages[0]).toMatchObject({
			id: "u1",
			failed: true,
		});
		connection.dispose();
	});

	it("ignores a retry for a message that is not in a failed state", async () => {
		const { connection, client } = setUp();
		await connection.start();
		await connection.sendInput("fine");
		const sends = client.log.filter((entry) => entry === "session.send_input");
		await expect(connection.retrySend("u1")).resolves.toBeUndefined();
		await expect(connection.retrySend("u99")).resolves.toBeUndefined();
		expect(
			client.log.filter((entry) => entry === "session.send_input"),
		).toEqual(sends);
		connection.dispose();
	});

	it("dedupes a retried message against the transcript on the next hydrate", async () => {
		let attempts = 0;
		const { connection, client } = setUp({
			handlers: {
				"session.send_input": () => {
					attempts += 1;
					if (attempts === 1) {
						throw new HubCommandError("session.send_input", "boom", "down");
					}
					return { result: { text: "done", finishReason: "stop" } };
				},
				"session.messages": () =>
					attempts >= 2
						? {
								sessionId: "ses_1",
								messages: [{ role: "user", content: "retry me" }],
							}
						: { sessionId: "ses_1", messages: [] },
			},
		});
		await connection.start();
		await expect(connection.sendInput("retry me")).rejects.toThrow(/down/);
		await connection.retrySend("u1");
		client.reportConnectionState("connected");
		await waitFor(() =>
			connection.getView().messages.every((entry) => entry.id === "h0"),
		);
		expect(connection.getView().messages).toEqual([
			{
				id: "h0",
				role: "user",
				origin: "hydrated",
				blocks: [{ kind: "text", text: "retry me" }],
			},
		]);
		connection.dispose();
	});
});

describe("reconnect", () => {
	function reconnectSetUp() {
		let hydrateCount = 0;
		const harness = setUp({
			handlers: {
				"session.messages": () => {
					hydrateCount += 1;
					return hydrateCount === 1
						? { sessionId: "ses_1", messages: [] }
						: {
								sessionId: "ses_1",
								messages: [
									{ role: "user", content: "before the drop" },
									{ role: "assistant", content: "answer one" },
								],
							};
				},
			},
		});
		return { ...harness, hydrateCount: () => hydrateCount };
	}

	it("reports reconnecting on a drop and resyncs once the transport is back", async () => {
		const { client, connection, diagnostics, hydrateCount } = reconnectSetUp();
		await connection.start();
		client.emit(delta("e1", "partial answer"));
		expect(connection.getView().messages).toHaveLength(1);

		client.reportConnectionState("reconnecting", { detail: "socket closed" });
		expect(connection.getView().connectionStatus).toBe("reconnecting");
		expect(diagnostics).toEqual([
			expect.objectContaining({ type: "transport_dropped" }),
		]);

		client.reportConnectionState("connected");
		await waitFor(() => connection.getView().connectionStatus === "live");
		// Convergence: the transient partial is gone, the transcript is rebuilt and
		// the second hydrate ran through the same buffer-then-merge path.
		const view = connection.getView();
		expect(view.messages.map((message) => message.id)).toEqual(["h0", "h1"]);
		expect(hydrateCount()).toBe(2);
		expect(diagnostics.some((entry) => entry.type === "resynced")).toBe(true);
		connection.dispose();
	});

	it("resyncs on a new connection epoch even when no drop was ever observed", async () => {
		const { client, connection, diagnostics, hydrateCount } = reconnectSetUp();
		await connection.start();
		expect(hydrateCount()).toBe(1);

		// The client recovered its transport internally: `connected` with a fresh
		// epoch is the only trace of it, and it is enough to force the resync.
		client.reportConnectionState("connected");
		await waitFor(() => hydrateCount() === 2);
		await waitFor(() => connection.getView().connectionStatus === "live");
		expect(connection.getView().messages.map((entry) => entry.id)).toEqual([
			"h0",
			"h1",
		]);
		expect(diagnostics.some((entry) => entry.type === "resynced")).toBe(true);
		connection.dispose();
	});

	it.each([
		"send",
		"model",
		"abort",
	] as const)("restores a restarted PVC runtime before a concurrent %s without replaying its prompt", async (operation) => {
		const restored = deferred<Record<string, unknown>>();
		let live = true;
		const messages = [
			{ role: "user", content: "Previous request" },
			{ role: "assistant", content: "Previous answer" },
		];
		const { client, connection } = setUp({
			handlers: {
				"session.messages": () => ({ messages }),
				"session.update_connection": () => {
					if (!live)
						throw new HubCommandError(
							"session.update_connection",
							"session_not_found",
							"session not found: ses_1",
						);
					return {};
				},
				"session.create": async (payload) => {
					expect(payload).toMatchObject({
						initialMessages: messages,
						sessionConfig: { sessionId: "ses_1" },
					});
					const result = await restored.promise;
					live = true;
					return result;
				},
			},
		});
		connection.handle.remoteSession.sandboxType = "resumable";
		await connection.start();
		live = false;
		client.reportConnectionState("reconnecting");
		client.reportConnectionState("connected");
		await waitFor(() => client.log.includes("session.create"));
		const mutation =
			operation === "send"
				? connection.sendInput("Continue once")
				: operation === "model"
					? connection.updateModel("new-model")
					: connection.abort();
		await settle();
		expect(client.log.filter((name) => name === "session.attach")).toHaveLength(
			1,
		);
		expect(client.log).not.toContain("session.send_input");
		expect(client.log).not.toContain("run.abort");
		expect(
			client.log.filter((name) => name === "session.update_connection"),
		).toHaveLength(1);
		restored.resolve(sessionRecord("idle"));
		await mutation;
		expect(connection.getView().connectionStatus).toBe("live");
		expect(client.log.filter((name) => name === "session.create")).toHaveLength(
			1,
		);
		expect(
			client.log.filter((name) => name === "session.send_input"),
		).toHaveLength(operation === "send" ? 1 : 0);
		expect(client.log.filter((name) => name === "run.abort")).toHaveLength(
			operation === "abort" ? 1 : 0,
		);
		expect(
			client.log.filter((name) => name === "session.update_connection"),
		).toHaveLength(operation === "model" ? 2 : 1);
		connection.dispose();
	});

	it("blocks mutations after initial attachment fails until an explicit retry succeeds", async () => {
		const { client, connection } = setUp({
			handlers: {
				"session.attach": () => {
					throw new Error("Attachment refused");
				},
				"session.update_connection": () => ({}),
			},
		});
		connection.handle.remoteSession.sandboxType = "resumable";
		await expect(connection.start()).rejects.toThrow("Attachment refused");
		await expect(connection.sendInput("Blocked prompt")).rejects.toThrow(
			"Attachment refused",
		);
		expect(client.log).not.toContain("session.send_input");
		client.handlers.set("session.attach", () => sessionRecord("idle"));
		await connection.resync({ requireAttach: true });
		await connection.sendInput("Accepted prompt");
		expect(
			client.log.filter((name) => name === "session.send_input"),
		).toHaveLength(1);
		connection.dispose();
	});

	it("keeps a failed PVC restore unavailable until recovery succeeds", async () => {
		const { client, connection } = setUp({
			handlers: {
				"session.update_connection": () => {
					throw new HubCommandError(
						"session.update_connection",
						"unauthorized",
						"Access denied",
					);
				},
			},
		});
		connection.handle.remoteSession.sandboxType = "resumable";
		await connection.start();
		client.reportConnectionState("reconnecting");
		client.reportConnectionState("connected");
		await settle();
		await expect(connection.sendInput("Do not send")).rejects.toThrow(
			"Access denied",
		);
		expect(client.log).not.toContain("session.create");
		expect(client.log).not.toContain("session.send_input");
		expect(connection.getView().connectionStatus).not.toBe("live");
		client.handlers.set("session.update_connection", () => ({}));
		await connection.resync({ requireAttach: true });
		await connection.sendInput("Safe to send");
		expect(
			client.log.filter((name) => name === "session.send_input"),
		).toHaveLength(1);
		connection.dispose();
	});

	it("re-attaches on every resync, because a drop detaches the client", async () => {
		const { client, connection } = reconnectSetUp();
		await connection.start();
		client.reportConnectionState("connected");
		await waitFor(
			() =>
				client.log.filter((entry) => entry === "session.attach").length === 2,
		);
		connection.dispose();
	});

	it("ignores a connected epoch it has already acted on", async () => {
		const { client, connection, hydrateCount } = reconnectSetUp();
		await connection.start();
		const epoch = client.getConnectionEpoch();
		client.reportConnectionState("connected", { connectionEpoch: epoch });
		await settle();
		expect(hydrateCount()).toBe(1);
		connection.dispose();
	});

	it("maps a terminal close onto the closed connection status", async () => {
		const { client, connection } = setUp();
		await connection.start();
		client.reportConnectionState("closed", { detail: "hub connection closed" });
		expect(connection.getView().connectionStatus).toBe("closed");
		connection.dispose();
	});

	it("keeps events published during the resync hydrate window", async () => {
		let hydrateCount = 0;
		const second = deferred<Record<string, unknown>>();
		const { client, connection } = setUp({
			handlers: {
				"session.messages": () => {
					hydrateCount += 1;
					return hydrateCount === 1
						? { sessionId: "ses_1", messages: [] }
						: second.promise;
				},
			},
		});
		await connection.start();
		client.reportConnectionState("reconnecting");
		client.reportConnectionState("connected");
		await waitFor(() => hydrateCount === 2);

		client.emit(delta("e9", "arrived mid-resync"));
		expect(connection.getView().messages).toEqual([]);
		second.resolve({ sessionId: "ses_1", messages: [] });
		await waitFor(() => connection.getView().connectionStatus === "live");
		expect(connection.getView().messages[0]?.blocks).toEqual([
			{ kind: "text", text: "arrived mid-resync" },
		]);
		connection.dispose();
	});

	/**
	 * Drives the *public* entry points — `resync()` (which is what
	 * `SessionConnectionController.reconnect` calls) interleaved with the
	 * epoch-driven path — rather than only reporting two epochs, which the internal
	 * chain already serialised. An unserialised second pass dispatches
	 * `hydrate_started` while the first is still awaiting its reply, which clears
	 * the buffer the first pass was going to merge.
	 */
	it("serialises overlapping resyncs into one at a time", async () => {
		const inFlight = deferred<Record<string, unknown>>();
		let hydrateCount = 0;
		let openPasses = 0;
		let maxOpenPasses = 0;
		const { client, connection } = setUp({
			handlers: {
				"session.attach": () => {
					openPasses += 1;
					maxOpenPasses = Math.max(maxOpenPasses, openPasses);
					return sessionRecord("idle");
				},
				"session.messages": async () => {
					hydrateCount += 1;
					try {
						return hydrateCount === 2
							? await inFlight.promise
							: { sessionId: "ses_1", messages: [] };
					} finally {
						openPasses -= 1;
					}
				},
			},
		});
		await connection.start();

		// Pass 2: a user-driven retry, held open on its hydrate reply.
		const direct = connection.resync();
		await settle();
		expect(hydrateCount).toBe(2);

		// Pass 3 and 4 while pass 2 is still open: one from a reconnect epoch, one
		// from a second Retry tap. Neither may start a hydrate yet.
		client.reportConnectionState("connected");
		const secondTap = connection.resync();
		await settle();
		expect(hydrateCount).toBe(2);
		expect(maxOpenPasses).toBe(1);

		inFlight.resolve({ sessionId: "ses_1", messages: [] });
		await direct;
		await secondTap;
		await settle();
		expect(hydrateCount).toBe(4);
		expect(maxOpenPasses).toBe(1);
		await waitFor(() => connection.getView().connectionStatus === "live");
		connection.dispose();
	});

	it("does not let a second resync discard the buffer the first was merging", async () => {
		const inFlight = deferred<Record<string, unknown>>();
		let hydrateCount = 0;
		const { client, connection } = setUp({
			handlers: {
				// The run is still in flight, so nothing it streamed is persisted yet:
				// losing the buffer loses the content for good.
				"session.attach": () => sessionRecord("running"),
				"session.get": () => sessionRecord("running"),
				"session.messages": async () => {
					hydrateCount += 1;
					return hydrateCount === 2
						? await inFlight.promise
						: { sessionId: "ses_1", messages: [] };
				},
			},
		});
		await connection.start();
		const direct = connection.resync();
		await settle();
		expect(hydrateCount).toBe(2);

		// Buffered by pass 2, which has not merged yet.
		client.emit(delta("e_mid", "half an answer"));
		// A second retry must queue, not reopen the window and drop the buffer.
		const secondTap = connection.resync();
		inFlight.resolve({ sessionId: "ses_1", messages: [] });
		await direct;
		await secondTap;
		await settle();

		const texts = connection
			.getView()
			.messages.flatMap((message) => message.blocks)
			.map((block) => (block.kind === "text" ? block.text : ""));
		expect(texts).toContain("half an answer");
		connection.dispose();
	});

	it("reports an attach failure during a resync without stranding the client", async () => {
		let attachCount = 0;
		const { client, connection, diagnostics } = setUp({
			handlers: {
				"session.attach": () => {
					attachCount += 1;
					if (attachCount > 1) {
						throw new HubCommandError(
							"session.attach",
							"boom",
							"attach failed",
						);
					}
					return sessionRecord("idle");
				},
			},
		});
		await connection.start();
		client.reportConnectionState("connected");
		await waitFor(() =>
			diagnostics.some((entry) => entry.type === "attach_failed"),
		);
		// The transcript still converges: a lost participant record must not cost the
		// user the hydrate.
		await waitFor(() => connection.getView().connectionStatus === "live");
		connection.dispose();
	});
});

describe("lifecycle", () => {
	it("notifies view subscribers and stops after dispose", async () => {
		const { client, connection, views } = setUp();
		const unsubscribe = connection.subscribe(() => {});
		await connection.start();
		const before = views.length;
		client.emit(delta("e1", "x"));
		expect(views.length).toBeGreaterThan(before);

		unsubscribe();
		connection.dispose();
		expect(client.log).toContain("unsubscribe");
		expect(client.log).toContain("close");
		expect(connection.getView().connectionStatus).toBe("closed");

		const afterDispose = views.length;
		client.emit(delta("e2", "y"));
		expect(views.length).toBe(afterDispose);
	});

	it("is safe to dispose twice", async () => {
		const { connection } = setUp();
		await connection.start();
		connection.dispose();
		expect(() => connection.dispose()).not.toThrow();
	});
});

describe("auto-approve retries", () => {
	const AUTO_READS: ApprovalPolicy = {
		read: "auto",
		write: "ask",
		execute: "ask",
	};

	function raiseApproval(client: ControlledHubClient, eventId = "ev_ap"): void {
		client.emit({
			version: "v1",
			event: "approval.requested",
			eventId,
			sessionId: "ses_1",
			payload: approval({ toolName: "read_files" }),
		});
	}

	it("does not fire a fresh auto-approve per incoming event when one keeps failing", async () => {
		let attempts = 0;
		const { client, connection } = setUp({
			handlers: {
				"approval.respond": () => {
					attempts += 1;
					throw new HubTransportError("hub_connection_closed", "socket down");
				},
			},
		});
		connection.setApprovalPolicy(AUTO_READS);
		await connection.start();
		raiseApproval(client);
		await settle();
		expect(attempts).toBe(1);

		// Each round gives the rejected `respond` a chance to re-arm before the next
		// event dispatches, which is exactly the storm: one `approval.respond` per
		// event, forever, with the approval still pending.
		for (let round = 0; round < 12; round += 1) {
			client.emit(delta(`d${round}`, "x"));
			await settle();
		}
		expect(attempts).toBe(1);
		expect(connection.getView().pendingApprovals).toHaveLength(1);
		connection.dispose();
	});

	it("retries a transient failure on a backoff and then gives up", async () => {
		vi.useFakeTimers();
		try {
			let attempts = 0;
			const { client, connection } = setUp({
				handlers: {
					"approval.respond": () => {
						attempts += 1;
						throw new HubTransportError("hub_connection_closed", "socket down");
					},
				},
			});
			connection.setApprovalPolicy(AUTO_READS);
			await connection.start();
			raiseApproval(client);
			await settle();
			expect(attempts).toBe(1);

			await vi.advanceTimersByTimeAsync(60_000);
			const settled = attempts;
			expect(settled).toBeGreaterThan(1);
			expect(settled).toBeLessThanOrEqual(4);

			// Bounded: more time and more events add nothing.
			await vi.advanceTimersByTimeAsync(600_000);
			client.emit(delta("d1", "x"));
			await settle();
			expect(attempts).toBe(settled);
			connection.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("never retries a refusal the hub will not change its mind about", async () => {
		let attempts = 0;
		const { client, connection } = setUp({
			handlers: {
				"approval.respond": () => {
					attempts += 1;
					throw new HubCommandError(
						"approval.respond",
						HUB_NOT_AUTHORIZED_ERROR_CODE,
						"not a participant",
					);
				},
			},
		});
		connection.setApprovalPolicy(AUTO_READS);
		await connection.start();
		raiseApproval(client);
		await settle();
		// One attempt plus the single re-attach retry `respond` already performs.
		const afterGivingUp = attempts;
		expect(afterGivingUp).toBeLessThanOrEqual(2);

		for (let round = 0; round < 12; round += 1) {
			client.emit(delta(`d${round}`, "x"));
			await settle();
		}
		expect(attempts).toBe(afterGivingUp);
		// Left on screen for the user rather than spun on.
		expect(connection.getView().pendingApprovals).toHaveLength(1);
		connection.dispose();
	});

	it("forgets an approval's bookkeeping once it is resolved, so a reused id still auto-answers", async () => {
		const responded: string[] = [];
		const { client, connection } = setUp({
			handlers: {
				"approval.respond": (payload) => {
					responded.push(String(payload?.approvalId));
					return { approved: true };
				},
			},
		});
		connection.setApprovalPolicy(AUTO_READS);
		await connection.start();
		raiseApproval(client, "ev_ap_1");
		await settle();
		client.emit({
			version: "v1",
			event: "approval.resolved",
			eventId: "ev_res_1",
			sessionId: "ses_1",
			payload: { approvalId: "ap_1", approved: true },
		});
		await settle();
		// The hub reused the id for a new request (a restart resets its counter).
		raiseApproval(client, "ev_ap_2");
		await settle();
		expect(responded).toEqual(["ap_1", "ap_1"]);
		connection.dispose();
	});
});

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

describe("live attention across queued transcript hydration", () => {
	async function fixture(
		mode: "transcript" | "initial" | "reconnect" = "transcript",
	) {
		const { client } = setUp();
		const descriptor = {
			mode: "cloud" as const,
			url: "https://core.example/session/attention",
			remoteSessionId: "rs_1",
			hubSessionId: "ses_1",
		};
		const controller = new SessionConnectionController(descriptor, {
			createHandle: async () => handleFor(client),
		});
		const launches = new CloudLaunches(() => controller);
		launches.open(descriptor);
		const events: AttentionEvent[] = [];
		launches.subscribeAttention((event) => events.push(event));
		const history = deferred<Record<string, unknown>>();
		if (mode === "initial")
			client.handlers.set("session.messages", () => history.promise);
		const started = controller.start();
		if (mode !== "initial") await started;
		client.handlers.set("session.messages", () => history.promise);
		if (mode === "reconnect") client.reportConnectionState("connected");
		if (mode === "transcript")
			client.emit({
				version: "v1",
				event: "session.pending_prompt_submitted",
				eventId: "submitted",
				sessionId: "ses_1",
				payload: { prompt: { id: "queued", prompt: "next", createdAt: 1 } },
			});
		await waitFor(
			() => controller.getSnapshot().view.connectionStatus === "hydrating",
		);
		const question = (id = "fresh") =>
			client.emit({
				version: "v1",
				event: "capability.requested",
				sessionId: "ses_1",
				payload: {
					requestId: id,
					targetClientId: client.getClientId(),
					capabilityName: "tool_executor.askQuestion",
					payload: { args: ["Ready?", ["Yes", "No"]] },
				},
			});
		return {
			client,
			controller,
			launches,
			descriptor,
			started,
			events,
			history,
			question,
		};
	}
	it("delivers an actual new question once after a transcript-only refresh", async () => {
		const f = await fixture();
		f.question();
		f.question();
		expect(f.events).toEqual([]);
		f.history.resolve({ messages: [] });
		await waitFor(() => f.events.length === 1);
		expect(f.events[0]).toMatchObject({
			type: "attention",
			kind: "question",
			id: expect.stringContaining("question:fresh"),
			sessionId: "ses_1",
			remoteSessionId: "rs_1",
			focused: false,
		});
		f.launches.clear();
	});
	it.each([
		"initial",
		"reconnect",
	] as const)("does not mistake %s hydration for live attention", async (mode) => {
		const f = await fixture(mode);
		f.question();
		f.history.resolve({ messages: [] });
		await f.started;
		await waitFor(
			() => f.controller.getSnapshot().view.connectionStatus === "live",
		);
		expect(f.events).toEqual([]);
		f.launches.clear();
	});
	it.each([
		"approval",
		"completed",
		"error",
	] as const)("preserves a fresh %s observed during refresh", async (kind) => {
		const f = await fixture();
		f.client.emit({
			version: "v1",
			event: "run.started",
			eventId: "start",
			sessionId: "ses_1",
			payload: {},
		});
		const event =
			kind === "approval"
				? "approval.requested"
				: kind === "completed"
					? "run.completed"
					: "run.failed";
		f.client.emit({
			version: "v1",
			event,
			eventId: "attention",
			timestamp: 12345,
			sessionId: "ses_1",
			payload:
				kind === "approval"
					? approval()
					: kind === "error"
						? { error: "failed" }
						: {},
		});
		expect(f.events).toEqual([]);
		f.history.resolve({ messages: [] });
		await waitFor(() => f.events.length === 1);
		expect(f.events[0]).toMatchObject({ type: "attention", kind });
		f.launches.clear();
	});

	it.each([
		"resolved",
		"disconnected",
	])("does not deliver a stale question when %s", async (mode) => {
		const f = await fixture();
		f.question();
		if (mode === "resolved")
			f.client.emit({
				version: "v1",
				event: "capability.resolved",
				sessionId: "ses_1",
				payload: {
					requestId: "fresh",
					targetClientId: f.client.getClientId(),
					capabilityName: "tool_executor.askQuestion",
					ok: true,
				},
			});
		if (mode === "disconnected") f.client.reportConnectionState("closed");
		f.history.resolve({ messages: [] });
		await settle();
		expect(f.events).toEqual([]);
		f.launches.clear();
	});
});

it("preserves task focus for the notification watcher's foreground/background decision after refresh", async () => {
	const { client } = setUp();
	const descriptor = {
		mode: "cloud" as const,
		url: "https://core.example/session/focus",
		remoteSessionId: "rs_1",
		hubSessionId: "ses_1",
	};
	const controller = new SessionConnectionController(descriptor, {
		createHandle: async () => handleFor(client),
	});
	const launches = new CloudLaunches(() => controller);
	launches.open(descriptor);
	const events: AttentionEvent[] = [];
	launches.subscribeAttention((event) => events.push(event));
	await controller.start();
	launches.focusForAttention(descriptor);
	const history = deferred<Record<string, unknown>>();
	client.handlers.set("session.messages", () => history.promise);
	client.emit({
		version: "v1",
		event: "session.pending_prompt_submitted",
		eventId: "submitted",
		sessionId: "ses_1",
		payload: { prompt: { id: "queued", prompt: "next", createdAt: 1 } },
	});
	await waitFor(
		() => controller.getSnapshot().view.connectionStatus === "hydrating",
	);
	client.emit({
		version: "v1",
		event: "capability.requested",
		sessionId: "ses_1",
		payload: {
			requestId: "fresh",
			targetClientId: client.getClientId(),
			capabilityName: "tool_executor.askQuestion",
			payload: { args: ["Ready?", ["Yes", "No"]] },
		},
	});
	history.resolve({ messages: [] });
	await waitFor(() => events.length === 1);
	expect(events[0]).toMatchObject({
		type: "attention",
		kind: "question",
		focused: true,
	});
	launches.clear();
});

describe("retry acknowledgement reconciliation races", () => {
	it("does not resend input confirmed by hydration while a retry waits for session readiness", async () => {
		let accepted = 0;
		const { connection, client } = setUp({
			handlers: {
				"session.send_input": () => {
					accepted++;
					throw new HubTransportError(
						"hub_connection_closed",
						"Reply lost after acceptance",
					);
				},
				"session.messages": () => ({
					messages: accepted
						? [{ role: "user", content: "Accepted once" }]
						: [],
				}),
			},
		});
		await connection.start();
		await expect(connection.sendInput("Accepted once")).rejects.toThrow(
			"Reply lost",
		);
		const gate = deferred<void>();
		const ensure = connection.handle.ensureSession;
		connection.handle.ensureSession = async () => {
			await gate.promise;
			return ensure();
		};
		const retried = connection.retrySend("u1");
		await settle();
		await connection.resync();
		expect(connection.getView().messages).toHaveLength(1);
		expect(connection.getView().messages[0]?.pending).not.toBe(true);
		gate.resolve();
		await expect(retried).resolves.toBeUndefined();
		expect(accepted).toBe(1);
		expect(
			client.log.filter((name) => name === "session.send_input"),
		).toHaveLength(1);
		connection.dispose();
	});
});

it("does not resend a reconciled retry after a pending thinking update acknowledges", async () => {
	let accepted = 0;
	let thinking = false;
	const gate = deferred<Record<string, unknown>>();
	const { connection, client } = setUp({
		getReasoningChoice: () => (thinking ? "high" : undefined),
		handlers: {
			"session.send_input": () => {
				accepted++;
				throw new HubTransportError(
					"hub_connection_closed",
					"Reply lost after acceptance",
				);
			},
			"session.messages": () => ({
				messages: accepted ? [{ role: "user", content: "Already saved" }] : [],
			}),
			"session.update_connection": () => gate.promise,
		},
	});
	await connection.start();
	await expect(connection.sendInput("Already saved")).rejects.toThrow(
		"Reply lost",
	);
	thinking = true;
	const retry = connection.retrySend("u1");
	await waitFor(() => client.log.includes("session.update_connection"));
	await connection.resync();
	gate.resolve({});
	await expect(retry).resolves.toBeUndefined();
	expect(accepted).toBe(1);
	connection.dispose();
});

describe("SDK thinking acknowledgement broadcasts", () => {
	it("keeps the acknowledged effort when a same-model broadcast omitted reasoning before acknowledgement", async () => {
		const ack = deferred<Record<string, unknown>>();
		const { connection, client } = setUp({
			getReasoningChoice: () => "high",
			handlers: {
				"session.attach": () => ({
					session: {
						sessionId: "ses_1",
						model: "m",
						provider: "cline",
						metadata: { reasoningEffort: "low" },
					},
				}),
				"session.update_connection": () => ack.promise,
			},
		});
		await connection.start();
		const sending = connection.sendInput("Apply High");
		await settle();
		client.emit({
			version: "v1",
			event: "session.updated",
			eventId: "same-model-missing-thinking",
			sessionId: "ses_1",
			payload: {
				session: { sessionId: "ses_1", model: "m", provider: "cline" },
			},
		});
		ack.resolve({ updated: true });
		await sending;
		expect(connection.getView().model).toMatchObject({
			modelId: "m",
			providerId: "cline",
			reasoning: "high",
		});
		connection.dispose();
	});
});

describe("same-conversation recovery receipts", () => {
	it("retains a failed send and buffered partial answer, clears dead capabilities, and refuses another session", async () => {
		const source = setUp({
			handlers: {
				"session.send_input": () => {
					throw new Error("offline");
				},
			},
		});
		await source.connection.start();
		await expect(source.connection.sendInput("keep my ask")).rejects.toThrow(
			"offline",
		);
		source.client.emit({
			version: "v1",
			event: "approval.requested",
			sessionId: "ses_1",
			payload: approval(),
		});
		source.client.emit({
			version: "v1",
			event: "capability.requested",
			sessionId: "ses_1",
			payload: {
				requestId: "old-question",
				targetClientId: source.client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Ready?", ["Yes", "No"]] },
			},
		});
		const history = deferred<Record<string, unknown>>();
		source.client.handlers.set("session.messages", () => history.promise);
		const refreshing = source.connection.resync();
		await settle();
		source.client.emit(
			delta("buffered-before-replacement", "Keep partial answer"),
		);
		const recoveryState = source.connection.captureRecoveryState();
		const replacement = new SessionConnection({
			handle: handleFor(new ControlledHubClient()),
			recoveryState,
		});
		expect(replacement.getView().messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					failed: true,
					blocks: [{ kind: "text", text: "keep my ask" }],
				}),
				expect.objectContaining({
					blocks: [{ kind: "text", text: "Keep partial answer" }],
				}),
			]),
		);
		expect(replacement.getView().pendingApprovals).toEqual([]);
		expect(replacement.getView().pendingQuestions).toEqual([]);
		const unrelated = new SessionConnection({
			handle: handleFor(new ControlledHubClient(), {
				hubSessionId: "other-session",
			}),
			recoveryState,
		});
		expect(unrelated.getView().messages).toEqual([]);
		history.resolve({ messages: [] });
		await refreshing;
		source.connection.dispose();
		replacement.dispose();
		unrelated.dispose();
	});
});

it("preserves a newer explicit same-model effort while an older reasoning request acknowledges", async () => {
	const ack = deferred<Record<string, unknown>>();
	const { connection, client } = setUp({
		getReasoningChoice: () => "high",
		handlers: {
			"session.attach": () => ({
				session: {
					sessionId: "ses_1",
					model: "m",
					provider: "cline",
					metadata: { reasoningEffort: "low" },
				},
			}),
			"session.update_connection": () => ack.promise,
		},
	});
	await connection.start();
	const sending = connection.sendInput("High choice");
	await settle();
	client.emit({
		version: "v1",
		event: "session.updated",
		eventId: "explicit-same-model-low",
		sessionId: "ses_1",
		payload: {
			session: {
				sessionId: "ses_1",
				model: "m",
				provider: "cline",
				metadata: { reasoningEffort: "low" },
			},
		},
	});
	ack.resolve({ updated: true });
	await sending;
	expect(connection.getView().model?.reasoning).toBe("low");
	connection.dispose();
});

it("keeps first-send reasoning when the new session's model becomes known in the update broadcast before acknowledgement", async () => {
	const ack = deferred<Record<string, unknown>>();
	const { connection, client } = setUp({
		hubSessionId: undefined,
		getReasoningChoice: () => "high",
		handlers: {
			"session.create": () => ({ session: { sessionId: "ses_1" } }),
			"session.update_connection": () => ack.promise,
		},
	});
	await connection.start();
	expect(connection.getView().model).toBeUndefined();
	const sending = connection.sendInput("First send with High");
	await settle();
	client.emit({
		version: "v1",
		event: "session.updated",
		eventId: "first-known-model-no-effort",
		sessionId: connection.handle.hubSessionId,
		payload: {
			session: {
				sessionId: connection.handle.hubSessionId,
				provider: "cline",
				model: "new-model",
			},
		},
	});
	ack.resolve({ updated: true });
	await sending;
	expect(connection.getView().model).toMatchObject({
		providerId: "cline",
		modelId: "new-model",
		reasoning: "high",
	});
	connection.dispose();
});
