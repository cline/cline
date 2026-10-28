import { HubClient } from "@cline/hub-client";
import { fakeHubSocketFor } from "@cline/hub-testkit/replay";
import type { HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type FixtureScenario,
	fixtureEvents,
	fixtureHydrateReply,
	listFixtureScenarios,
	loadFixture,
} from "./__testing__/hub-fixtures";
import {
	createSessionState,
	optimisticMessageId,
	reduceSession,
	type SessionState,
	type SessionViewModel,
	selectOptimisticSend,
	selectViewModel,
} from "./reducer";
import { parseSessionMessagesReply } from "./schemas";

function applyEvents(
	state: SessionState,
	events: HubEventEnvelope[],
): SessionState {
	return events.reduce(
		(current, envelope) => reduceSession(current, { type: "event", envelope }),
		state,
	);
}

function liveState(): SessionState {
	return reduceSession(
		reduceSession(createSessionState(), { type: "hydrate_started" }),
		{ type: "hydrated", messages: [] },
	);
}

async function viewFromFixture(
	scenario: FixtureScenario,
): Promise<SessionViewModel> {
	const events = await fixtureEvents(scenario);
	return selectViewModel(applyEvents(liveState(), events));
}

describe("view model golden shapes per fixture", () => {
	it("projects live and hydrated media instead of dropping it", () => {
		let live = liveState();
		live = applyEvents(live, [
			{
				version: "v1",
				event: "assistant.media",
				eventId: "media-1",
				sessionId: "ses_1",
				payload: {
					media: {
						id: "generated-1",
						modality: "image",
						mediaType: "image/png",
						source: { type: "base64", data: "aGVsbG8=" },
					},
				},
			},
		]);
		expect(selectViewModel(live).messages[0]?.blocks[0]).toMatchObject({
			kind: "media",
			media: { id: "generated-1" },
		});

		const hydrated = reduceSession(
			reduceSession(createSessionState(), { type: "hydrate_started" }),
			{
				type: "hydrated",
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "media",
								media: {
									id: "persisted-generated-1",
									modality: "image",
									mediaType: "image/png",
									source: { type: "base64", data: "aGVsbG8=" },
								},
							},
						],
					},
				],
			},
		);
		expect(selectViewModel(hydrated).messages[0]?.blocks[0]).toMatchObject({
			kind: "media",
			media: {
				id: "persisted-generated-1",
				modality: "image",
				mediaType: "image/png",
			},
		});
	});

	it("happy-turn collapses assistant deltas into one text block", async () => {
		const view = await viewFromFixture("happy-turn");
		expect(view).toMatchObject({
			connectionStatus: "live",
			runStatus: "completed",
			pendingApprovals: [],
			messages: [
				{
					id: "a1",
					role: "assistant",
					origin: "live",
					blocks: [{ kind: "text", text: "Hello" }],
				},
			],
		});
		expect(view.usage).toEqual({
			turns: [
				{
					inputTokens: 11,
					outputTokens: 3,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.01,
				},
			],
			total: {
				inputTokens: 11,
				outputTokens: 3,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.01,
			},
		});
		expect(view.counters.unknownEvents).toBe(0);
		expect(view.counters.invalidEvents).toBe(0);
	});

	it("reasoning-turn keeps reasoning ahead of text with a redacted flag", async () => {
		const view = await viewFromFixture("reasoning-turn");
		expect(view.messages).toEqual([
			{
				id: "a1",
				role: "assistant",
				origin: "live",
				blocks: [
					{ kind: "reasoning", text: "Let me think.", redacted: false },
					{ kind: "text", text: "Answer." },
				],
			},
		]);
		expect(view.runStatus).toBe("completed");
	});

	it("approval-approve completes the tool and clears the approval", async () => {
		const view = await viewFromFixture("approval-approve");
		expect(view.messages).toEqual([
			{
				id: "a1",
				role: "assistant",
				origin: "live",
				blocks: [
					{
						kind: "tool",
						toolCallId: "<toolCall_1>",
						name: "bash",
						state: "completed",
						input: { command: "echo hi" },
						output: "hi\n",
					},
					{ kind: "text", text: "ran it" },
				],
			},
		]);
		expect(view.pendingApprovals).toEqual([]);
		expect(view.runStatus).toBe("completed");
	});

	it("approval-deny marks the tool failed with the denial reason", async () => {
		const view = await viewFromFixture("approval-deny");
		expect(view.messages[0]?.blocks).toEqual([
			{
				kind: "tool",
				toolCallId: "<toolCall_1>",
				name: "bash",
				state: "failed",
				input: { command: "rm -rf /" },
				error: "Tool bash was denied: too dangerous",
			},
		]);
		expect(view.pendingApprovals).toEqual([]);
	});

	it("approval-resolved-elsewhere drops the approval on the resolved event", async () => {
		const events = await fixtureEvents("approval-resolved-elsewhere");
		const requestedIndex = events.findIndex(
			(event) => event.event === "approval.requested",
		);
		const pending = selectViewModel(
			applyEvents(liveState(), events.slice(0, requestedIndex + 1)),
		);
		expect(pending.pendingApprovals.map((entry) => entry.approvalId)).toEqual([
			"<approval_1>",
		]);
		const settled = selectViewModel(applyEvents(liveState(), events));
		expect(settled.pendingApprovals).toEqual([]);
	});

	it("approval-recovery projects a tool that started before we connected", async () => {
		const view = await viewFromFixture("approval-recovery");
		expect(view.messages).toEqual([
			{
				id: "a1",
				role: "assistant",
				origin: "live",
				blocks: [
					{
						kind: "tool",
						toolCallId: "<toolCall_1>",
						name: "bash",
						state: "completed",
						output: "deployed",
					},
				],
			},
		]);
		expect(view.runStatus).toBe("completed");
	});

	it("abort-mid-stream keeps streamed text and reports the aborted run", async () => {
		const view = await viewFromFixture("abort-mid-stream");
		expect(view.runStatus).toBe("aborted");
		expect(view.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "one two " },
		]);
	});

	it("auth-failure yields the untouched initial view", async () => {
		const view = await viewFromFixture("auth-failure");
		expect(view.messages).toEqual([]);
		expect(view.runStatus).toBe("idle");
	});
});

