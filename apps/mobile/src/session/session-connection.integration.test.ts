/**
 * D1 end-to-end against the real hub server: `startTestHub` runs
 * `startHubWebSocketServer` from `@cline/core/hub` with a scripted runtime host,
 * so command dispatch, event projection, approval bookkeeping and subprotocol
 * auth are all the production code paths.
 */

import type { WebSocketCtor, WebSocketLike } from "@cline/hub-client";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDroppableTransport,
	resolveTestHubSession,
	waitFor,
} from "./__testing__/test-hub-handle";
import {
	type ApprovalPolicy,
	DEFAULT_APPROVAL_POLICY,
} from "./approval-policy";
import type { SessionDiagnostic } from "./reducer";
import { SessionConnection } from "./session-connection";

/**
 * A `WebSocketImpl` that holds the first `approval.list_pending` *reply* open
 * until released, so a live `approval.requested` can be made to land during the
 * recovery round trip — the exact window Bug A lost approvals in.
 */
function createListPendingGate(): {
	ctor: WebSocketCtor;
	hasHeldReply(): boolean;
	release(): void;
} {
	const base = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (!base) {
		throw new Error("No global WebSocket to wrap.");
	}
	let listRequestId: string | undefined;
	let held: { listener: (...args: unknown[]) => void; event: unknown } | null =
		null;

	class GatedSocket implements WebSocketLike {
		private readonly inner: WebSocketLike;

		constructor(url: string, protocols?: string | string[]) {
			const Base = base as unknown as new (
				url: string,
				protocols?: string | string[],
			) => WebSocketLike;
			this.inner = protocols ? new Base(url, protocols) : new Base(url);
		}

		get readyState(): number {
			return this.inner.readyState;
		}

		send(data: string): void {
			try {
				const frame = JSON.parse(data);
				if (
					frame?.kind === "command" &&
					frame?.envelope?.command === "approval.list_pending" &&
					typeof frame?.envelope?.requestId === "string"
				) {
					listRequestId = frame.envelope.requestId;
				}
			} catch {
				// Non-JSON frames are irrelevant to the gate.
			}
			this.inner.send(data);
		}

		close(): void {
			this.inner.close();
		}

		addEventListener(
			type: string,
			listener: (...args: unknown[]) => void,
		): void {
			if (type !== "message") {
				this.inner.addEventListener(type, listener);
				return;
			}
			this.inner.addEventListener("message", (event: unknown) => {
				const data = (event as { data?: unknown }).data;
				if (listRequestId && typeof data === "string") {
					try {
						const frame = JSON.parse(data);
						if (
							frame?.kind === "reply" &&
							frame?.envelope?.requestId === listRequestId
						) {
							held = { listener, event };
							return;
						}
					} catch {
						// fall through and deliver
					}
				}
				listener(event);
			});
		}
	}

	return {
		ctor: GatedSocket as unknown as WebSocketCtor,
		hasHeldReply: () => held !== null,
		release: () => {
			if (held) {
				held.listener(held.event);
				held = null;
			}
		},
	};
}

let hub: TestHub | undefined;
const openConnections: SessionConnection[] = [];

afterEach(async () => {
	for (const connection of openConnections.splice(0)) {
		connection.dispose();
	}
	await hub?.close();
	hub = undefined;
});

async function startConnection(
	testHub: TestHub,
	options: {
		diagnostics?: SessionDiagnostic[];
		getReasoningChoice?: () =>
			| import("./reasoning").ReasoningChoice
			| undefined;
		approvalPolicy?: ApprovalPolicy;
		WebSocketImpl?: Parameters<typeof resolveTestHubSession>[1] extends never
			? never
			: NonNullable<
					Parameters<typeof resolveTestHubSession>[1]
				>["WebSocketImpl"];
	} = {},
): Promise<SessionConnection> {
	const handle = await resolveTestHubSession(testHub, {
		...(options.WebSocketImpl ? { WebSocketImpl: options.WebSocketImpl } : {}),
	});
	const connection = new SessionConnection({
		handle,
		getReasoningChoice: options.getReasoningChoice,
		...(options.approvalPolicy
			? { approvalPolicy: options.approvalPolicy }
			: {}),
		...(options.diagnostics
			? { onDiagnostic: (entry) => options.diagnostics?.push(entry) }
			: {}),
	});
	openConnections.push(connection);
	await connection.start();
	return connection;
}

