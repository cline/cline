import { describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "@cline/core";
import type { HubContext } from "./state";

// agent-events.ts only needs these siblings at runtime; mocking them keeps the
// test from loading @cline/core (state-payloads imports it at module scope),
// whose transitive provider deps do not survive vitest's module interop.
vi.mock("./approvals", () => ({ rejectPendingApprovalsForSession: vi.fn() }));
vi.mock("./state-payloads", () => ({ broadcastHubState: vi.fn() }));

import { handleSessionEvent } from "./agent-events";

function makeContextWithPeer(sessionId: string): {
	ctx: HubContext;
	sent: unknown[];
} {
	const sent: unknown[] = [];
	const ctx = {
		peers: new Set([{ selectedSessionId: sessionId }]),
		sessions: new Map(),
		send: (_peer: unknown, payload: unknown) => sent.push(payload),
		sendToSelectedPeers(id: string, payload: unknown) {
			if (id === sessionId) sent.push(payload);
		},
	} as unknown as HubContext;
	return { ctx, sent };
}

function agentErrorEvent(
	sessionId: string,
	recoverable: boolean,
): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId,
			event: {
				type: "error",
				error: new Error(
					"1 tool call(s) failed: [run_commands] Command not executed",
				),
				recoverable,
				iteration: 1,
			},
		},
	};
}

describe("handleSessionEvent — agent error events", () => {
	it("forwards recoverable errors flagged as in-run notices, not turn outcomes", () => {
		const { ctx, sent } = makeContextWithPeer("session-1");

		handleSessionEvent(ctx, agentErrorEvent("session-1", true));

		expect(sent).toEqual([
			{
				type: "error",
				text: "1 tool call(s) failed: [run_commands] Command not executed",
				recoverable: true,
			},
		]);
	});

	it("forwards non-recoverable errors unflagged", () => {
		const { ctx, sent } = makeContextWithPeer("session-1");

		handleSessionEvent(ctx, agentErrorEvent("session-1", false));

		expect(sent).toEqual([
			{
				type: "error",
				text: "1 tool call(s) failed: [run_commands] Command not executed",
				recoverable: false,
			},
		]);
	});
});