describe("subscribe-buffer-hydrate-merge", () => {
	it("buffers events until the hydrate reply lands", async () => {
		const events = await fixtureEvents("happy-turn");
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = applyEvents(state, events);
		expect(selectViewModel(state)).toMatchObject({
			connectionStatus: "hydrating",
			messages: [],
			runStatus: "idle",
		});
		state = reduceSession(state, { type: "hydrated", messages: [] });
		const view = selectViewModel(state);
		expect(view.connectionStatus).toBe("live");
		expect(view.messages).toHaveLength(1);
	});

	it("does not duplicate a completed run that the hydrate already contains", async () => {
		const fixture = await loadFixture("reconnect-mid-run");
		const events = await fixtureEvents("reconnect-mid-run");
		const reply = parseSessionMessagesReply(fixtureHydrateReply(fixture));
		if (reply.status !== "ok") {
			throw new Error("reconnect-mid-run must record a session.messages reply");
		}

		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = applyEvents(state, events);
		state = reduceSession(state, {
			type: "hydrated",
			messages: reply.messages,
		});
		const view = selectViewModel(state);

		// The persisted transcript is authoritative for the finished run: the
		// buffered partial ("part two") must not survive next to "part one part two".
		expect(view.messages).toEqual([
			{
				id: "h0",
				role: "user",
				origin: "hydrated",
				blocks: [{ kind: "text", text: "stream in two parts" }],
			},
			{
				id: "h1",
				role: "assistant",
				origin: "hydrated",
				blocks: [{ kind: "text", text: "part one part two" }],
			},
		]);
		// Terminal status and usage from the buffered window are still applied.
		expect(view.runStatus).toBe("completed");
		expect(view.usage.total?.inputTokens).toBe(5);
		expect(view.counters.reflectedBufferedEvents).toBeGreaterThan(0);
	});

	it("replays only the not-yet-persisted tail of the hydrate window", async () => {
		const hydrateWindow: HubEventEnvelope[] = [
			{ version: "v1", event: "run.completed", eventId: "e1", payload: {} },
			{ version: "v1", event: "run.started", eventId: "e2" },
			{
				version: "v1",
				event: "assistant.delta",
				eventId: "e3",
				payload: { text: "fresh" },
			},
		];
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = applyEvents(state, hydrateWindow);
		state = reduceSession(state, {
			type: "hydrated",
			messages: [{ role: "user", content: "old" }],
		});
		const view = selectViewModel(state);
		expect(view.messages.map((message) => message.id)).toEqual(["h0", "a1"]);
		expect(view.messages[1]?.blocks).toEqual([{ kind: "text", text: "fresh" }]);
		expect(view.runStatus).toBe("running");
	});

	it("drops a repeated eventId", async () => {
		const event: HubEventEnvelope = {
			version: "v1",
			event: "assistant.delta",
			eventId: "evt_dup",
			payload: { text: "x" },
		};
		const state = applyEvents(liveState(), [event, event, event]);
		expect(selectViewModel(state).messages[0]?.blocks).toEqual([
			{ kind: "text", text: "x" },
		]);
		expect(selectViewModel(state).counters.duplicateEvents).toBe(2);
	});

	it("reconciles an optimistic user message against the hydrate", () => {
		let state = liveState();
		state = reduceSession(state, { type: "user_input", text: "hello there" });
		state = reduceSession(state, { type: "user_input", text: "second" });
		expect(selectViewModel(state).messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				pending: true,
				blocks: [{ kind: "text", text: "hello there" }],
			},
			{
				id: "u2",
				role: "user",
				origin: "live",
				pending: true,
				blocks: [{ kind: "text", text: "second" }],
			},
		]);

		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [{ role: "user", content: "hello there" }],
		});
		const view = selectViewModel(state);
		expect(
			view.messages.map((message) => [message.id, message.pending]),
		).toEqual([
			["h0", undefined],
			["u2", true],
		]);
	});

	it("reconciles optimistic text against the persisted user-input envelope", () => {
		let state = liveState();
		state = reduceSession(state, {
			type: "user_input",
			text: "ship it",
		});
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [
				{
					role: "user",
					content:
						'<user_input mode="act"><mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>ship it</user_input>',
				},
			],
		});

		expect(
			selectViewModel(state).messages.map((message) => [
				message.id,
				message.pending,
			]),
		).toEqual([["h0", undefined]]);
	});
});

describe("authoritative run status on hydrate", () => {
	function approval(overrides: Record<string, unknown> = {}) {
		return {
			approvalId: "ap_1",
			sessionId: "ses_1",
			agentId: "ag_1",
			conversationId: "cv_1",
			iteration: 1,
			toolCallId: "tc_1",
			toolName: "bash",
			inputJson: "{}",
			policy: {},
			createdAt: 1,
			...overrides,
		} as never;
	}

	it("replaces a stale running status with the status the hub reports", () => {
		let state = applyEvents(liveState(), [
			{ version: "v1", event: "run.started", eventId: "e1" },
		]);
		expect(selectViewModel(state).runStatus).toBe("running");

		// The run finished while this client was offline: no terminal event was ever
		// delivered, so only the authoritative snapshot can correct the status.
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [
				{ role: "user", content: "do it" },
				{ role: "assistant", content: "did it" },
			],
			runStatus: "completed",
		});
		expect(selectViewModel(state).runStatus).toBe("completed");
	});

	it("keeps the current status when the hub reported none", () => {
		let state = applyEvents(liveState(), [
			{ version: "v1", event: "run.started", eventId: "e1" },
		]);
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, { type: "hydrated", messages: [] });
		expect(selectViewModel(state).runStatus).toBe("running");
	});

	it("lets a buffered terminal event win over the older snapshot", () => {
		let state = reduceSession(liveState(), { type: "hydrate_started" });
		state = applyEvents(state, [
			{ version: "v1", event: "run.completed", eventId: "e1", payload: {} },
		]);
		state = reduceSession(state, {
			type: "hydrated",
			messages: [],
			runStatus: "running",
		});
		expect(selectViewModel(state).runStatus).toBe("completed");
	});

	it("lets a live event after the hydrate win over the snapshot", () => {
		let state = reduceSession(liveState(), { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [],
			runStatus: "completed",
		});
		state = applyEvents(state, [
			{ version: "v1", event: "run.started", eventId: "e2" },
		]);
		expect(selectViewModel(state).runStatus).toBe("running");
	});

	it("treats a recovered approval list as a snapshot, not an addition", () => {
		let state = applyEvents(liveState(), [
			{
				version: "v1",
				event: "approval.requested",
				eventId: "e1",
				payload: approval({ approvalId: "ap_1" }),
			},
			{
				version: "v1",
				event: "approval.requested",
				eventId: "e2",
				payload: approval({ approvalId: "ap_2", createdAt: 2 }),
			},
		]);
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1", "ap_2"]);

		// ap_1 was answered elsewhere while this client was away; the recovered list
		// is authoritative for the session, so it must not survive.
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [approval({ approvalId: "ap_2", createdAt: 2 })],
			now: 0,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_2"]);
	});

	it("drops recovered approvals that have already expired locally", () => {
		const state = reduceSession(liveState(), {
			type: "approvals_recovered",
			approvals: [
				approval({ approvalId: "ap_live", expiresAt: 2_000 }),
				approval({ approvalId: "ap_gone", expiresAt: 500 }),
				approval({ approvalId: "ap_forever" }),
			],
			now: 1_000,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_forever", "ap_live"]);
	});
});