describe("a whole turn", () => {
	it("streams text and usage into the view model", async () => {
		hub = await startTestHub({
			script: [
				{ kind: "reasoning", chunks: ["Let me ", "think."] },
				{ kind: "text", chunks: ["Hel", "lo"] },
				{ kind: "usage", inputTokens: 11, outputTokens: 3, cost: 0.01 },
			],
		});
		const diagnostics: SessionDiagnostic[] = [];
		const connection = await startConnection(hub, { diagnostics });
		expect(connection.getView().connectionStatus).toBe("live");

		await connection.sendInput("say hello");
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"run completion",
		);

		const view = connection.getView();
		expect(view.messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				createdAt: expect.any(Number),
				pending: true,
				blocks: [{ kind: "text", text: "say hello" }],
			},
			{
				id: "a1",
				role: "assistant",
				origin: "live",
				createdAt: expect.any(Number),
				blocks: [
					{
						kind: "reasoning",
						text: "Let me think.",
						redacted: false,
						startedAt: expect.any(Number),
						completedAt: expect.any(Number),
					},
					{ kind: "text", text: "Hello" },
				],
			},
		]);
		expect(view.usage.turns).toEqual([
			{
				inputTokens: 11,
				outputTokens: 3,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.01,
			},
		]);
		expect(view.counters.unknownEvents).toBe(0);
		expect(view.counters.invalidEvents).toBe(0);
		expect(diagnostics).toEqual([]);

		// A resync replaces the optimistic pair with the persisted transcript.
		await connection.resync();
		const hydrated = connection.getView();
		expect(hydrated.messages.map((message) => message.id)).toEqual([
			"h0",
			"h1",
		]);
		expect(hydrated.messages[1]?.blocks).toEqual([
			{ kind: "text", text: "Hello" },
		]);
	});

	it("hydrates an existing transcript on a second connection", async () => {
		hub = await startTestHub({
			script: [{ kind: "text", chunks: ["first answer"] }],
		});
		const first = await startConnection(hub);
		await first.sendInput("first question");
		await waitFor(
			() => first.getView().runStatus === "completed",
			"first run completion",
		);
		first.dispose();

		const second = await startConnection(hub);
		const view = second.getView();
		expect(view.connectionStatus).toBe("live");
		expect(view.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(view.messages[1]?.blocks).toEqual([
			{ kind: "text", text: "first answer" },
		]);
	});
});

