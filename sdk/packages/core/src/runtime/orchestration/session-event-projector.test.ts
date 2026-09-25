/**
 * Tests for the session-event projector (Phase 3a): the explicit
 * routing rule that replaces the v1 timing heuristic (P5).
 */
import { describe, expect, it } from "vitest";
import { projectSessionEvent } from "./session-event-projector";
import type { CoreSessionEvent } from "../../types/events";

const agentEvent = (overrides: Record<string, unknown> = {}) =>
	({ type: "content_start", contentType: "text", text: "hi", ...overrides }) as never;

const sessionEvent = (
	payloadOverrides: Record<string, unknown>,
	eventOverrides: Record<string, unknown> = {},
): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId: "s1",
			event: agentEvent(eventOverrides),
			...payloadOverrides,
		},
	}) as never;

describe("session-event projector", () => {
	it("routes sub-agent events (parentAgentId) to the child path", () => {
		const [projected] = projectSessionEvent(
			sessionEvent({}, { parentAgentId: "root", agentId: "agent-a" }),
		);
		expect(projected.agentPath).toEqual(["root", "agent-a"]);
		expect(projected.unattributed).toBe(false);
	});

	it("routes teammate events (teamAgentId) to their own path", () => {
		const [projected] = projectSessionEvent(
			sessionEvent({ teamAgentId: "worker-1", teamRole: "teammate" }),
		);
		expect(projected.agentPath).toEqual(["root", "worker-1"]);
		expect(projected.unattributed).toBe(false);
	});

	it("routes plain lead events to the root path", () => {
		const [projected] = projectSessionEvent(sessionEvent({}));
		expect(projected.agentPath).toEqual(["root"]);
		expect(projected.unattributed).toBe(false);
	});

	it("flags events with an agentId but no attribution as unattributed (the P5 hole, visible)", () => {
		const [projected] = projectSessionEvent(
			sessionEvent({}, { agentId: "agent-a" }),
		);
		expect(projected.agentPath).toEqual(["root"]);
		expect(projected.unattributed).toBe(true);
	});

	it("projects non-agent session events to nothing", () => {
		expect(
			projectSessionEvent({ type: "ended", payload: { sessionId: "s1", reason: "", ts: 0 } } as never),
		).toEqual([]);
	});
});