describe("failed sends", () => {
	it("marks the optimistic message retryable and clears it on retry", () => {
		let state = reduceSession(liveState(), {
			type: "user_input",
			text: "deploy it",
		});
		const messageId = optimisticMessageId(state.inputSeq);
		expect(messageId).toBe("u1");
		expect(selectOptimisticSend(state, messageId)).toBeUndefined();

		state = reduceSession(state, {
			type: "send_failed",
			messageId,
			detail: "hub connection closed",
		});
		expect(selectViewModel(state).messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				pending: true,
				failed: true,
				error: "hub connection closed",
				blocks: [{ kind: "text", text: "deploy it" }],
			},
		]);
		// Only a failed send is retryable; the text comes back out of the state so a
		// retry does not need the caller to have kept it.
		expect(selectOptimisticSend(state, messageId)).toBe("deploy it");

		state = reduceSession(state, { type: "send_retried", messageId });
		expect(selectViewModel(state).messages).toEqual([
			{
				id: "u1",
				role: "user",
				origin: "live",
				pending: true,
				blocks: [{ kind: "text", text: "deploy it" }],
			},
		]);
		expect(selectOptimisticSend(state, messageId)).toBeUndefined();
	});

	it("keeps a failed message across a hydrate that has not caught up", () => {
		let state = reduceSession(liveState(), { type: "user_input", text: "one" });
		state = reduceSession(state, {
			type: "send_failed",
			messageId: "u1",
			detail: "boom",
		});
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, { type: "hydrated", messages: [] });
		expect(selectViewModel(state).messages).toEqual([
			expect.objectContaining({ id: "u1", failed: true, error: "boom" }),
		]);
	});

	it("drops a failed message once the transcript proves it landed", () => {
		let state = reduceSession(liveState(), { type: "user_input", text: "one" });
		state = reduceSession(state, {
			type: "send_failed",
			messageId: "u1",
			detail: "lost the reply",
		});
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [{ role: "user", content: "one" }],
		});
		expect(selectViewModel(state).messages.map((entry) => entry.id)).toEqual([
			"h0",
		]);
	});

	it("ignores a failure aimed at a message that is already reconciled", () => {
		const state = reduceSession(liveState(), {
			type: "send_failed",
			messageId: "u7",
			detail: "boom",
		});
		expect(selectViewModel(state).messages).toEqual([]);
	});
});

describe("diagnostics and counters", () => {
	let state: SessionState;

	beforeEach(() => {
		state = liveState();
	});

	it("counts an unknown event name and emits one diagnostic", () => {
		const next = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "assistant.telepathy" as HubEventEnvelope["event"],
				eventId: "e1",
			},
		});
		expect(next.emitted).toEqual([
			{ level: "warn", type: "unknown_event", event: "assistant.telepathy" },
		]);
		expect(selectViewModel(next).counters.unknownEvents).toBe(1);
	});

	it("counts a malformed payload and never throws", () => {
		const next = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "assistant.delta",
				eventId: "e1",
				payload: { text: 12 },
			},
		});
		expect(next.emitted[0]).toMatchObject({
			level: "warn",
			type: "invalid_event_payload",
			event: "assistant.delta",
		});
		expect(selectViewModel(next).counters.invalidEvents).toBe(1);
		expect(selectViewModel(next).messages).toEqual([]);
	});

	it("stays quiet about protocol events it deliberately ignores", () => {
		const next = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "iteration.started",
				eventId: "e1",
				payload: { iteration: 1 },
			},
		});
		expect(next.emitted).toEqual([]);
		expect(selectViewModel(next).counters.ignoredEvents).toBe(1);
	});

	it("clears emitted diagnostics on the next action", () => {
		const noisy = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "nope" as HubEventEnvelope["event"],
				eventId: "e1",
			},
		});
		expect(noisy.emitted).toHaveLength(1);
		const quiet = reduceSession(noisy, {
			type: "event",
			envelope: {
				version: "v1",
				event: "run.started",
				eventId: "e2",
			},
		});
		expect(quiet.emitted).toEqual([]);
	});

	it("surfaces an approval dropped as already resolved as info, not error", () => {
		let next = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [
				{
					approvalId: "ap_1",
					sessionId: "ses_1",
					agentId: "ag_1",
					conversationId: "cv_1",
					iteration: 1,
					toolCallId: "tc_1",
					toolName: "bash",
					inputJson: "{}",
					policy: {},
					createdAt: 1,
				},
			],
		});
		expect(selectViewModel(next).pendingApprovals).toHaveLength(1);
		next = reduceSession(next, {
			type: "approval_dropped",
			approvalId: "ap_1",
			reason: "already_resolved",
		});
		expect(selectViewModel(next).pendingApprovals).toEqual([]);
		expect(next.emitted).toEqual([
			{
				level: "info",
				type: "approval_already_resolved",
				approvalId: "ap_1",
			},
		]);
	});

	it("marks the connection reconnecting on a transport drop", () => {
		const next = reduceSession(state, {
			type: "transport_dropped",
			detail: "socket closed",
		});
		expect(selectViewModel(next).connectionStatus).toBe("reconnecting");
		expect(selectViewModel(next).questionInterrupted).toBeUndefined();
		expect(next.emitted).toEqual([
			{ level: "warn", type: "transport_dropped", detail: "socket closed" },
		]);
	});

	it("explains a cancelled question across resync without reviving its request", () => {
		const question = {
			requestId: "q1",
			question: "Continue?",
			options: ["Yes", "No"],
		};
		let next = reduceSession(state, { type: "question_requested", question });
		next = reduceSession(next, { type: "transport_dropped", detail: "closed" });
		expect(selectViewModel(next).pendingQuestions).toEqual([]);
		expect(selectViewModel(next).questionInterrupted).toBe(true);
		next = reduceSession(next, { type: "hydrate_started" });
		next = reduceSession(next, { type: "hydrated", messages: [] });
		next = reduceSession(next, {
			type: "transport_dropped",
			detail: "closed again",
		});
		expect(selectViewModel(next).questionInterrupted).toBe(true);
		expect(
			selectViewModel(
				reduceSession(next, {
					type: "user_input",
					text: "Please repeat the question",
				}),
			).questionInterrupted,
		).toBeUndefined();
		expect(
			selectViewModel(
				reduceSession(next, {
					type: "question_requested",
					question: { ...question, requestId: "q2" },
				}),
			).questionInterrupted,
		).toBeUndefined();
	});
});