describe("approvals", () => {
	it("approves a pending tool and lets the run finish", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "echo hi" },
					output: "hi\n",
				},
				{ kind: "text", chunks: ["ran it"] },
			],
		});
		const connection = await startConnection(hub);
		const run = connection.sendInput("run echo");

		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"approval to arrive",
		);
		const approval = connection.getView().pendingApprovals[0];
		expect(approval?.toolName).toBe("bash");
		expect(approval?.inputJson).toContain("echo hi");

		await connection.respond(approval?.approvalId ?? "", true, "looks safe");
		await run;

		const view = connection.getView();
		expect(view.pendingApprovals).toEqual([]);
		expect(view.runStatus).toBe("completed");
		const blocks = view.messages.at(-1)?.blocks ?? [];
		expect(blocks[0]).toMatchObject({
			kind: "tool",
			name: "bash",
			state: "completed",
			output: "hi\n",
		});
		expect(blocks[1]).toEqual({ kind: "text", text: "ran it" });
	});

	it("denies a pending tool and marks the activity failed", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [{ kind: "tool", name: "bash", input: { command: "rm -rf /" } }],
		});
		const connection = await startConnection(hub);
		const run = connection.sendInput("do something dangerous");
		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"approval to arrive",
		);
		const approvalId =
			connection.getView().pendingApprovals[0]?.approvalId ?? "";
		await connection.respond(approvalId, false, "too dangerous");
		await run;

		const view = connection.getView();
		expect(view.pendingApprovals).toEqual([]);
		const toolBlock = view.messages
			.flatMap((message) => message.blocks)
			.find((block) => block.kind === "tool");
		expect(toolBlock).toMatchObject({ state: "failed" });
		expect(
			toolBlock && "error" in toolBlock ? toolBlock.error : undefined,
		).toMatch(/denied: too dangerous/);
	});

	it("recovers an approval raised before a fresh connection existed", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "deploy" },
					output: "deployed",
				},
			],
		});
		const first = await startConnection(hub);
		const run = first.sendInput("deploy it");
		await waitFor(
			() => first.getView().pendingApprovals.length === 1,
			"approval on the first connection",
		);
		const approvalId = first.getView().pendingApprovals[0]?.approvalId ?? "";

		// A second connection that was not listening when `approval.requested` was
		// published can only learn about it from `approval.list_pending`.
		const second = await startConnection(hub);
		expect(second.handle.hubSessionId).toBe(first.handle.hubSessionId);
		expect(
			second.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toEqual([approvalId]);

		await second.respond(approvalId, true, "recovered and approved");
		await run;

		await waitFor(
			() => first.getView().pendingApprovals.length === 0,
			"the first connection to see the resolution",
		);
		// `run` is the *first* connection's reply; the second connection learns the
		// run finished from its own event stream, which lands independently.
		await waitFor(
			() => second.getView().runStatus === "completed",
			"the second connection to see the run finish",
		);
		await second.refreshPendingApprovals();
		expect(second.getView().pendingApprovals).toEqual([]);
	});

	it("keeps an approval requested during the list_pending round trip", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "deploy" },
					output: "deployed",
				},
			],
		});
		// A second connection whose recovery snapshot is captured (empty) before any
		// approval exists, with its reply held open across the round trip.
		const first = await startConnection(hub);
		// The inner session is created up front so the second connection resolves to
		// *this* session and attaches to it. Without that it owns no session, and the
		// ownership filter in `onEvent` correctly refuses to render another client's
		// events — which is a different guarantee, covered separately.
		await first.handle.ensureSession();
		const gate = createListPendingGate();
		const secondHandle = await resolveTestHubSession(hub, {
			WebSocketImpl: gate.ctor,
		});
		const second = new SessionConnection({ handle: secondHandle });
		openConnections.push(second);
		const secondStart = second.start();
		await waitFor(
			() => gate.hasHeldReply(),
			"the second connection's list_pending reply to be captured",
		);

		// Now — after the empty snapshot was taken — an approval is raised and reaches
		// the second connection as a live event while its recovery is still in flight.
		const run = first.sendInput("deploy it");
		run.catch(() => {});
		await waitFor(
			() => first.getView().pendingApprovals.length === 1,
			"the approval to be raised",
		);
		await waitFor(
			() => second.getView().pendingApprovals.length === 1,
			"the second connection to see the live approval",
		);

		// Releasing the stale empty snapshot must not wipe the live approval.
		gate.release();
		await secondStart;
		expect(
			second.getView().pendingApprovals.map((entry) => entry.approvalId),
		).toHaveLength(1);
	});

	it("treats a second answer to the same approval as info, not failure", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [{ kind: "tool", name: "bash", output: "ok" }],
		});
		const diagnostics: SessionDiagnostic[] = [];
		const connection = await startConnection(hub, { diagnostics });
		const run = connection.sendInput("list files");
		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"approval to arrive",
		);
		const approvalId =
			connection.getView().pendingApprovals[0]?.approvalId ?? "";
		await connection.respond(approvalId, true);
		await run;

		await expect(connection.respond(approvalId, true)).resolves.toBeUndefined();
		expect(diagnostics).toEqual([
			{
				level: "info",
				type: "approval_already_resolved",
				approvalId,
			},
		]);
	});

	it("re-attaches the current client and retries when the hub dropped its participant record", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "deploy" },
					output: "deployed",
				},
			],
		});
		const connection = await startConnection(hub);
		const run = connection.sendInput("deploy it");
		run.catch(() => {});
		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"the approval to arrive",
		);
		const approvalId =
			connection.getView().pendingApprovals[0]?.approvalId ?? "";
		const sessionId = connection.handle.hubSessionId;
		expect(sessionId).toBeTruthy();

		// A reconnect makes the hub drop this client's participant record (and its
		// creator link) the moment the socket closes; `session.detach` reproduces
		// that server state deterministically, without racing the auto-reconnect.
		await connection.handle.client.command(
			"session.detach",
			{ sessionId },
			sessionId,
		);

		// The client now owns a session it is no longer a participant of. Answering
		// must re-attach the current client and retry once, not fail not_authorized.
		await expect(
			connection.respond(approvalId, true, "ok"),
		).resolves.toBeUndefined();
		await run;
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"the run to complete after the retried answer",
		);
		expect(connection.getView().pendingApprovals).toEqual([]);
	});
});

