/**
 * Hub protocol v1 contract suite.
 *
 * Every scenario drives a real `HubClient` against a real hub WebSocket server
 * (`startTestHub`) and commits the canonicalized transcript as a fixture. The
 * fixtures are what UI tests replay through `FakeHubSocket`, so a drift here is
 * a protocol change that needs to be looked at.
 */

import { HubCommandError, HubTransportError } from "@cline/hub-client";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptStep } from "./script";
import { startTestHub, type TestHub } from "./test-hub";
import { verifyFixture } from "./verify-fixture";

const hubs: TestHub[] = [];

async function openHub(
	...args: Parameters<typeof startTestHub>
): Promise<TestHub> {
	const hub = await startTestHub(...args);
	hubs.push(hub);
	return hub;
}

afterEach(async () => {
	for (const hub of hubs.splice(0)) {
		await hub.close().catch(() => undefined);
	}
});

describe("hub protocol v1 contract", () => {
	it("register-handshake: the register reply advertises the hub's protocol range and capabilities", async () => {
		const hub = await openHub({});
		const client = await hub.connectClient({ clientId: "client-handshake" });

		expect(client.client.getServerProtocol()).toMatchObject({
			protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
			maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
		});
		// The one capability the mobile client feature-detects before offering
		// approval recovery, so a hub that stops advertising it must break here.
		expect(client.client.hasCapability("approval.list_pending")).toBe(true);

		await verifyFixture({
			scenario: "register-handshake",
			description:
				"client.register advertises protocolVersion and the reply carries the hub's protocol range + capabilities",
			frames: client.frames(),
			// The only scenario that records the reply handshake; everywhere else it
			// stays projected out so additive capabilities cannot churn fixtures.
			recordRegisterHandshake: true,
		});
	});

	it("incompatible-register: an unsupported client protocol is refused with structured details", async () => {
		const hub = await openHub({});

		const { reply, frames } = await hub.registerRaw({
			clientId: "client-from-the-future",
			protocolVersion: "v99",
		});

		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe(HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE);
		// Details are what lets a client tell the user "upgrade/downgrade to X"
		// instead of retry-looping against a hub that will never accept it.
		expect(reply.error?.details).toMatchObject({
			serverProtocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
			maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
			clientProtocolVersion: "v99",
		});

		await verifyFixture({
			scenario: "incompatible-register",
			description:
				"client.register advertising an unsupported protocolVersion -> incompatible_protocol error reply with the supported client range",
			frames: frames(),
			recordRegisterHandshake: true,
		});
	});

	it("happy-turn: send_input streams assistant deltas, usage and completion", async () => {
		const hub = await openHub({
			script: [
				{ kind: "text", chunks: ["Hel", "lo"] },
				{ kind: "usage", inputTokens: 11, outputTokens: 3, cost: 0.01 },
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		const reply = await client.sendInput(sessionId, "say hello");

		expect(reply.ok).toBe(true);
		expect(client.eventsNamed("run.started")).toHaveLength(1);
		expect(
			client.eventsNamed("assistant.delta").map((event) => event.payload?.text),
		).toEqual(["Hel", "lo"]);
		expect(client.eventsNamed("assistant.finished")[0]?.payload?.text).toBe(
			"Hello",
		);
		expect(
			client.eventsNamed("usage.updated")[0]?.payload?.totals,
		).toMatchObject({
			inputTokens: 11,
			outputTokens: 3,
			totalCost: 0.01,
		});
		await client.waitForEvent("run.completed");
		expect(client.eventsNamed("run.completed")).toHaveLength(1);

		await verifyFixture({
			scenario: "happy-turn",
			description:
				"session.create -> send_input -> run.started, assistant deltas, usage, run.completed",
			frames: client.frames(),
		});
	});

	it("reasoning-turn: reasoning deltas precede assistant text", async () => {
		const hub = await openHub({
			script: [
				{ kind: "reasoning", chunks: ["Let me ", "think."] },
				{ kind: "text", chunks: ["Answer."] },
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		await client.sendInput(sessionId, "think first");
		await client.waitForEvent("run.completed");

		expect(
			client.eventsNamed("reasoning.delta").map((event) => event.payload?.text),
		).toEqual(["Let me ", "think."]);
		expect(
			client.eventsNamed("reasoning.finished")[0]?.payload?.reasoning,
		).toBe("Let me think.");
		expect(
			client.eventsNamed("assistant.delta").map((event) => event.payload?.text),
		).toEqual(["Answer."]);
		// Reasoning must be fully streamed before assistant text starts.
		const names = client.events().map((event) => event.event);
		expect(names.lastIndexOf("reasoning.finished")).toBeLessThan(
			names.indexOf("assistant.delta"),
		);

		await verifyFixture({
			scenario: "reasoning-turn",
			description:
				"reasoning deltas + reasoning.finished followed by assistant text",
			frames: client.frames(),
		});
	});

	it("approval-approve: approved tool finishes and the run completes", async () => {
		const hub = await openHub({
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "echo hi" },
					requiresApproval: true,
					output: "hi\n",
				},
				{ kind: "text", chunks: ["ran it"] },
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		const run = client.sendInput(sessionId, "run echo");
		const requested = await client.waitForEvent("approval.requested");
		const approvalId = requested.payload?.approvalId as string;

		expect(requested.payload).toMatchObject({
			sessionId,
			toolName: "bash",
			inputJson: JSON.stringify({ command: "echo hi" }),
		});

		const respond = await client.client.command("approval.respond", {
			approvalId,
			approved: true,
			reason: "looks safe",
		});
		expect(respond.ok).toBe(true);

		await run;
		await client.waitForEvent("run.completed");

		expect(client.eventsNamed("approval.resolved")).toHaveLength(1);
		expect(client.eventsNamed("approval.resolved")[0]?.payload).toMatchObject({
			approvalId,
			approved: true,
		});
		expect(client.eventsNamed("tool.finished")[0]?.payload).toMatchObject({
			toolName: "bash",
			output: "hi\n",
		});
		expect(client.eventsNamed("run.completed")[0]?.payload).toMatchObject({
			reason: "completed",
		});

		await verifyFixture({
			scenario: "approval-approve",
			description:
				"tool requiring approval -> approval.requested -> respond(true) -> tool.finished -> run.completed",
			frames: client.frames(),
		});
	});

	it("approval-deny: denial is reflected in the tool result and the run outcome", async () => {
		const hub = await openHub({
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "rm -rf /" },
					requiresApproval: true,
					output: "never runs",
				},
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		const run = client.sendInput(sessionId, "do something dangerous");
		const requested = await client.waitForEvent("approval.requested");
		const approvalId = requested.payload?.approvalId as string;

		await client.client.command("approval.respond", {
			approvalId,
			approved: false,
			reason: "too dangerous",
		});
		const reply = await run;
		await client.waitForEvent("run.completed");

		expect(client.eventsNamed("approval.resolved")[0]?.payload).toMatchObject({
			approvalId,
			approved: false,
			reason: "too dangerous",
		});
		const toolFinished = client.eventsNamed("tool.finished")[0]?.payload;
		expect(toolFinished?.output).toBeUndefined();
		expect(toolFinished?.error).toBe("Tool bash was denied: too dangerous");
		expect((reply.payload?.result as { text?: string })?.text).toBe(
			"Tool bash was denied: too dangerous",
		);

		await verifyFixture({
			scenario: "approval-deny",
			description:
				"respond(false) -> tool.finished carries the denial -> run reflects it",
			frames: client.frames(),
		});
	});

	it("approval-resolved-elsewhere: an attached second client wins the race and the loser gets already_resolved", async () => {
		const hub = await openHub({
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "ls" },
					requiresApproval: true,
					output: "ok",
				},
			],
		});
		const first = await hub.connectClient({ clientId: "client-first" });
		const sessionId = await first.createSession();
		// Session-scoped so hub-level client lifecycle events from the second
		// client (whose socket races this one) never enter the recorded stream.
		first.subscribe(sessionId);

		const run = first.sendInput(sessionId, "list files");
		const requested = await first.waitForEvent("approval.requested");
		const approvalId = requested.payload?.approvalId as string;

		// A second client attaches to the session — answering an approval is
		// restricted to the session's creator and its attached participants — and
		// then answers first; the hub resolves exactly once.
		const second = await hub.connectClient({ clientId: "client-second" });
		await second.client.command("session.attach", { sessionId }, sessionId);
		const secondReply = await second.client.command("approval.respond", {
			approvalId,
			approved: true,
			reason: "answered elsewhere",
		});
		expect(secondReply.ok).toBe(true);

		// Let the resolution fully land on the first client before it responds, so
		// the losing respond is unambiguously late rather than racing the stream.
		await run;
		await first.waitForEvent("run.completed");

		const losing = await first.client
			.command("approval.respond", { approvalId, approved: true })
			.then(() => undefined)
			.catch((error: unknown) => error);

		expect(losing).toBeInstanceOf(HubCommandError);
		expect((losing as HubCommandError).code).toBe("already_resolved");
		expect(first.eventsNamed("approval.resolved")).toHaveLength(1);

		await verifyFixture({
			scenario: "approval-resolved-elsewhere",
			description:
				"an attached second client responds first; the first client's respond fails already_resolved and approval.resolved is seen exactly once",
			frames: first.frames(),
			outcome: {
				losingRespond: {
					name: (losing as HubCommandError).name,
					code: (losing as HubCommandError).code,
					message: (losing as HubCommandError).message,
				},
				approvalResolvedCount: first.eventsNamed("approval.resolved").length,
			},
		});
	});

	it("approval-recovery: a newly connected client recovers and answers a pending approval", async () => {
		const hub = await openHub({
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "deploy" },
					requiresApproval: true,
					output: "deployed",
				},
			],
		});
		const original = await hub.connectClient({ clientId: "client-original" });
		const sessionId = await original.createSession();
		original.subscribe(sessionId);

		// The run stays parked on the approval after its originating client leaves.
		const abandoned = original.sendInput(sessionId, "deploy please");
		abandoned.catch(() => undefined);
		await original.waitForEvent("approval.requested");
		original.close();

		const recovered = await hub.connectClient({ clientId: "client-recovered" });
		// Scoped to the session so the original client's late disconnect event
		// cannot slip into this client's recorded stream.
		recovered.subscribe(sessionId);
		// Recovery starts with `session.attach`: approvals are only listed to (and
		// answerable by) the session's creator and its attached participants, and
		// this client created nothing. Attaching is also what makes the recording
		// deterministic — the "session has no tracked participants" fallback in the
		// hub's ACL depends on whether the original client's departure has already
		// been processed.
		await recovered.client.command("session.attach", { sessionId }, sessionId);
		const pending = await recovered.client.listPendingApprovals();

		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			sessionId,
			toolName: "bash",
			inputJson: JSON.stringify({ command: "deploy" }),
		});

		const respond = await recovered.client.command("approval.respond", {
			approvalId: pending[0]?.approvalId,
			approved: true,
			reason: "recovered and approved",
		});
		expect(respond.ok).toBe(true);

		await recovered.waitForEvent("approval.resolved");
		await recovered.waitForEvent("run.completed");
		expect(await recovered.client.listPendingApprovals()).toEqual([]);

		await verifyFixture({
			scenario: "approval-recovery",
			description:
				"approval pending -> new client connects and attaches -> approval.list_pending returns it -> respond -> approval.resolved",
			frames: recovered.frames(),
		});
	});

	it("abort-mid-stream: run.abort during deltas terminates with run.aborted", async () => {
		const hub = await openHub({
			script: [
				{ kind: "text", chunks: ["one ", "two "] },
				{ kind: "abortable-stall" },
				{ kind: "text", chunks: ["never streamed"] },
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		const run = client.sendInput(sessionId, "stream then stall");
		// Wait for the last event the script emits before parking, so the abort is
		// sent at a fixed point in the stream rather than racing `assistant.finished`.
		await client.waitForEvent("assistant.finished");
		expect(client.eventsNamed("assistant.delta")).toHaveLength(2);

		const abort = await client.client.command(
			"run.abort",
			{ sessionId, reason: "user cancelled" },
			sessionId,
		);
		expect(abort.ok).toBe(true);

		await run;
		await client.waitForEvent("run.aborted");

		expect(client.eventsNamed("run.aborted")).toHaveLength(1);
		expect(client.eventsNamed("run.completed")).toHaveLength(0);
		// The post-stall step never reaches the wire.
		expect(
			client.eventsNamed("assistant.delta").map((event) => event.payload?.text),
		).toEqual(["one ", "two "]);

		await verifyFixture({
			scenario: "abort-mid-stream",
			description:
				"run.abort mid-stream -> remaining script is dropped -> run.aborted",
			frames: client.frames(),
		});
	});

	it("reconnect-mid-run: hydrating after a reconnect converges on the uninterrupted transcript", async () => {
		// One script shape, parameterised by gate id so the control run and the
		// interrupted run park at the same point without sharing a gate.
		const scriptWithGate = (gateId: string): ScriptStep[] => [
			{ kind: "text", chunks: ["part ", "one "] },
			{ kind: "gate", id: gateId },
			{ kind: "text", chunks: ["part two"] },
			{ kind: "usage", inputTokens: 5, outputTokens: 7 },
		];
		const hub = await openHub({});

		// Control: the same script with no interruption.
		const control = await hub.connectClient({ clientId: "client-control" });
		const controlSessionId = await control.createSession();
		control.subscribe(controlSessionId);
		hub.script(scriptWithGate("control-gate"));
		hub.releaseGate("control-gate");
		await control.sendInput(controlSessionId, "stream in two parts");
		await control.waitForEvent("run.completed");
		const controlMessages = (
			await control.client.command(
				"session.messages",
				{ sessionId: controlSessionId },
				controlSessionId,
			)
		).payload?.messages;
		control.close();

		// Interrupted: drop the socket mid-stream, reconnect, hydrate.
		const client = await hub.connectClient({ clientId: "client-reconnect" });
		const sessionId = await client.createSession();
		client.subscribe(sessionId);
		hub.script(scriptWithGate("gate"));
		const interrupted = client.sendInput(sessionId, "stream in two parts");
		interrupted.catch(() => undefined);
		await client.waitForEvent("assistant.delta", 2);
		client.close();

		const reconnected = await hub.connectClient({
			clientId: "client-reconnect-2",
		});
		// The gate is released out-of-band, so the subscription must be confirmed
		// before it opens or the resumed deltas can outrun it.
		await reconnected.subscribeReady(sessionId);
		hub.releaseGate("gate");
		await reconnected.waitForEvent("run.completed");
		const hydrated = (
			await reconnected.client.command(
				"session.messages",
				{ sessionId },
				sessionId,
			)
		).payload?.messages;

		expect(hydrated).toEqual(controlMessages);

		await verifyFixture({
			scenario: "reconnect-mid-run",
			description:
				"disconnect mid-stream, reconnect + session.messages hydrate converges on the uninterrupted terminal transcript",
			frames: reconnected.frames(),
			outcome: { hydratedMatchesUninterrupted: true, messages: hydrated },
		});
	});

	// Not fixture-backed: this pins the harness option itself rather than a wire
	// contract, so there is nothing for a UI test to replay.
	it("approvals: auto-approve mode runs tools without ever asking the hub", async () => {
		const hub = await openHub({
			approvals: "auto-approve",
			script: [
				{ kind: "tool", name: "bash", input: { command: "ls" }, output: "ok" },
				{ kind: "text", chunks: ["done"] },
			],
		});
		const client = await hub.connectClient();
		client.subscribe();
		const sessionId = await client.createSession();

		await client.sendInput(sessionId, "list files");
		await client.waitForEvent("run.completed");

		expect(client.eventsNamed("approval.requested")).toHaveLength(0);
		expect(client.eventsNamed("tool.finished")[0]?.payload).toMatchObject({
			toolName: "bash",
			output: "ok",
		});
		expect(await client.client.listPendingApprovals()).toEqual([]);
	});

	it("auth-failure: a wrong subprotocol token is rejected with a typed transport error", async () => {
		const hub = await openHub({});
		const client = hub.createClient({ credential: "not-the-real-token" });

		const error = await client
			.connect()
			.then(() => undefined)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(HubTransportError);
		expect((error as HubTransportError).code).toBe("hub_connect_failed");
		expect(client.client.isConnected()).toBe(false);
		// Nothing protocol-level was exchanged: the upgrade never completed.
		expect(client.frames()).toEqual([]);

		await verifyFixture({
			scenario: "auth-failure",
			description:
				"wrong hub-subprotocol credential -> upgrade rejected -> typed HubTransportError, no frames exchanged",
			frames: client.frames(),
			outcome: {
				name: (error as HubTransportError).name,
				code: (error as HubTransportError).code,
			},
		});
	});
});