describe("fixture prefix invariants", () => {
	function assertValidView(view: SessionViewModel, label: string): void {
		const ids = view.messages.map((message) => message.id);
		expect(new Set(ids).size, `${label}: duplicate message ids`).toBe(
			ids.length,
		);
		expect(
			["idle", "running", "completed", "aborted", "failed"],
			label,
		).toContain(view.runStatus);
		const approvalIds = view.pendingApprovals.map((entry) => entry.approvalId);
		expect(new Set(approvalIds).size, `${label}: duplicate approvals`).toBe(
			approvalIds.length,
		);
		for (const message of view.messages) {
			expect(message.blocks.length, `${label}: empty message`).toBeGreaterThan(
				0,
			);
			for (const block of message.blocks) {
				if (block.kind === "tool") {
					expect(block.toolCallId.length).toBeGreaterThan(0);
					expect(["running", "completed", "failed"]).toContain(block.state);
				} else if (block.kind === "media") {
					expect(block.media.id.length).toBeGreaterThan(0);
					expect(block.media.mediaType).toContain("/");
				} else {
					expect(typeof block.text).toBe("string");
				}
			}
		}
	}

	it("covers every scenario committed in the fixtures directory", async () => {
		const scenarios = await listFixtureScenarios();
		// The list is read off disk, so a fixture added upstream is covered by the
		// invariant sweeps below without touching this app.
		expect(scenarios).toContain("register-handshake");
		expect(scenarios).toContain("incompatible-register");
		expect(scenarios).toContain("happy-turn");
		expect(new Set(scenarios).size).toBe(scenarios.length);
	});

	it("every prefix of every fixture yields a valid view model", async () => {
		for (const scenario of await listFixtureScenarios()) {
			const events = await fixtureEvents(scenario);
			for (let length = 0; length <= events.length; length += 1) {
				const view = selectViewModel(
					applyEvents(liveState(), events.slice(0, length)),
				);
				assertValidView(view, `${scenario}@${length}`);
			}
		}
	});

	it("every prefix is also valid when it arrives inside the hydrate window", async () => {
		for (const scenario of await listFixtureScenarios()) {
			const events = await fixtureEvents(scenario);
			for (let length = 0; length <= events.length; length += 1) {
				let state = reduceSession(createSessionState(), {
					type: "hydrate_started",
				});
				state = applyEvents(state, events.slice(0, length));
				state = reduceSession(state, { type: "hydrated", messages: [] });
				assertValidView(
					selectViewModel(state),
					`${scenario}@${length} (buffered)`,
				);
			}
		}
	});
});

describe("fixture replay through FakeHubSocket", () => {
	it("feeds a real HubClient stream into the same view model", async () => {
		const fixture = await loadFixture("happy-turn");
		const client = new HubClient({
			url: "ws://127.0.0.1:1/hub",
			WebSocketImpl: fakeHubSocketFor(fixture),
			clientType: "hub-testkit",
			displayName: "hub-testkit",
			workspaceRoot: "/testkit/workspace",
			cwd: "/testkit/workspace",
		});
		const received: HubEventEnvelope[] = [];
		const unsubscribe = client.subscribe((event) => {
			received.push(event);
		});
		await client.connect();
		const created = await client.command("session.create", {
			workspaceRoot: "/testkit/workspace",
		});
		const sessionId = (created.payload?.session as { sessionId: string })
			.sessionId;
		await client.command(
			"session.send_input",
			{ sessionId, prompt: "say hello" },
			sessionId,
		);
		unsubscribe();
		client.close();

		const view = selectViewModel(applyEvents(liveState(), received));
		expect(view.runStatus).toBe("completed");
		expect(view.messages[0]?.blocks).toEqual([{ kind: "text", text: "Hello" }]);
		expect(view.counters.unknownEvents).toBe(0);
		expect(view.counters.invalidEvents).toBe(0);
	});
});

describe("approval recovery ordering (Bug A)", () => {
	function approval(overrides: Record<string, unknown> = {}) {
		return {
			approvalId: "ap_1",
			sessionId: "ses_1",
			agentId: "ag_1",
			conversationId: "cv_1",
			iteration: 1,
			toolCallId: "tc_1",
			toolName: "bash",
			inputJson: "{}",
			policy: {},
			createdAt: 1,
			...overrides,
		} as never;
	}

	function requested(eventId: string, approvalId: string): HubEventEnvelope {
		return {
			version: "v1",
			event: "approval.requested",
			eventId,
			payload: approval({ approvalId }),
		};
	}

	function resolved(eventId: string, approvalId: string): HubEventEnvelope {
		return {
			version: "v1",
			event: "approval.resolved",
			eventId,
			payload: { approvalId, approved: true } as never,
		};
	}

	it("keeps a request that arrived live during the round trip (snapshot pre-dates it)", () => {
		let state = reduceSession(liveState(), {
			type: "approvals_recovery_started",
		});
		// The request lands live while list_pending is in flight; the snapshot the
		// hub captured before it existed is empty.
		state = applyEvents(state, [requested("e1", "ap_new")]);
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [],
			now: 0,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_new"]);
	});

	it("keeps a live resolution gone even when the stale snapshot still lists it", () => {
		let state = reduceSession(liveState(), {
			type: "approvals_recovery_started",
		});
		// The approval is resolved live during the round trip; the snapshot was
		// captured while it was still pending, so a plain replace would resurrect it.
		state = applyEvents(state, [resolved("r1", "ap_1")]);
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [approval({ approvalId: "ap_1" })],
			now: 0,
		});
		expect(selectViewModel(state).pendingApprovals).toEqual([]);
	});

	it("closes the window without wiping the pending set when recovery fails", () => {
		let state = applyEvents(liveState(), [requested("e1", "ap_1")]);
		state = reduceSession(state, { type: "approvals_recovery_started" });
		state = reduceSession(state, { type: "approvals_recovery_failed" });
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_1"]);
	});

	it("ignores a superseded recovery's reply instead of moving pending backwards", () => {
		// Recovery 1 opens; the hub captures a snapshot that still lists ap_1.
		let state = applyEvents(liveState(), [requested("e1", "ap_1")]);
		state = reduceSession(state, { type: "approvals_recovery_started" });
		const stale = state.approvalRecoveryGeneration;
		// ap_1 is answered while recovery 1's reply is still in flight.
		state = applyEvents(state, [resolved("r1", "ap_1")]);

		// Recovery 2 opens (a resync), discarding recovery 1's window. Nothing
		// previously invalidated recovery 1's reply, which is the bug.
		state = reduceSession(state, { type: "approvals_recovery_started" });
		const current = state.approvalRecoveryGeneration;
		expect(current).not.toBe(stale);
		// A new approval is raised live inside recovery 2's window.
		state = applyEvents(state, [requested("e2", "ap_2")]);

		// Recovery 1's stale reply lands: it must not resurrect ap_1, and it must not
		// consume recovery 2's window.
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [approval({ approvalId: "ap_1" })],
			now: 0,
			generation: stale,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_2"]);

		// Recovery 2's own reply — captured after ap_1 was answered and before ap_2
		// existed — still has to keep ap_2, which is only possible if its window
		// survived the stale reply above. Otherwise the run blocks on an approval
		// with nothing to tap.
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [],
			now: 0,
			generation: current,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_2"]);
	});

	it("leaves the newer window open when a superseded recovery fails", () => {
		let state = reduceSession(liveState(), {
			type: "approvals_recovery_started",
		});
		const stale = state.approvalRecoveryGeneration;
		state = reduceSession(state, { type: "approvals_recovery_started" });
		const current = state.approvalRecoveryGeneration;
		state = applyEvents(state, [requested("e1", "ap_live")]);

		state = reduceSession(state, {
			type: "approvals_recovery_failed",
			generation: stale,
		});
		state = reduceSession(state, {
			type: "approvals_recovered",
			approvals: [],
			now: 0,
			generation: current,
		});
		expect(
			selectViewModel(state).pendingApprovals.map((entry) => entry.approvalId),
		).toEqual(["ap_live"]);
	});
});