describe("abort", () => {
	it("aborts a stalled run and reports it in the view model", async () => {
		hub = await startTestHub({
			script: [
				{ kind: "text", chunks: ["one ", "two "] },
				{ kind: "abortable-stall" },
			],
		});
		const connection = await startConnection(hub);
		const run = connection.sendInput("stream then stall");
		await waitFor(
			() =>
				connection
					.getView()
					.messages.some((message) =>
						message.blocks.some(
							(block) => block.kind === "text" && block.text === "one two ",
						),
					),
			"streamed text",
		);
		expect(connection.getView().runStatus).toBe("running");

		await connection.abort("user cancelled");
		await run;
		await waitFor(
			() => connection.getView().runStatus === "aborted",
			"aborted status",
		);
		expect(connection.getView().messages.at(-1)?.blocks).toEqual([
			{ kind: "text", text: "one two " },
		]);
	});
});

describe("reconnect mid-run", () => {
	it("converges on the persisted transcript after a real socket drop", async () => {
		hub = await startTestHub({
			script: [
				{ kind: "text", chunks: ["part one "] },
				{ kind: "gate", id: "resume" },
				{ kind: "text", chunks: ["part two"] },
			],
		});
		const transport = createDroppableTransport();
		const diagnostics: SessionDiagnostic[] = [];
		const connection = await startConnection(hub, {
			diagnostics,
			WebSocketImpl: transport.ctor,
		});
		// The drop rejects the in-flight `session.send_input` reply even though the
		// run keeps going on the hub; recovering the outcome is the resync's job.
		const run = connection
			.sendInput("stream in two parts")
			.then(() => "replied")
			.catch(() => "dropped");
		await waitFor(
			() =>
				connection
					.getView()
					.messages.some((message) =>
						message.blocks.some(
							(block) => block.kind === "text" && block.text === "part one ",
						),
					),
			"the first half to stream",
		);

		transport.drop();
		await waitFor(
			() => connection.getView().connectionStatus === "reconnecting",
			"the drop to be observed",
		);
		await waitFor(
			() =>
				connection.getView().connectionStatus === "live" &&
				diagnostics.some((entry) => entry.type === "resynced"),
			"the resync to finish",
		);
		expect(transport.openedCount()).toBeGreaterThan(1);
		expect(diagnostics.some((entry) => entry.type === "resynced")).toBe(true);
		// Mid-run the transcript holds only the user turn — the run has not
		// terminated, so the hub has nothing persisted for it and these deltas will
		// never be re-delivered. The partial therefore has to survive the resync: the
		// convergence contract is that the transcript *supersedes* the live tail, not
		// that a hydrate blanks an answer the user is watching being written.
		expect(connection.getView().messages.map((message) => message.id)).toEqual([
			"h0",
			"a1",
		]);
		expect(connection.getView().messages[1]?.blocks).toEqual([
			{ kind: "text", text: "part one " },
		]);

		expect(await run).toBe("dropped");
		hub.releaseGate("resume");
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"the resumed run to finish",
		);
		// The resumed half lands on the surviving turn rather than opening a new one.
		// Each `assistant.finished` is authoritative only for its own content segment,
		// so the second segment cannot overwrite the first one that survived resync.
		expect(connection.getView().messages.at(-1)?.blocks).toEqual([
			{ kind: "text", text: "part one " },
			{ kind: "text", text: "part two" },
		]);

		// Once the run is persisted, the next resync reproduces the whole turn.
		await connection.resync();
		const converged = connection.getView();
		expect(converged.messages.map((message) => message.id)).toEqual([
			"h0",
			"h1",
		]);
		expect(converged.messages[1]?.blocks).toEqual([
			{ kind: "text", text: "part one part two" },
		]);
		expect(converged.counters.duplicateEvents).toBe(0);
	});

	it("explains an interrupted question and accepts a fresh one after socket recovery", async () => {
		hub = await startTestHub({ script: [{ kind: "text", chunks: ["hi"] }] });
		const transport = createDroppableTransport();
		const handle = await resolveTestHubSession(hub, {
			WebSocketImpl: transport.ctor,
		});
		const sessionId = await handle.ensureSession();
		const connection = new SessionConnection({ handle });
		openConnections.push(connection);
		await connection.start();
		const requestQuestion = () =>
			handle.client.command(
				"capability.request",
				{
					sessionId,
					targetClientId: handle.client.getClientId(),
					capabilityName: "tool_executor.askQuestion",
					payload: { args: ["Ready?", ["Yes", "No"]] },
				},
				sessionId,
			);
		const interrupted = requestQuestion().then(
			() => "answered",
			() => "disconnected",
		);
		await waitFor(
			() => connection.getView().pendingQuestions.length === 1,
			"the original question",
		);
		const oldRequestId = connection.getView().pendingQuestions[0].requestId;
		transport.drop();
		await waitFor(
			() => connection.getView().questionInterrupted === true,
			"the interruption notice",
		);
		expect(connection.getView().pendingQuestions).toEqual([]);
		expect(await interrupted).toBe("disconnected");
		await waitFor(
			() => connection.getView().connectionStatus === "live",
			"socket recovery",
		);
		expect(connection.getView().questionInterrupted).toBe(true);
		await connection.respondQuestion(oldRequestId, "Yes");
		const fresh = requestQuestion();
		await waitFor(
			() => connection.getView().pendingQuestions.length === 1,
			"a fresh question",
		);
		expect(connection.getView().questionInterrupted).toBeUndefined();
		await connection.respondQuestion(
			connection.getView().pendingQuestions[0].requestId,
			"Yes",
		);
		expect((await fresh).payload).toEqual({ result: "Yes" });
	});

	it("recovers a run that finished while the socket was down", async () => {
		hub = await startTestHub({
			script: [
				{ kind: "text", chunks: ["thinking "] },
				{ kind: "gate", id: "finish" },
				{ kind: "text", chunks: ["done"] },
			],
		});
		// An independent observer tells the test when the hub finished the run; the
		// mobile connection is offline and cannot be asked.
		const observer = await hub.connectClient();
		await observer.subscribeReady();

		const transport = createDroppableTransport();
		const connection = await startConnection(hub, {
			WebSocketImpl: transport.ctor,
		});
		const run = connection.sendInput("do the thing").catch(() => "dropped");
		await waitFor(
			() => connection.getView().runStatus === "running",
			"the run to start",
		);

		transport.block();
		transport.drop();
		await waitFor(
			() => connection.getView().connectionStatus === "reconnecting",
			"the drop to be observed",
		);
		hub.releaseGate("finish");
		await observer.waitForEvent("run.completed");
		expect(await run).toBe("dropped");
		// The terminal event was published to nobody: without an authoritative
		// status the UI would sit on "running" forever.
		expect(connection.getView().runStatus).toBe("running");

		transport.unblock();
		await waitFor(
			() => connection.getView().connectionStatus === "live",
			"the resync to finish",
		);
		expect(connection.getView().runStatus).toBe("completed");
		expect(connection.getView().messages.at(-1)?.blocks).toEqual([
			{ kind: "text", text: "thinking done" },
		]);
		observer.close();
	});
});

