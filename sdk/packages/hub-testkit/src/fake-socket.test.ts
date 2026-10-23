/**
 * `FakeHubSocket` replays committed fixtures into a real `HubClient`.
 *
 * These tests are the contract UI tests depend on: the fixtures recorded against
 * the real hub must be replayable without a server.
 */

import { HubClient } from "@cline/hub-client";
import { type HubEventEnvelope, isHubProtocolCompatible } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_REGISTER_REPLY_METADATA,
	fakeHubSocketFor,
	fixtureRejectsConnect,
} from "./fake-socket";
import { type HubFixture, readFixture } from "./fixture";

/** Drains microtask-paced replay until `predicate` holds. */
async function waitFor(predicate: () => boolean, ticks = 200): Promise<void> {
	for (let index = 0; index < ticks; index += 1) {
		if (predicate()) {
			return;
		}
		await Promise.resolve();
	}
	throw new Error("Timed out waiting for replayed frames.");
}

async function loadFixture(scenario: string): Promise<HubFixture> {
	const fixture = await readFixture(scenario);
	if (!fixture) {
		throw new Error(`Missing committed fixture: ${scenario}`);
	}
	return fixture;
}

function connectedClient(fixture: HubFixture): {
	client: HubClient;
	events: HubEventEnvelope[];
} {
	const events: HubEventEnvelope[] = [];
	const client = new HubClient({
		url: "ws://127.0.0.1:65000/hub",
		clientId: "replay-client",
		WebSocketImpl: fakeHubSocketFor(fixture) as never,
	});
	client.subscribe((event) => events.push(event));
	return { client, events };
}