describe("optimistic reconciliation across hydrate (Bug B)", () => {
	function pendingUserTexts(state: SessionState): string[] {
		return selectViewModel(state)
			.messages.filter(
				(message) =>
					message.role === "user" &&
					message.origin === "live" &&
					message.pending === true,
			)
			.map((message) =>
				message.blocks
					.map((block) => (block.kind === "text" ? block.text : ""))
					.join(""),
			);
	}

	function hydrateWith(state: SessionState, texts: string[]): SessionState {
		let next = reduceSession(state, { type: "hydrate_started" });
		next = reduceSession(next, {
			type: "hydrated",
			messages: texts.flatMap((text) => [
				{ role: "user", content: text },
				{ role: "assistant", content: "ok" },
			]),
		});
		return next;
	}

	it("keeps a failed repeat send even though the transcript holds an older identical one", () => {
		// Transcript already contains one "continue".
		let state = hydrateWith(createSessionState(), ["continue"]);
		// A fresh "continue" is typed and its send fails offline.
		state = reduceSession(state, { type: "user_input", text: "continue" });
		const messageId = optimisticMessageId(state.inputSeq);
		state = reduceSession(state, {
			type: "send_failed",
			messageId,
			detail: "offline",
		});
		expect(pendingUserTexts(state)).toEqual(["continue"]);

		// The transcript is unchanged on the next hydrate: the failed send has not landed.
		state = hydrateWith(state, ["continue"]);

		// It must survive and stay retryable, not be erased by the older transcript entry.
		expect(pendingUserTexts(state)).toEqual(["continue"]);
		expect(selectOptimisticSend(state, messageId)).toBe("continue");
	});

	it("reconciles a delivered duplicate but keeps a failed duplicate", () => {
		let state = liveState();
		state = reduceSession(state, { type: "user_input", text: "continue" });
		const deliveredId = optimisticMessageId(state.inputSeq);
		state = reduceSession(state, { type: "user_input", text: "continue" });
		const failedId = optimisticMessageId(state.inputSeq);
		state = reduceSession(state, {
			type: "send_failed",
			messageId: failedId,
			detail: "offline",
		});
		expect(pendingUserTexts(state)).toEqual(["continue", "continue"]);

		// One of the two lands: the transcript gains a single "continue".
		state = hydrateWith(state, ["continue"]);

		// The delivered one is reconciled away; the failed one stays and is retryable.
		expect(pendingUserTexts(state)).toEqual(["continue"]);
		expect(selectOptimisticSend(state, failedId)).toBe("continue");
		expect(selectOptimisticSend(state, deliveredId)).toBeUndefined();
	});

	it("reconciles both identical sends once both land", () => {
		let state = liveState();
		state = reduceSession(state, { type: "user_input", text: "continue" });
		state = reduceSession(state, { type: "user_input", text: "continue" });
		expect(pendingUserTexts(state)).toEqual(["continue", "continue"]);

		// Both land: the transcript gains two "continue" occurrences.
		state = hydrateWith(state, ["continue", "continue"]);
		expect(pendingUserTexts(state)).toEqual([]);
	});
});

describe("optimistic baseline after a failed first hydrate", () => {
	function pendingUserTexts(state: SessionState): string[] {
		return selectViewModel(state)
			.messages.filter(
				(message) => message.role === "user" && message.pending === true,
			)
			.map((message) =>
				message.blocks
					.map((block) => (block.kind === "text" ? block.text : ""))
					.join(""),
			);
	}

	it("does not treat the whole transcript as newly gained after the first hydrate failed", () => {
		// The initial hydrate never landed, so this client has never seen the
		// transcript: `state.hydrated` is `[]` because it is *unknown*, not empty.
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = reduceSession(state, {
			type: "hydrate_failed",
			detail: "socket closed",
		});

		// A send typed while offline, which never reached the hub.
		state = reduceSession(state, { type: "user_input", text: "continue" });
		const messageId = optimisticMessageId(state.inputSeq);
		state = reduceSession(state, {
			type: "send_failed",
			messageId,
			detail: "offline",
		});

		// The first *successful* hydrate reveals a historical "continue" that has
		// nothing to do with this send.
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [
				{ role: "user", content: "continue" },
				{ role: "assistant", content: "ok" },
			],
		});

		// A failed send must never be silently dropped.
		expect(pendingUserTexts(state)).toEqual(["continue"]);
		expect(selectOptimisticSend(state, messageId)).toBe("continue");
	});
});