describe("tiered auto-approve", () => {
	const ALL_ASK: ApprovalPolicy = {
		read: "ask",
		write: "ask",
		execute: "ask",
	};
	const EXECUTE_AUTO: ApprovalPolicy = {
		read: "auto",
		write: "auto",
		execute: "auto",
	};

	/** One `bash` step: an execute-tier tool that always needs an approval. */
	const BASH_TURN = {
		approvals: "wait-for-respond" as const,
		script: [
			{
				kind: "tool" as const,
				name: "bash",
				input: { command: "ls -la" },
				output: "total 0\n",
			},
			{ kind: "text" as const, chunks: ["done"] },
		],
	};

	it("completes an execute-tier turn with no manual respond when execute is auto", async () => {
		hub = await startTestHub(BASH_TURN);
		const connection = await startConnection(hub, {
			approvalPolicy: EXECUTE_AUTO,
		});

		// Only sendInput — `respond` is never called in this test.
		await connection.sendInput("list the files");
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"the auto-approved run to complete",
		);

		const view = connection.getView();
		expect(view.pendingApprovals).toEqual([]);
		expect(
			view.messages
				.flatMap((message) => message.blocks)
				.find((block) => block.kind === "tool"),
		).toMatchObject({ name: "bash", state: "completed" });
	});

	it("leaves an execute-tier tool pending when execute is ask", async () => {
		hub = await startTestHub(BASH_TURN);
		const connection = await startConnection(hub, { approvalPolicy: ALL_ASK });

		const run = connection.sendInput("list the files");
		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"the approval to arrive",
		);
		// Nothing auto-answers it: it is still pending after a settle.
		await new Promise((resolve) => setTimeout(resolve, 100));
		const pending = connection.getView().pendingApprovals;
		expect(pending).toHaveLength(1);
		expect(pending[0]?.toolName).toBe("bash");
		expect(connection.getView().runStatus).toBe("running");

		await connection.respond(pending[0]?.approvalId ?? "", true, "ok");
		await run;
		expect(connection.getView().runStatus).toBe("completed");
	});

	it("under the default policy completes read, write and execute tools without a manual response", async () => {
		hub = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "read_file",
					input: { path: "README.md" },
					output: "# hello",
				},
				{
					kind: "tool",
					name: "apply_patch",
					input: { patch: "example" },
					output: "updated",
				},
				{
					kind: "tool",
					name: "bash",
					input: { command: "rm -rf build" },
					output: "removed",
				},
				{ kind: "text", chunks: ["finished"] },
			],
		});
		const connection = await startConnection(hub, {
			approvalPolicy: DEFAULT_APPROVAL_POLICY,
		});

		await connection.sendInput("read, edit, then clean");
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"the auto-approved run to complete",
		);
		expect(connection.getView().pendingApprovals).toEqual([]);
		const tools = connection
			.getView()
			.messages.flatMap((message) => message.blocks)
			.filter((block) => block.kind === "tool");
		expect(tools).toMatchObject([
			{ name: "read_file", state: "completed" },
			{ name: "apply_patch", state: "completed" },
			{ name: "bash", state: "completed" },
		]);
	});

	it("setApprovalPolicy answers an approval that was already pending", async () => {
		hub = await startTestHub(BASH_TURN);
		const connection = await startConnection(hub, { approvalPolicy: ALL_ASK });

		const run = connection.sendInput("list the files");
		await waitFor(
			() => connection.getView().pendingApprovals.length === 1,
			"the approval to arrive",
		);

		// Flipping the tier on mid-session must unblock the waiting run.
		connection.setApprovalPolicy(EXECUTE_AUTO);
		expect(connection.getApprovalPolicy()).toEqual(EXECUTE_AUTO);

		await run;
		await waitFor(
			() => connection.getView().runStatus === "completed",
			"the run to complete after the policy change",
		);
		expect(connection.getView().pendingApprovals).toEqual([]);
	});
});