describe("FakeHubSocket", () => {
	it("replays happy-turn: commands get replies and events arrive in recorded order", async () => {
		const fixture = await loadFixture("happy-turn");
		const { client, events } = connectedClient(fixture);

		await client.connect();
		expect(client.isConnected()).toBe(true);

		const created = await client.command("session.create", {});
		const sessionId = (created.payload?.session as { sessionId: string })
			.sessionId;
		expect(sessionId).toBeTruthy();

		const reply = await client.command("session.send_input", {
			sessionId,
			prompt: "say hello",
		});

		expect(reply.ok).toBe(true);
		expect(events.map((event) => event.event)).toEqual([
			"session.created",
			"run.started",
			"iteration.started",
			"assistant.delta",
			"assistant.delta",
			"assistant.finished",
			"usage.updated",
			"iteration.finished",
			"run.completed",
		]);
		expect(
			events
				.filter((event) => event.event === "assistant.delta")
				.map((event) => event.payload?.text),
		).toEqual(["Hel", "lo"]);
		client.close();
	});

	it("correlates replies to live request ids rather than recorded ones", async () => {
		const fixture = await loadFixture("happy-turn");
		const { client } = connectedClient(fixture);
		await client.connect();

		const reply = await client.command("session.create", {});

		// The fixture recorded `<request_2>`; the live client generated its own.
		expect(reply.requestId).toMatch(/^hubreq_/);
		expect(reply.ok).toBe(true);
		client.close();
	});

	it("binds id placeholders so replayed session ids round-trip", async () => {
		const fixture = await loadFixture("happy-turn");
		const { client, events } = connectedClient(fixture);
		await client.connect();

		const created = await client.command("session.create", {});
		const sessionId = (created.payload?.session as { sessionId: string })
			.sessionId;
		await client.command("session.send_input", {
			sessionId,
			prompt: "say hello",
		});

		// Every session-scoped event carries the same synthesized session id.
		const sessionScoped = events.filter(
			(event) => event.sessionId !== undefined,
		);
		expect(sessionScoped.length).toBeGreaterThan(0);
		for (const event of sessionScoped) {
			expect(event.sessionId).toBe(sessionId);
		}
		client.close();
	});

	it("routes session-scoped subscriptions using the replayed session id", async () => {
		const fixture = await loadFixture("happy-turn");
		const events: HubEventEnvelope[] = [];
		const client = new HubClient({
			url: "ws://127.0.0.1:65000/hub",
			clientId: "replay-client",
			WebSocketImpl: fakeHubSocketFor(fixture) as never,
		});
		await client.connect();
		const created = await client.command("session.create", {});
		const sessionId = (created.payload?.session as { sessionId: string })
			.sessionId;
		client.subscribe((event) => events.push(event), { sessionId });

		await client.command("session.send_input", {
			sessionId,
			prompt: "say hello",
		});

		expect(events.map((event) => event.event)).toContain("run.completed");
		expect(events.every((event) => event.sessionId === sessionId)).toBe(true);
		client.close();
	});

	it("replays the approval flow including approval.resolved", async () => {
		const fixture = await loadFixture("approval-approve");
		const { client, events } = connectedClient(fixture);
		await client.connect();

		const created = await client.command("session.create", {});
		const sessionId = (created.payload?.session as { sessionId: string })
			.sessionId;
		// Faithful to the real hub: send_input does not reply until the approval is
		// answered, so the approval must be responded to while the run is pending.
		const run = client.command("session.send_input", {
			sessionId,
			prompt: "run echo",
		});
		await waitFor(() =>
			events.some((event) => event.event === "approval.requested"),
		);

		const requested = events.find(
			(event) => event.event === "approval.requested",
		);
		expect(requested?.payload?.toolName).toBe("bash");

		const respond = await client.command("approval.respond", {
			approvalId: requested?.payload?.approvalId,
			approved: true,
		});
		expect(respond.ok).toBe(true);

		const reply = await run;
		expect(reply.ok).toBe(true);
		expect(events.map((event) => event.event)).toEqual([
			"session.created",
			"run.started",
			"iteration.started",
			"tool.started",
			"approval.requested",
			"approval.resolved",
			"tool.finished",
			"assistant.delta",
			"assistant.finished",
			"iteration.finished",
			"run.completed",
		]);
		client.close();
	});

	it("replays approval.list_pending recovery", async () => {
		const fixture = await loadFixture("approval-recovery");
		const { client } = connectedClient(fixture);
		await client.connect();

		const pending = await client.listPendingApprovals();

		expect(pending).toHaveLength(1);
		expect(pending[0]?.toolName).toBe("bash");
		client.close();
	});

	it("surfaces a structured error for commands the fixture never recorded", async () => {
		const fixture = await loadFixture("happy-turn");
		const unmatched: string[] = [];
		const client = new HubClient({
			url: "ws://127.0.0.1:65000/hub",
			clientId: "replay-client",
			WebSocketImpl: fakeHubSocketFor(fixture, {
				onUnmatchedCommand: (command) => unmatched.push(command),
			}) as never,
		});
		await client.connect();

		await expect(client.command("session.delete", {})).rejects.toMatchObject({
			code: "fixture_missing_command",
		});
		expect(unmatched).toEqual(["session.delete"]);
		client.close();
	});

	it("replays a recorded connect failure as a rejected connection", async () => {
		const fixture = await loadFixture("auth-failure");

		expect(fixtureRejectsConnect(fixture)).toBe(true);

		const client = new HubClient({
			url: "ws://127.0.0.1:65000/hub",
			WebSocketImpl: fakeHubSocketFor(fixture) as never,
		});

		await expect(client.connect()).rejects.toMatchObject({
			code: "hub_connect_failed",
		});
		expect(client.isConnected()).toBe(false);
	});

	it("replays protocol metadata on register even though fixtures allowlist it", async () => {
		const fixture = await loadFixture("happy-turn");
		const registerReply = fixture.frames.find(
			(frame) => frame.label === "reply client.register",
		);
		// The committed fixture deliberately keeps only `clientId` ...
		expect(
			Object.keys(
				(registerReply?.frame as { envelope: { payload: object } }).envelope
					.payload,
			),
		).toEqual(["clientId"]);

		// ... but the replayed reply is a well-formed protocol handshake, so a client
		// that asserts register-time compatibility still passes.
		const client = new HubClient({
			url: "ws://127.0.0.1:65000/hub",
			clientId: "replay-client-2",
			WebSocketImpl: fakeHubSocketFor(fixture) as never,
		});
		const register = await client.command("client.register", {
			clientId: "replay-client-2",
		});
		expect(register.payload).toMatchObject({
			clientId: "replay-client-2",
			protocolVersion: DEFAULT_REGISTER_REPLY_METADATA.protocolVersion,
			minClientProtocolVersion:
				DEFAULT_REGISTER_REPLY_METADATA.minClientProtocolVersion,
			maxClientProtocolVersion:
				DEFAULT_REGISTER_REPLY_METADATA.maxClientProtocolVersion,
		});
		expect(isHubProtocolCompatible(register.payload as never)).toEqual({
			compatible: true,
		});
		// Capabilities cover everything the fixture exercises, so a client that
		// feature-detects before issuing a recorded command is not blocked.
		expect(register.payload?.capabilities).toEqual(
			expect.arrayContaining(["session.create", "session.send_input"]),
		);
		client.close();
	});

	it("refuses to construct without a bound fixture", async () => {
		const { FakeHubSocket } = await import("./fake-socket");

		expect(() => new FakeHubSocket("ws://127.0.0.1:1/hub")).toThrow(
			/requires a fixture/,
		);
	});
});