describe("in-flight run content across a hydrate", () => {
	function textsOf(state: SessionState): string[] {
		return selectViewModel(state)
			.messages.flatMap((message) => message.blocks)
			.map((block) => (block.kind === "text" ? block.text : ""));
	}

	function event(
		name: HubEventEnvelope["event"],
		eventId: string,
		payload: Record<string, unknown> = {},
	): HubEventEnvelope {
		return { version: "v1", event: name, eventId, payload };
	}

	it("keeps a partial answer that the persisted snapshot does not contain yet", () => {
		let state = liveState();
		state = applyEvents(state, [
			event("run.started", "e1"),
			event("assistant.delta", "e2", { text: "half an answer" }),
		]);
		expect(textsOf(state)).toContain("half an answer");

		// Mid-run reconnect: the run has not terminated, so the hub has nothing
		// persisted for it and the deltas are never re-delivered.
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, { type: "hydrated", messages: [] });

		expect(textsOf(state)).toContain("half an answer");
	});

	it("drops the live turn once the snapshot actually contains it", () => {
		let state = liveState();
		state = applyEvents(state, [
			event("run.started", "e1"),
			event("assistant.finished", "e2", { text: "the whole answer" }),
			event("run.completed", "e3"),
		]);
		state = reduceSession(state, { type: "hydrate_started" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [{ role: "assistant", content: "the whole answer" }],
		});

		expect(textsOf(state)).toEqual(["the whole answer"]);
	});

	it("keeps earlier text when one turn contains multiple content segments", () => {
		let state = liveState();
		state = applyEvents(state, [
			event("run.started", "e1"),
			event("assistant.delta", "e2", { text: "part one " }),
			event("assistant.finished", "e3", { text: "part one " }),
			event("assistant.delta", "e4", { text: "part" }),
			event("assistant.delta", "e5", { text: " two" }),
			event("assistant.finished", "e6", { text: "part two" }),
		]);

		expect(textsOf(state)).toEqual(["part one ", "part two"]);
	});

	it("separates finished-only segments and preserves repeated text", () => {
		const state = applyEvents(liveState(), [
			event("assistant.finished", "f1", { text: "Done." }),
			event("assistant.finished", "f2", { text: "Done." }),
		]);
		expect(textsOf(state)).toEqual(["Done.", "Done."]);
	});

	it("keeps text segments distinct around a tool and a corrected streamed answer", () => {
		const state = applyEvents(liveState(), [
			event("assistant.delta", "d1", { text: "Checking." }),
			event("assistant.finished", "f1", { text: "Checking." }),
			event("tool.started", "t1", {
				toolCallId: "tool",
				toolName: "bash",
				input: {},
			}),
			event("tool.finished", "t2", {
				toolCallId: "tool",
				toolName: "bash",
				output: "ok",
			}),
			event("assistant.delta", "d2", { text: "partial" }),
			event("assistant.finished", "f2", { text: "Complete." }),
			event("assistant.delta", "d3", { text: "Next." }),
			event("assistant.finished", "f3", { text: "Next." }),
		]);
		expect(textsOf(state).filter(Boolean)).toEqual([
			"Checking.",
			"Complete.",
			"Next.",
		]);
	});

	it("does not erase an earlier segment when reconnect loses its finished event", () => {
		let state = liveState();
		state = applyEvents(state, [
			event("run.started", "e1"),
			event("assistant.delta", "e2", { text: "part one " }),
			// The first segment's assistant.finished was lost with the socket.
			event("assistant.delta", "e4", { text: "part two" }),
			event("assistant.finished", "e5", { text: "part two" }),
		]);

		expect(textsOf(state)).toContain("part one part two");
	});

	it("keeps the earlier of two runs that terminated in one hydrate window", () => {
		// Two runs finish while the hydrate is in flight and only the later one is
		// persisted. A single global supersession flag discards both.
		let state = reduceSession(liveState(), { type: "hydrate_started" });
		state = applyEvents(state, [
			event("run.started", "e1"),
			event("assistant.finished", "e2", { text: "first answer" }),
			event("run.completed", "e3"),
			event("run.started", "e4"),
			event("assistant.finished", "e5", { text: "second answer" }),
			event("run.completed", "e6"),
		]);
		state = reduceSession(state, {
			type: "hydrated",
			messages: [{ role: "assistant", content: "second answer" }],
		});

		const texts = textsOf(state);
		expect(texts).toContain("first answer");
		expect(texts).toContain("second answer");
		expect(texts.filter((text) => text === "second answer")).toHaveLength(1);
	});
});

describe("usage accounting", () => {
	function usageEvent(
		eventId: string,
		payload: Record<string, unknown>,
	): HubEventEnvelope {
		return { version: "v1", event: "usage.updated", eventId, payload };
	}

	it("does not add a cumulative total to the turn as if it were a delta", () => {
		let state = liveState();
		state = applyEvents(state, [
			{ version: "v1", event: "run.started", eventId: "e1", payload: {} },
			// A hub that reports cumulative figures under `usage` only: the second
			// report restates the running total, it is not 30 more tokens.
			usageEvent("e2", { usage: { inputTokens: 10, outputTokens: 1 } }),
			usageEvent("e3", { usage: { inputTokens: 30, outputTokens: 3 } }),
		]);

		const view = selectViewModel(state);
		expect(view.usage.total?.inputTokens).toBe(30);
		expect(view.usage.turns[0]?.inputTokens).toBe(30);
	});

	it("still accumulates genuine per-iteration deltas within a turn", () => {
		let state = liveState();
		state = applyEvents(state, [
			{ version: "v1", event: "run.started", eventId: "e1", payload: {} },
			usageEvent("e2", {
				delta: { inputTokens: 10 },
				totals: { inputTokens: 10 },
			}),
			usageEvent("e3", {
				delta: { inputTokens: 20 },
				totals: { inputTokens: 30 },
			}),
		]);

		const view = selectViewModel(state);
		expect(view.usage.turns[0]?.inputTokens).toBe(30);
		expect(view.usage.total?.inputTokens).toBe(30);
	});
});

describe("hook tool-call identity", () => {
	it("keeps distinct invocations of the same hook in separate blocks", () => {
		let state = liveState();
		state = applyEvents(state, [
			{ version: "v1", event: "run.started", eventId: "e1", payload: {} },
			{
				version: "v1",
				event: "tool.started",
				eventId: "e2",
				payload: { toolName: "format" },
			},
			{
				version: "v1",
				event: "tool.finished",
				eventId: "e3",
				payload: { toolName: "format", output: "first" },
			},
			{
				version: "v1",
				event: "tool.started",
				eventId: "e4",
				payload: { toolName: "format" },
			},
			{
				version: "v1",
				event: "tool.finished",
				eventId: "e5",
				payload: { toolName: "format", output: "second" },
			},
		]);

		const outputs = selectViewModel(state)
			.messages.flatMap((message) => message.blocks)
			.filter((block) => block.kind === "tool")
			.map((block) => (block.kind === "tool" ? block.output : undefined));
		expect(outputs).toEqual(["first", "second"]);
	});
});

describe("event dedupe cost", () => {
	it("stays linear over a long stream instead of rescanning the window", () => {
		let state = liveState();
		const total = 6_000;
		const started = Date.now();
		for (let index = 0; index < total; index += 1) {
			state = reduceSession(state, {
				type: "event",
				envelope: {
					version: "v1",
					event: "assistant.delta",
					eventId: `e${index}`,
					payload: { text: "x" },
				},
			});
		}
		// A 2000-entry `Array.includes` + full copy per event is ~O(n * window);
		// a Set/ring buffer is ~O(n). The bound is loose on purpose so this is a
		// regression guard rather than a benchmark.
		expect(Date.now() - started).toBeLessThan(1_500);
		expect(selectViewModel(state).counters.duplicateEvents).toBe(0);

		// The dedupe window still works.
		state = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "assistant.delta",
				eventId: `e${total - 1}`,
				payload: { text: "x" },
			},
		});
		expect(selectViewModel(state).counters.duplicateEvents).toBe(1);
	});
});

/**
 * The hub queues a prompt sent while a run is active — `runTurn` defaults
 * `delivery` to "queue" for an interactive session that cannot start a run — and
 * broadcasts the queue as `session.pending_prompts`, then
 * `session.pending_prompt_submitted` when an entry is finally handed to the
 * agent. Both were in KNOWN_HUB_EVENTS but consumed by nobody, so the composer
 * promised "Send another message to queue it" and then showed no queue at all.
 */