/**
 * Model selection, end to end against the production hub server: the read half
 * (`catalog.list`, which had no handler before this branch) and the announce
 * half (`session.update_connection` broadcasting `session.updated`). The
 * two-connection shape is the point — the phone that changes the model must not
 * be the only client that knows.
 */
describe("model selection", () => {
	it("delivers thinking settings through the real Hub before the next input", async () => {
		hub = await startTestHub();
		// The scripted runtime only implements model changes. Spy at its boundary
		// to verify production Hub dispatch without claiming an LLM ran with it.
		const update = vi.spyOn(hub.runtimeHost, "updateSessionConnection");
		const run = vi.spyOn(hub.runtimeHost, "runTurn");
		let choice: import("./reasoning").ReasoningChoice = "high";
		const connection = await startConnection(hub, {
			getReasoningChoice: () => choice,
		});
		await connection.sendInput("First thinking turn");
		expect(update).toHaveBeenLastCalledWith(expect.any(String), {
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: null,
		});
		expect(update.mock.invocationCallOrder[0]).toBeLessThan(
			run.mock.invocationCallOrder[0]!,
		);
		choice = "none";
		await connection.sendInput("Second thinking turn");
		expect(update).toHaveBeenLastCalledWith(expect.any(String), {
			// The Hub normalizes disabled thinking into cleared optional fields.
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
		});
		expect(update.mock.invocationCallOrder[1]).toBeLessThan(
			run.mock.invocationCallOrder[1]!,
		);
	});
	it("reads the current model off the attach reply", async () => {
		hub = await startTestHub();
		// The session must exist first: a CREATOR has no hub session at start()
		// (creation is lazy, on the first send), so there is no record to read.
		// The attach path — a phone opening an existing session — is where the
		// model readback matters and where it must work.
		const creator = await startConnection(hub);
		await creator.sendInput("first question");
		await waitFor(
			() => creator.getView().runStatus === "completed",
			"first run completion",
		);
		creator.dispose();

		const returning = await startConnection(hub);
		expect(returning.getView().model).toEqual({
			providerId: "testkit",
			modelId: "testkit-model",
		});
	});

	it("lists the machine's catalog over the wire", async () => {
		hub = await startTestHub();
		const connection = await startConnection(hub);
		const catalog = await connection.listModelCatalog();
		expect(catalog.providers).toEqual([
			{
				id: "testkit",
				name: "Testkit",
				enabled: true,
				defaultModelId: "testkit-model",
			},
		]);
		expect(catalog.modelsByProvider.testkit?.map((model) => model.id)).toEqual([
			"testkit-model",
			"testkit-model-mini",
		]);
	});

	it("converges every observer on a model change", async () => {
		hub = await startTestHub();
		const changer = await startConnection(hub);
		await changer.sendInput("first question");
		await waitFor(
			() => changer.getView().runStatus === "completed",
			"first run completion",
		);
		const observer = await startConnection(hub);

		await changer.updateModel("testkit-model-mini", { providerId: "testkit" });

		await waitFor(
			() => observer.getView().model?.modelId === "testkit-model-mini",
			"observer to adopt the new model",
		);
		expect(changer.getView().model?.modelId).toBe("testkit-model-mini");
		expect(observer.getView().model?.providerId).toBe("testkit");
	});
});

