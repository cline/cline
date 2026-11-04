import { describe, expect, it, vi } from "vitest";

// The resolver reads the SQLite session store through listChildSessionSummaries.
// Mock it so re-addressing can be tested in isolation from a real database.
let childSummaries: Array<{
	sessionId: string;
	agentId: string;
	status: string;
	startedAt: string;
}> = [];

vi.mock("./session-data/agents", () => ({
	listChildSessionSummaries: vi.fn(() => childSummaries),
}));

import { createSidecarContext, handleCoreSessionEvent } from "./context";
import type { SidecarContext } from "./types";

function createTeamContext(): SidecarContext {
	const ctx = createSidecarContext("/workspace/project");
	ctx.wsClients.add({ send: vi.fn() } as never);
	return ctx;
}

function emittedChatEvents(ctx: SidecarContext): Array<{
	sessionId: string;
	stream: string;
	chunk: string;
}> {
	const [client] = ctx.wsClients;
	const send = client?.send;
	if (!send || typeof send !== "function" || !("mock" in send)) {
		return [];
	}
	return (send as ReturnType<typeof vi.fn>).mock.calls
		.map(([raw]) => JSON.parse(String(raw)))
		.filter((message) => message.event?.name === "chat_event")
		.map((message) => message.event.payload)
		.filter(
			(payload) =>
				typeof payload.stream === "string" &&
				typeof payload.sessionId === "string",
		) as Array<{ sessionId: string; stream: string; chunk: string }>;
}

function teammateTextEvent(
	rootSessionId: string,
	teamAgentId: string,
	text: string,
) {
	return {
		type: "agent_event",
		payload: {
			sessionId: rootSessionId,
			event: { type: "content_start", contentType: "text", text },
			teamAgentId,
			teamRole: "teammate",
		},
	} as never;
}

function leadTextEvent(rootSessionId: string, text: string) {
	return {
		type: "agent_event",
		payload: {
			sessionId: rootSessionId,
			event: { type: "content_start", contentType: "text", text },
			teamAgentId: "lead",
			teamRole: "lead",
		},
	} as never;
}

describe("Teammate event re-addressing", () => {
	it("keeps lead events on the root session", () => {
		const ctx = createTeamContext();
		handleCoreSessionEvent(ctx, leadTextEvent("root-1", "Lead says hi"));

		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents).toHaveLength(1);
		expect(textEvents[0].sessionId).toBe("root-1");
	});

	it("re-addresses a teammate's events to its team-task child session", () => {
		const ctx = createTeamContext();
		const root = "root-2";
		const child = "root-2__teamtask__educator__abc123";
		childSummaries = [
			{
				sessionId: child,
				agentId: "educator",
				status: "running",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		];

		handleCoreSessionEvent(
			ctx,
			teammateTextEvent(root, "educator", "Teammate says hi"),
		);

		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents).toHaveLength(1);
		// The teammate's content lands on the child, never the root.
		expect(textEvents[0].sessionId).toBe(child);
		expect(textEvents.some((event) => event.sessionId === root)).toBe(false);
		// The child got its own independent stream index.
		expect(ctx.streamIndices.get(child)).toBe(1);
		expect(ctx.streamIndices.get(root)).toBeUndefined();
	});

	it("prefers a running child over a completed one for the same teammate", () => {
		const ctx = createTeamContext();
		const root = "root-3";
		const completed = "root-3__teamtask__assessor__done999";
		const running = "root-3__teamtask__assessor__live111";
		childSummaries = [
			{
				sessionId: completed,
				agentId: "assessor",
				status: "completed",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				sessionId: running,
				agentId: "assessor",
				status: "running",
				startedAt: "2026-01-02T00:00:00.000Z",
			},
		];

		handleCoreSessionEvent(
			ctx,
			teammateTextEvent(root, "assessor", "Second task"),
		);

		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents[0].sessionId).toBe(running);
	});

	it("ignores a subagent child (no team-task marker) for a teammate tag", () => {
		const ctx = createTeamContext();
		const root = "root-4";
		// A spawn_agent subagent child shares the teamAgentId but lacks the marker.
		childSummaries = [
			{
				sessionId: `${root}__coder`,
				agentId: "coder",
				status: "running",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		];

		handleCoreSessionEvent(ctx, teammateTextEvent(root, "coder", "Subagent"));

		// No eligible child -> degrades to the root so the event is not lost.
		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents).toHaveLength(1);
		expect(textEvents[0].sessionId).toBe(root);
	});

	it("falls back to the root when no child session exists yet", () => {
		const ctx = createTeamContext();
		const root = "root-5";
		childSummaries = [];

		handleCoreSessionEvent(
			ctx,
			teammateTextEvent(root, "educator", "Before the child row lands"),
		);

		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents).toHaveLength(1);
		expect(textEvents[0].sessionId).toBe(root);
	});

	it("re-addresses a teammate's completion (done) to its child, not the lead", () => {
		const ctx = createTeamContext();
		const root = "root-7";
		const child = "root-7__teamtask__educator__done42";
		childSummaries = [
			{
				sessionId: child,
				agentId: "educator",
				status: "completed",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		];

		// The completion message now carries the same team tags as the rest of
		// the teammate's content, so it re-addresses to the child session.
		handleCoreSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: root,
				event: {
					type: "done",
					reason: "completed",
					text: "Teammate finished.",
					iterations: 3,
				},
				teamAgentId: "educator",
				teamRole: "teammate",
			},
		} as never);

		const doneEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_done",
		);
		expect(doneEvents).toHaveLength(1);
		expect(doneEvents[0].sessionId).toBe(child);
		expect(doneEvents.some((event) => event.sessionId === root)).toBe(false);
	});

	it("re-resolves to a fresh child after a team_progress lifecycle event", () => {
		const ctx = createTeamContext();
		const root = "root-6";
		const first = "root-6__teamtask__educator__first11";
		const second = "root-6__teamtask__educator__second22";

		childSummaries = [
			{
				sessionId: first,
				agentId: "educator",
				status: "running",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		];
		// First sight caches the first child.
		handleCoreSessionEvent(ctx, teammateTextEvent(root, "educator", "Task 1"));
		expect(ctx.teamChildByAgent.get(`${root}\u0000educator`)).toBe(first);

		// A new task starts a fresh child; the running one now takes precedence.
		childSummaries = [
			{
				sessionId: first,
				agentId: "educator",
				status: "completed",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				sessionId: second,
				agentId: "educator",
				status: "running",
				startedAt: "2026-01-02T00:00:00.000Z",
			},
		];
		handleCoreSessionEvent(ctx, {
			type: "team_progress",
			payload: { sessionId: root },
		} as never);

		// The refreshed mapping points at the fresh running child.
		expect(ctx.teamChildByAgent.get(`${root}\u0000educator`)).toBe(second);
		handleCoreSessionEvent(ctx, teammateTextEvent(root, "educator", "Task 2"));
		const textEvents = emittedChatEvents(ctx).filter(
			(event) => event.stream === "chat_text",
		);
		expect(textEvents[1].sessionId).toBe(second);
	});
});