describe("pending prompts", () => {
	function pendingPromptsEvent(
		prompts: { id: string; prompt: string; delivery?: "queue" | "steer" }[],
		eventId = "pp1",
	): HubEventEnvelope {
		return {
			version: "v1",
			event: "session.pending_prompts",
			eventId,
			payload: {
				sessionId: "s1",
				prompts: prompts.map((entry) => ({
					delivery: "queue",
					attachmentCount: 0,
					...entry,
				})),
			},
		} as unknown as HubEventEnvelope;
	}

	it("projects the queued prompts the hub broadcasts", () => {
		const view = selectViewModel(
			applyEvents(liveState(), [
				pendingPromptsEvent([
					{ id: "p1", prompt: "first" },
					{ id: "p2", prompt: "second", delivery: "steer" },
				]),
			]),
		);
		expect(view.pendingPrompts).toEqual([
			{ id: "p1", prompt: "first", delivery: "queue", attachmentCount: 0 },
			{ id: "p2", prompt: "second", delivery: "steer", attachmentCount: 0 },
		]);
	});

	it("starts with an empty queue", () => {
		expect(selectViewModel(liveState()).pendingPrompts).toEqual([]);
	});

	it("treats each broadcast as a snapshot, not an addition", () => {
		const state = applyEvents(liveState(), [
			pendingPromptsEvent([{ id: "p1", prompt: "first" }], "pp1"),
			pendingPromptsEvent([{ id: "p2", prompt: "second" }], "pp2"),
		]);
		expect(
			selectViewModel(state).pendingPrompts.map((entry) => entry.id),
		).toEqual(["p2"]);
	});

	it("drops a prompt once the hub reports it submitted", () => {
		const state = applyEvents(liveState(), [
			pendingPromptsEvent([
				{ id: "p1", prompt: "first" },
				{ id: "p2", prompt: "second" },
			]),
			{
				version: "v1",
				event: "session.pending_prompt_submitted",
				eventId: "ps1",
				// Nested exactly as `session-event-projector.ts` publishes it.
				payload: {
					sessionId: "s1",
					prompt: {
						id: "p1",
						prompt: "first",
						delivery: "queue",
						attachmentCount: 0,
					},
				},
			} as unknown as HubEventEnvelope,
		]);
		expect(
			selectViewModel(state).pendingPrompts.map((entry) => entry.id),
		).toEqual(["p2"]);
	});

	it("ignores a malformed queue broadcast rather than dropping the queue", () => {
		const state = applyEvents(liveState(), [
			pendingPromptsEvent([{ id: "p1", prompt: "first" }]),
			{
				version: "v1",
				event: "session.pending_prompts",
				eventId: "pp-bad",
				payload: { sessionId: "s1" },
			} as unknown as HubEventEnvelope,
		]);
		expect(
			selectViewModel(state).pendingPrompts.map((entry) => entry.id),
		).toEqual(["p1"]);
	});
});

/**
 * A model change made from ANY client — this phone, another phone, the
 * terminal's `/model` — reaches every view the same way: the hub broadcasts
 * `session.updated` with the refreshed record. Before this, the phone that
 * made the change was the only one that knew.
 */
describe("session model", () => {
	it("starts unknown", () => {
		expect(selectViewModel(liveState()).model).toBeUndefined();
	});

	it("adopts the model a session.updated broadcast carries", () => {
		const view = selectViewModel(
			applyEvents(liveState(), [
				{
					version: "v1",
					event: "session.updated",
					eventId: "su1",
					payload: {
						session: {
							sessionId: "s1",
							provider: "anthropic",
							model: "claude-opus-5",
						},
					},
				} as unknown as HubEventEnvelope,
			]),
		);
		expect(view.model).toEqual({
			providerId: "anthropic",
			modelId: "claude-opus-5",
		});
	});

	it("keeps the known model when a broadcast names nothing", () => {
		const state = applyEvents(liveState(), [
			{
				version: "v1",
				event: "session.updated",
				eventId: "su1",
				payload: {
					session: { sessionId: "s1", model: "claude-opus-5" },
				},
			} as unknown as HubEventEnvelope,
			// e.g. a metadata-only rename: the record is present, the model absent.
			{
				version: "v1",
				event: "session.updated",
				eventId: "su2",
				payload: { session: { sessionId: "s1" } },
			} as unknown as HubEventEnvelope,
		]);
		expect(selectViewModel(state).model).toEqual({
			modelId: "claude-opus-5",
		});
	});

	it("applies the attach reply's record via model_updated", () => {
		const state = reduceSession(liveState(), {
			type: "model_updated",
			model: { providerId: "lmstudio", modelId: "qwen3-coder" },
		});
		expect(selectViewModel(state).model).toEqual({
			providerId: "lmstudio",
			modelId: "qwen3-coder",
		});
	});
});

/**
 * The run-outcome card ("what happened while I was away") needs to know when
 * the run this client WATCHED started and ended. Deliberately live-only: a
 * hydrated transcript of some old finished run gets no `lastRun`, so the card
 * cannot claim a duration nobody measured.
 */
describe("last run timing", () => {
	function runEvent(
		event: string,
		eventId: string,
		timestamp: number,
		payload: Record<string, unknown> = {},
	): HubEventEnvelope {
		return {
			version: "v1",
			event,
			eventId,
			timestamp,
			payload,
		} as unknown as HubEventEnvelope;
	}

	it("starts unknown", () => {
		expect(selectViewModel(liveState()).lastRun).toBeUndefined();
	});

	it("captures start, end and outcome of a watched run", () => {
		const state = applyEvents(liveState(), [
			runEvent("run.started", "r1", 1_000),
			runEvent("run.completed", "r2", 61_000),
		]);
		expect(selectViewModel(state).lastRun).toEqual({
			startedAt: 1_000,
			endedAt: 61_000,
			outcome: "completed",
		});
	});

	it("a new run clears the previous outcome", () => {
		const state = applyEvents(liveState(), [
			runEvent("run.started", "r1", 1_000),
			runEvent("run.failed", "r2", 2_000, { error: "boom" }),
			runEvent("run.started", "r3", 3_000),
		]);
		expect(selectViewModel(state).lastRun).toEqual({ startedAt: 3_000 });
	});

	it("records an abort as the outcome", () => {
		const state = applyEvents(liveState(), [
			runEvent("run.started", "r1", 1_000),
			runEvent("run.aborted", "r2", 5_000),
		]);
		expect(selectViewModel(state).lastRun?.outcome).toBe("aborted");
	});
});