describe("another client's immediate input", () => {
	it("recovers the originating user prompt while the phone remains on the same live conversation", async () => {
		hub = await startTestHub({
			script: [{ kind: "text", chunks: ["Desktop answer"] }],
		});
		const desktop = hub.createClient({
			clientType: "desktop-observer-regression",
		});
		await desktop.connect();
		const sessionId = await desktop.createSession();
		const mobile = await startConnection(hub);
		expect(mobile.handle.hubSessionId).toBe(sessionId);
		// Hub subscription was registered during start/attach/hydrate. Only this
		// separate socket submits the prompt; the phone has no optimistic bubble.
		await desktop.sendInput(sessionId, "Question sent from desktop");
		await waitFor(
			() => mobile.getView().runStatus === "completed",
			"remote run completion",
		);
		const persisted = await desktop.client.command(
			"session.messages",
			{ sessionId },
			sessionId,
		);
		expect(persisted.payload?.messages).toContainEqual({
			role: "user",
			content: "Question sent from desktop",
		});
		await waitFor(
			() =>
				mobile
					.getView()
					.messages.some(
						(message) =>
							message.role === "user" &&
							message.blocks.some(
								(block) =>
									block.kind === "text" &&
									block.text === "Question sent from desktop",
							),
					),
			"originating remote user prompt without foregrounding or reconnecting",
			1_000,
		);
	});
});
