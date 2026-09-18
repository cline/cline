import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "../../types/events";
import {
	createHubEventProjector,
	HOST_OWNED_HUB_EVENTS,
	isHostOwnedHubEvent,
	parseCoreSessionSnapshot,
} from "./hub-event-projector";

function envelope(
	event: string,
	payload?: Record<string, unknown>,
	overrides: Partial<HubEventEnvelope> = {},
): HubEventEnvelope {
	return {
		type: "event",
		event,
		sessionId: "sess-1",
		timestamp: 1_000,
		payload,
		...overrides,
	} as HubEventEnvelope;
}

function agentEvents(events: CoreSessionEvent[]) {
	return events.flatMap((event) =>
		event.type === "agent_event" ? [event.payload.event] : [],
	);
}

function setup(options?: { now?: () => number }) {
	const events: CoreSessionEvent[] = [];
	const onEvent = vi.fn((event: CoreSessionEvent) => {
		events.push(event);
	});
	const projector = createHubEventProjector(onEvent, options);
	return { projector, events, onEvent };
}

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		sessionId: "sess-1",
		status: "running",
		interactive: true,
		...overrides,
	};
}

describe("createHubEventProjector", () => {
	describe("host-owned envelopes", () => {
		it("does not project capability or approval envelopes and reports them unhandled", () => {
			const { projector, onEvent } = setup();
			for (const name of HOST_OWNED_HUB_EVENTS) {
				expect(isHostOwnedHubEvent(name)).toBe(true);
				expect(
					projector.handle(
						envelope(name, { requestId: "req-1", toolCallId: "tool-1" }),
					),
				).toBe(false);
			}
			expect(onEvent).not.toHaveBeenCalled();
			expect(isHostOwnedHubEvent("assistant.delta")).toBe(false);
		});

		it("treats envelopes without a session id as handled no-ops", () => {
			const { projector, onEvent } = setup();
			expect(
				projector.handle(
					envelope("assistant.delta", { text: "hi" }, { sessionId: "  " }),
				),
			).toBe(true);
			expect(
				projector.handle(
					envelope("assistant.delta", { text: "hi" }, { sessionId: undefined }),
				),
			).toBe(true);
			expect(onEvent).not.toHaveBeenCalled();
		});

		it("ignores unknown envelopes but reports them handled", () => {
			const { projector, onEvent } = setup();
			expect(projector.handle(envelope("something.else", { x: 1 }))).toBe(true);
			expect(onEvent).not.toHaveBeenCalled();
		});
	});

	describe("text projection", () => {
		it("maps assistant.delta to text content_start and drops empty deltas", () => {
			const { projector, events } = setup();
			projector.handle(envelope("assistant.delta", { text: "Hel" }));
			projector.handle(envelope("assistant.delta", { text: "" }));
			projector.handle(envelope("assistant.delta", {}));
			projector.handle(envelope("assistant.delta", { text: "lo" }));
			expect(agentEvents(events)).toEqual([
				{ type: "content_start", contentType: "text", text: "Hel" },
				{ type: "content_start", contentType: "text", text: "lo" },
			]);
			expect(
				events.every((event) => event.payload.sessionId === "sess-1"),
			).toBe(true);
		});

		it("maps assistant.finished to text content_end with optional text", () => {
			const { projector, events } = setup();
			projector.handle(envelope("assistant.finished", { text: "Hello" }));
			projector.handle(envelope("assistant.finished", {}));
			expect(agentEvents(events)).toEqual([
				{ type: "content_end", contentType: "text", text: "Hello" },
				{ type: "content_end", contentType: "text", text: undefined },
			]);
		});

		it("maps assistant.media only when the payload is generated media", () => {
			const { projector, events } = setup();
			const media = {
				id: "media-1",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			};
			projector.handle(envelope("assistant.media", { media }));
			projector.handle(envelope("assistant.media", { media: "nope" }));
			projector.handle(envelope("assistant.media", { media: { kind: "x" } }));
			const projected = agentEvents(events);
			expect(projected).toHaveLength(1);
			expect(projected[0]).toMatchObject({
				type: "content_end",
				contentType: "media",
				media,
			});
		});
	});

	describe("reasoning projection", () => {
		it("maps reasoning deltas including redacted-only deltas", () => {
			const { projector, events } = setup();
			projector.handle(envelope("reasoning.delta", { text: "thinking" }));
			projector.handle(envelope("reasoning.delta", { redacted: true }));
			projector.handle(envelope("reasoning.delta", { text: "" }));
			projector.handle(envelope("reasoning.finished", { reasoning: "done" }));
			projector.handle(envelope("reasoning.finished", {}));
			expect(agentEvents(events)).toEqual([
				{
					type: "content_start",
					contentType: "reasoning",
					reasoning: "thinking",
					redacted: false,
				},
				{
					type: "content_start",
					contentType: "reasoning",
					reasoning: "",
					redacted: true,
				},
				{ type: "content_end", contentType: "reasoning", reasoning: "done" },
				{ type: "content_end", contentType: "reasoning", reasoning: undefined },
			]);
		});
	});

	describe("tool projection", () => {
		it("maps tool.started, tool.updated and tool.finished", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("tool.started", {
					toolCallId: "tool-1",
					toolName: "read_file",
					input: { path: "a.ts" },
				}),
			);
			projector.handle(
				envelope("tool.updated", {
					toolCallId: "tool-1",
					toolName: "read_file",
					update: { progress: 50 },
				}),
			);
			projector.handle(
				envelope("tool.finished", {
					toolCallId: "tool-1",
					toolName: "read_file",
					output: "contents",
					error: 42,
				}),
			);
			expect(agentEvents(events)).toEqual([
				{
					type: "content_start",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "read_file",
					input: { path: "a.ts" },
				},
				{
					type: "content_update",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "read_file",
					update: { progress: 50 },
				},
				{
					type: "content_end",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "read_file",
					output: "contents",
					error: undefined,
				},
			]);
		});

		it("suppresses the tool.started content_start for a tool call announced via approval", () => {
			const { projector, events } = setup();
			projector.announceToolCall({
				sessionId: "sess-1",
				toolCallId: "tool-1",
				toolName: "write_file",
				toolInput: { path: "b.ts" },
			});
			projector.handle(
				envelope("tool.started", {
					toolCallId: "tool-1",
					toolName: "write_file",
					input: { path: "b.ts" },
				}),
			);
			// A second tool.started for the same id is no longer suppressed.
			projector.handle(
				envelope("tool.started", {
					toolCallId: "tool-1",
					toolName: "write_file",
				}),
			);
			const starts = agentEvents(events).filter(
				(event) => event.type === "content_start",
			);
			expect(starts).toHaveLength(2);
			expect(starts[0]).toMatchObject({
				contentType: "tool",
				toolCallId: "tool-1",
				input: { path: "b.ts" },
			});
		});

		it("clears an announced tool call on tool.finished so the id can be reused", () => {
			const { projector, events } = setup();
			projector.announceToolCall({ sessionId: "sess-1", toolCallId: "tool-1" });
			projector.handle(envelope("tool.finished", { toolCallId: "tool-1" }));
			expect(
				projector.getSessionState("sess-1")?.announcedToolCallIds.has("tool-1"),
			).toBe(false);
			projector.handle(envelope("tool.started", { toolCallId: "tool-1" }));
			expect(
				agentEvents(events).filter((event) => event.type === "content_start"),
			).toHaveLength(2);
		});

		it("keeps announced tool calls scoped per session", () => {
			const { projector, events } = setup();
			projector.announceToolCall({ sessionId: "sess-1", toolCallId: "tool-1" });
			projector.handle(
				envelope(
					"tool.started",
					{ toolCallId: "tool-1" },
					{ sessionId: "sess-2" },
				),
			);
			expect(events).toHaveLength(2);
			expect(events[1]?.payload.sessionId).toBe("sess-2");
		});
	});

	describe("iteration and notice projection", () => {
		it("maps iteration lifecycle envelopes with defaults", () => {
			const { projector, events } = setup();
			projector.handle(envelope("iteration.started", { iteration: 2 }));
			projector.handle(envelope("iteration.started", {}));
			projector.handle(
				envelope("iteration.finished", {
					iteration: 2,
					hadToolCalls: true,
					toolCallCount: 3,
				}),
			);
			projector.handle(envelope("iteration.finished", undefined));
			expect(agentEvents(events)).toEqual([
				{ type: "iteration_start", iteration: 2 },
				{ type: "iteration_start", iteration: 0 },
				{
					type: "iteration_end",
					iteration: 2,
					hadToolCalls: true,
					toolCallCount: 3,
				},
				{
					type: "iteration_end",
					iteration: 0,
					hadToolCalls: false,
					toolCallCount: 0,
				},
			]);
		});

		it("maps session.notice with agent/team metadata and normalizes notice type", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("session.notice", {
					noticeType: "recovery",
					displayRole: "system",
					reason: "provider_retry",
					message: "Retrying",
					metadata: { attempt: 2 },
					agent: {
						agentId: "agent-1",
						conversationId: "conv-1",
						parentAgentId: "agent-0",
						teamAgentId: "coder",
						teamRole: "teammate",
					},
				}),
			);
			projector.handle(envelope("session.notice", { noticeType: "weird" }));
			expect(events[0]).toEqual({
				type: "agent_event",
				payload: {
					sessionId: "sess-1",
					teamRole: "teammate",
					teamAgentId: "coder",
					event: {
						type: "notice",
						agentId: "agent-1",
						conversationId: "conv-1",
						parentAgentId: "agent-0",
						noticeType: "recovery",
						message: "Retrying",
						displayRole: "system",
						reason: "provider_retry",
						metadata: { attempt: 2 },
					},
				},
			});
			expect(agentEvents(events)[1]).toEqual({
				type: "notice",
				noticeType: "status",
				message: "",
			});
		});
	});

	describe("queue projection", () => {
		it("maps session.pending_prompts and defaults to an empty list", () => {
			const { projector, events } = setup();
			const prompts = [
				{ id: "p1", prompt: "one", delivery: "queue", attachmentCount: 0 },
			];
			projector.handle(envelope("session.pending_prompts", { prompts }));
			projector.handle(envelope("session.pending_prompts", { prompts: "bad" }));
			expect(events).toEqual([
				{
					type: "pending_prompts",
					payload: { sessionId: "sess-1", prompts },
				},
				{
					type: "pending_prompts",
					payload: { sessionId: "sess-1", prompts: [] },
				},
			]);
		});

		it("maps session.pending_prompt_submitted and drops envelopes without a prompt", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("session.pending_prompt_submitted", {
					prompt: {
						id: "p1",
						prompt: "queued text",
						delivery: "steer",
						attachmentCount: 1,
						userImages: ["img"],
						userFiles: ["file"],
						extra: "ignored",
					},
				}),
			);
			projector.handle(envelope("session.pending_prompt_submitted", {}));
			expect(events).toEqual([
				{
					type: "pending_prompt_submitted",
					payload: {
						sessionId: "sess-1",
						id: "p1",
						prompt: "queued text",
						delivery: "steer",
						attachmentCount: 1,
						userImages: ["img"],
						userFiles: ["file"],
					},
				},
			]);
		});
	});

	describe("usage projection", () => {
		it("maps usage.updated deltas, totals and team metadata", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("usage.updated", {
					delta: {
						inputTokens: 10,
						outputTokens: 5,
						cacheReadTokens: 2,
						cacheWriteTokens: 1,
						totalCost: 0.01,
					},
					totals: {
						inputTokens: 100,
						outputTokens: 50,
						cacheReadTokens: 20,
						cacheWriteTokens: 10,
						totalCost: 0.1,
					},
					agent: {
						agentId: "agent-1",
						conversationId: "conv-1",
						parentAgentId: "agent-0",
						teamAgentId: "lead-agent",
						teamRole: "lead",
					},
				}),
			);
			expect(events).toEqual([
				{
					type: "agent_event",
					payload: {
						sessionId: "sess-1",
						teamAgentId: "lead-agent",
						teamRole: "lead",
						event: {
							type: "usage",
							agentId: "agent-1",
							conversationId: "conv-1",
							parentAgentId: "agent-0",
							inputTokens: 10,
							outputTokens: 5,
							cacheReadTokens: 2,
							cacheWriteTokens: 1,
							cost: 0.01,
							totalInputTokens: 100,
							totalOutputTokens: 50,
							totalCacheReadTokens: 20,
							totalCacheWriteTokens: 10,
							totalCost: 0.1,
						},
					},
				},
			]);
		});

		it("zero-fills missing or non-finite usage metrics", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("usage.updated", {
					delta: {
						inputTokens: Number.NaN,
						totalCost: Number.POSITIVE_INFINITY,
					},
				}),
			);
			expect(agentEvents(events)[0]).toMatchObject({
				type: "usage",
				agentId: undefined,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				cost: undefined,
				totalInputTokens: 0,
				totalCost: undefined,
			});
		});
	});

	describe("completion projection", () => {
		it("emits exactly one done per run across agent.done and run.completed", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("agent.done", {
					reason: "completed",
					text: "final",
					iterations: 3,
					usage: { inputTokens: 1, outputTokens: 2 },
				}),
			);
			projector.handle(
				envelope("run.completed", { reason: "completed", text: "dup" }),
			);
			const done = agentEvents(events).filter((event) => event.type === "done");
			expect(done).toEqual([
				{
					type: "done",
					reason: "completed",
					text: "final",
					iterations: 3,
					usage: {
						inputTokens: 1,
						outputTokens: 2,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				},
			]);
			expect(events.filter((event) => event.type === "ended")).toEqual([
				{
					type: "ended",
					payload: { sessionId: "sess-1", reason: "completed", ts: 1_000 },
				},
			]);
		});

		it("resets done dedup on run.started so the next run emits done again", () => {
			const { projector, events } = setup();
			projector.handle(envelope("agent.done", { reason: "completed" }));
			projector.handle(
				envelope("run.started", { session: { status: "running" } }),
			);
			projector.handle(envelope("agent.done", { reason: "completed" }));
			expect(
				agentEvents(events).filter((event) => event.type === "done"),
			).toHaveLength(2);
			expect(events.filter((event) => event.type === "status")).toEqual([
				{
					type: "status",
					payload: { sessionId: "sess-1", status: "running" },
				},
			]);
		});

		it("normalizes run.failed and run.aborted reasons and reads result payloads", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope(
					"run.failed",
					{
						result: {
							finishReason: "failed",
							text: "boom",
							iterations: 2,
							usage: { inputTokens: 3, outputTokens: 4, totalCost: 0.5 },
						},
					},
					{ timestamp: undefined },
				),
			);
			projector.handle(
				envelope("run.aborted", undefined, { sessionId: "sess-2" }),
			);
			const done = agentEvents(events).filter((event) => event.type === "done");
			expect(done).toEqual([
				{
					type: "done",
					reason: "error",
					text: "boom",
					iterations: 2,
					usage: {
						inputTokens: 3,
						outputTokens: 4,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.5,
					},
				},
				{
					type: "done",
					reason: "aborted",
					text: "",
					iterations: 0,
					usage: undefined,
				},
			]);
			const ended = events.filter((event) => event.type === "ended");
			expect(ended[0]?.payload).toMatchObject({
				sessionId: "sess-1",
				reason: "error",
			});
			expect(typeof (ended[0]?.payload as { ts: number }).ts).toBe("number");
			expect(ended[1]?.payload).toMatchObject({
				sessionId: "sess-2",
				reason: "aborted",
				ts: 1_000,
			});
		});

		it("uses the injected clock for ended.ts when the envelope has no timestamp", () => {
			const { projector, events } = setup({ now: () => 4_242 });
			projector.handle(
				envelope("run.completed", undefined, { timestamp: undefined }),
			);
			expect(events.find((event) => event.type === "ended")?.payload).toEqual({
				sessionId: "sess-1",
				reason: "completed",
				ts: 4_242,
			});
		});

		it("suppresses ended for interactive sessions that remain non-terminal", () => {
			const { projector, events } = setup();
			projector.handle(
				envelope("run.completed", {
					reason: "completed",
					snapshot: snapshot({ interactive: true, status: "running" }),
				}),
			);
			expect(agentEvents(events).map((event) => event.type)).toEqual(["done"]);
			expect(events.some((event) => event.type === "ended")).toBe(false);

			projector.reset("sess-1");
			projector.handle(
				envelope("run.completed", {
					reason: "completed",
					snapshot: snapshot({ interactive: true, status: "completed" }),
				}),
			);
			expect(events.some((event) => event.type === "ended")).toBe(true);
		});

		it("dedups done independently per session", () => {
			const { projector, events } = setup();
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));
			expect(
				agentEvents(events).filter((event) => event.type === "done"),
			).toHaveLength(2);
		});
	});

	describe("snapshot baseline projection", () => {
		it("emits session_snapshot and status for run.started with a snapshot", () => {
			const { projector, events } = setup();
			const snap = snapshot({ status: "running" });
			projector.handle(
				envelope("run.started", {
					snapshot: snap,
					session: { status: "running" },
				}),
			);
			expect(events).toEqual([
				{
					type: "session_snapshot",
					payload: { sessionId: "sess-1", snapshot: snap },
				},
				{
					type: "status",
					payload: { sessionId: "sess-1", status: "running" },
				},
			]);
		});

		it("maps session.* lifecycle envelopes and skips status when none is known", () => {
			const { projector, events } = setup();
			const snap = snapshot({ status: "completed" });
			projector.handle(envelope("session.updated", { snapshot: snap }));
			projector.handle(
				envelope("session.attached", { session: { status: "idle" } }),
			);
			projector.handle(envelope("session.detached", {}));
			projector.handle(
				envelope("session.created", {
					snapshot: { version: 2, sessionId: "x" },
				}),
			);
			expect(events).toEqual([
				{
					type: "session_snapshot",
					payload: { sessionId: "sess-1", snapshot: snap },
				},
				{
					type: "status",
					payload: { sessionId: "sess-1", status: "completed" },
				},
				{
					type: "status",
					payload: { sessionId: "sess-1", status: "idle" },
				},
			]);
		});

		it("parseCoreSessionSnapshot accepts only version 1 snapshots with an id", () => {
			expect(parseCoreSessionSnapshot(snapshot())).toEqual(snapshot());
			expect(parseCoreSessionSnapshot({ version: 2, sessionId: "s" })).toBe(
				undefined,
			);
			expect(parseCoreSessionSnapshot({ version: 1 })).toBe(undefined);
			expect(parseCoreSessionSnapshot([snapshot()])).toBe(undefined);
			expect(parseCoreSessionSnapshot(null)).toBe(undefined);
		});
	});

	describe("reset and dispose", () => {
		it("reset(sessionId) clears only that session's pending state", () => {
			const { projector, events } = setup();
			projector.announceToolCall({ sessionId: "sess-1", toolCallId: "tool-1" });
			projector.announceToolCall({ sessionId: "sess-2", toolCallId: "tool-2" });
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));

			projector.reset("sess-1");
			expect(projector.getSessionState("sess-1")).toBe(undefined);
			expect(projector.getSessionState("sess-2")).toMatchObject({
				doneEmittedForCurrentRun: true,
			});

			// sess-1 baseline was replaced: a fresh terminal event and a fresh
			// tool.started both project again; sess-2 keeps deduping.
			projector.handle(envelope("tool.started", { toolCallId: "tool-1" }));
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));
			const tail = agentEvents(events).slice(2);
			expect(tail.map((event) => event.type)).toEqual([
				"done",
				"done",
				"content_start",
				"done",
			]);
		});

		it("reset() without an id clears every session", () => {
			const { projector, events } = setup();
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));
			projector.reset();
			projector.handle(envelope("agent.done", {}));
			projector.handle(envelope("agent.done", {}, { sessionId: "sess-2" }));
			expect(
				agentEvents(events).filter((event) => event.type === "done"),
			).toHaveLength(4);
		});

		it("dispose() drops state and ignores further envelopes and announcements", () => {
			const { projector, events, onEvent } = setup();
			projector.handle(envelope("agent.done", {}));
			projector.dispose();
			expect(projector.getSessionState("sess-1")).toBe(undefined);
			expect(projector.handle(envelope("assistant.delta", { text: "x" }))).toBe(
				true,
			);
			expect(projector.handle(envelope("approval.requested", {}))).toBe(false);
			projector.announceToolCall({ sessionId: "sess-1", toolCallId: "tool-9" });
			expect(events).toHaveLength(1);
			expect(onEvent).toHaveBeenCalledTimes(1);
		});
	});
});