describe("actual SDK progress and partial iteration recovery", () => {
	let nextEventId = 0;
	function sdkEvent(
		event: HubEventEnvelope["event"],
		payload: Record<string, unknown>,
	): HubEventEnvelope {
		return {
			version: "v1",
			event,
			eventId: `sdk-recovery-${++nextEventId}`,
			sessionId: "sdk-recovery",
			timestamp: nextEventId,
			payload,
		};
	}

	const firstIteration: import("./schemas").HydratedMessage[] = [
		{
			role: "assistant",
			content: [
				{ type: "text", text: "I will inspect." },
				{ type: "tool_use", id: "read-1", name: "read_file" },
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "read-1",
					content: "file contents",
				},
			],
		},
	];

	function beginSecondIteration(): SessionState {
		return applyEvents(liveState(), [
			sdkEvent("run.started", {}),
			sdkEvent("assistant.finished", { text: "I will inspect." }),
			sdkEvent("tool.started", { toolCallId: "read-1", toolName: "read_file" }),
			sdkEvent("tool.finished", {
				toolCallId: "read-1",
				toolName: "read_file",
				output: "file contents",
			}),
		]);
	}

	function refreshMidRun(state: SessionState): SessionViewModel {
		return selectViewModel(
			reduceSession(reduceSession(state, { type: "hydrate_started" }), {
				type: "hydrated",
				messages: firstIteration,
				runStatus: "running",
			}),
		);
	}

	it("shows append-only stdout and stderr chunks from the real tool.updated update field before completion", () => {
		// bash.ts createCommandProgressEmitter -> runtime-event-adapter.ts ->
		// session-event-projector.ts: progress lives inside payload.update.
		const state = applyEvents(liveState(), [
			sdkEvent("run.started", {}),
			sdkEvent("tool.started", {
				toolCallId: "command-1",
				toolName: "run_command",
			}),
			sdkEvent("tool.updated", {
				toolCallId: "command-1",
				toolName: "run_command",
				update: {
					stream: "stdout",
					chunk: "building\n",
					executionId: "exec-1",
					detachable: true,
				},
			}),
			sdkEvent("tool.updated", {
				toolCallId: "command-1",
				toolName: "run_command",
				update: {
					stream: "stderr",
					chunk: "warning\n",
					executionId: "exec-1",
					detachable: true,
				},
			}),
		]);
		const tool = selectViewModel(state)
			.messages.flatMap((message) => message.blocks)
			.find((block) => block.kind === "tool");
		expect(tool?.kind).toBe("tool");
		if (tool?.kind !== "tool") throw new Error("Missing command activity");
		expect(tool.state).toBe("running");
		expect(JSON.stringify(tool.output) ?? "").toContain("building");
		expect(JSON.stringify(tool.output) ?? "").toContain("warning");
	});

	it("does not repeat the persisted iteration when the next iteration has partial text", () => {
		const state = applyEvents(beginSecondIteration(), [
			sdkEvent("assistant.delta", { text: "Now editing." }),
		]);
		const blocks = refreshMidRun(state).messages.flatMap(
			(message) => message.blocks,
		);
		expect(
			blocks.filter(
				(block) => block.kind === "text" && block.text === "I will inspect.",
			),
		).toHaveLength(1);
		expect(
			blocks.filter(
				(block) => block.kind === "tool" && block.toolCallId === "read-1",
			),
		).toHaveLength(1);
		expect(
			blocks.some(
				(block) => block.kind === "text" && block.text === "Now editing.",
			),
		).toBe(true);
	});

	it("keeps an unpersisted next-iteration command when earlier text is already on disk", () => {
		const state = applyEvents(beginSecondIteration(), [
			sdkEvent("tool.started", {
				toolCallId: "build-2",
				toolName: "run_command",
				input: { command: "slow build" },
			}),
		]);
		const blocks = refreshMidRun(state).messages.flatMap(
			(message) => message.blocks,
		);
		expect(
			blocks.find(
				(block) => block.kind === "tool" && block.toolCallId === "build-2",
			),
		).toMatchObject({ state: "running", input: { command: "slow build" } });
	});
	it("reconciles a persisted iteration in the hydration event buffer and keeps streaming its remaining segment", () => {
		let state = reduceSession(liveState(), { type: "hydrate_started" });
		state = applyEvents(state, [
			sdkEvent("run.started", {}),
			sdkEvent("assistant.finished", { text: "I will inspect." }),
			sdkEvent("tool.started", { toolCallId: "read-1", toolName: "read_file" }),
			sdkEvent("tool.finished", {
				toolCallId: "read-1",
				toolName: "read_file",
				output: "file contents",
			}),
			sdkEvent("assistant.delta", { text: "Now " }),
		]);
		state = reduceSession(state, {
			type: "hydrated",
			messages: firstIteration,
			runStatus: "running",
		});
		state = applyEvents(state, [
			sdkEvent("assistant.delta", { text: "editing." }),
		]);
		const blocks = selectViewModel(state).messages.flatMap(
			(message) => message.blocks,
		);
		expect(
			blocks.filter(
				(block) => block.kind === "text" && block.text === "I will inspect.",
			),
		).toHaveLength(1);
		expect(
			blocks.filter(
				(block) => block.kind === "tool" && block.toolCallId === "read-1",
			),
		).toHaveLength(1);
		expect(
			blocks.some(
				(block) => block.kind === "text" && block.text === "Now editing.",
			),
		).toBe(true);
	});

	it("does not spend old transcript occurrences on a new repeated assistant segment", () => {
		let state = reduceSession(liveState(), {
			type: "hydrated",
			messages: [{ role: "assistant", content: "Done." }],
		});
		state = applyEvents(state, [
			sdkEvent("run.started", {}),
			sdkEvent("assistant.finished", { text: "Done." }),
		]);
		state = reduceSession(reduceSession(state, { type: "hydrate_started" }), {
			type: "hydrated",
			messages: [{ role: "assistant", content: "Done." }],
			runStatus: "running",
		});
		expect(
			selectViewModel(state)
				.messages.flatMap((message) => message.blocks)
				.filter((block) => block.kind === "text" && block.text === "Done."),
		).toHaveLength(2);
	});

	it("retains current reasoning and generated media after an earlier iteration is persisted", () => {
		const media = {
			id: "new-image",
			modality: "image",
			mediaType: "image/png",
			source: { type: "base64", data: "aGVsbG8=" },
		};
		const state = applyEvents(beginSecondIteration(), [
			sdkEvent("reasoning.delta", { text: "Checking the next change" }),
			sdkEvent("assistant.media", { media }),
		]);
		const blocks = refreshMidRun(state).messages.flatMap(
			(message) => message.blocks,
		);
		expect(
			blocks.some(
				(block) =>
					block.kind === "reasoning" &&
					block.text === "Checking the next change",
			),
		).toBe(true);
		expect(blocks.find((block) => block.kind === "media")).toMatchObject({
			media,
		});
	});

	it("bounds command progress, ignores empty lifecycle chunks, and lets the terminal result replace progress", () => {
		let state = applyEvents(liveState(), [
			sdkEvent("run.started", {}),
			sdkEvent("tool.started", {
				toolCallId: "noisy",
				toolName: "run_command",
			}),
			sdkEvent("tool.updated", {
				toolCallId: "noisy",
				update: { stream: "stdout", chunk: "x".repeat(70_000) },
			}),
			sdkEvent("tool.updated", {
				toolCallId: "noisy",
				update: { stream: "stdout", chunk: "", detachable: true },
			}),
		]);
		const output = () =>
			selectViewModel(state)
				.messages.flatMap((message) => message.blocks)
				.find((block) => block.kind === "tool");
		expect(output()).toMatchObject({ output: "x".repeat(64 * 1024) });
		state = applyEvents(state, [
			sdkEvent("tool.finished", {
				toolCallId: "noisy",
				output: "final result",
			}),
			sdkEvent("tool.updated", {
				toolCallId: "noisy",
				update: { stream: "stderr", chunk: "late" },
			}),
		]);
		expect(output()).toMatchObject({
			state: "completed",
			output: "final result",
		});
	});
});
