import type { HubEventEnvelope, PendingApprovalInfo } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type AttentionEvent,
	CloudLaunches,
} from "../connection/cloud-launches";
import {
	type ConnectionSnapshot,
	SessionConnectionController,
} from "../connection/controller";
import { descriptorKey } from "../connection/endpoints";
import { createSessionState, reduceSession, selectViewModel } from "../session";
import { attentionChanges } from "./attention-events";

const view = () => ({
	...selectViewModel(createSessionState()),
	connectionStatus: "live" as const,
});
const approval = { approvalId: "a1" } as PendingApprovalInfo;
describe("task attention events", () => {
	it("does not alert on initial hydration, reconnect baselines or unchanged asks", () => {
		const pending = {
			...view(),
			pendingApprovals: [approval],
			pendingQuestions: [
				{ requestId: "q1", question: "Which?", options: ["A", "B"] },
			],
		};
		expect(attentionChanges(undefined, pending)).toEqual([]);
		expect(
			attentionChanges({ ...view(), connectionStatus: "hydrating" }, pending),
		).toEqual([]);
		expect(attentionChanges(pending, pending)).toEqual([]);
		expect(attentionChanges(view(), pending)).toEqual([
			{ id: "approval:a1", kind: "approval" },
			{ id: "question:q1", kind: "question" },
		]);
	});
	it("alerts for new failures and terminal completion but not between queued turns", () => {
		const previous = { ...view(), runStatus: "running" as const };
		const completed = {
			...view(),
			runStatus: "completed" as const,
			lastRun: { endedAt: 12 },
		};
		expect(attentionChanges(previous, completed)).toEqual([
			{ id: "completed:12", kind: "completed" },
		]);
		expect(
			attentionChanges(previous, {
				...completed,
				pendingPrompts: [
					{ id: "next", prompt: "Next", delivery: "queue", attachmentCount: 0 },
				],
			}),
		).toEqual([]);
		expect(
			attentionChanges(previous, { ...completed, runStatus: "failed" }),
		).toEqual([{ id: "error:12", kind: "error" }]);
	});

	it("keeps queued work running across old terminal events and alerts only on the final outcome", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = reduceSession(state, { type: "hydrated", messages: [] });
		let sequence = 0;
		const event = (
			name: HubEventEnvelope["event"],
			payload: Record<string, unknown> = {},
		) => {
			const previous = selectViewModel(state);
			state = reduceSession(state, {
				type: "event",
				envelope: {
					version: "v1",
					event: name,
					eventId: `queued-${++sequence}`,
					timestamp: sequence * 1000,
					payload,
				},
			});
			return attentionChanges(previous, selectViewModel(state));
		};
		event("run.started");
		// Queue submission precedes the old terminal projection. Its snapshot
		// already describes the next running turn, even with an empty queue.
		event("session.pending_prompts", {
			prompts: [{ id: "next", prompt: "Next", delivery: "queue" }],
		});
		event("session.pending_prompt_submitted", {
			prompt: { id: "next", prompt: "Next", delivery: "queue" },
		});
		expect(selectViewModel(state).pendingPrompts).toEqual([]);
		event("session.updated", {
			session: { sessionId: "inner", status: "running" },
		});
		for (const terminal of [
			"run.completed",
			"run.completed",
			"run.aborted",
			"run.failed",
		] as const) {
			expect(
				event(terminal, {
					snapshot: { sessionId: "inner", status: "running" },
				}),
			).toEqual([]);
			expect(selectViewModel(state).runStatus).toBe("running");
			expect(selectViewModel(state).lastRun?.outcome).toBeUndefined();
		}
		expect(
			event("approval.requested", {
				approvalId: "a1",
				sessionId: "inner",
				agentId: "agent",
				conversationId: "conversation",
				iteration: 1,
				toolCallId: "tool1",
				toolName: "run_commands",
				inputJson: "{}",
				policy: {},
				createdAt: 1,
			}),
		).toEqual([{ id: "approval:a1", kind: "approval" }]);
		event("approval.resolved", { approvalId: "a1", approved: true });
		expect(
			event("run.completed", { snapshot: { status: "completed" } }),
		).toEqual([{ id: `completed:${sequence * 1000}`, kind: "completed" }]);
		expect(selectViewModel(state).lastRun?.outcome).toBe("completed");
		event("run.started");
		expect(event("run.aborted", { snapshot: { status: "aborted" } })).toEqual(
			[],
		);
		expect(selectViewModel(state).runStatus).toBe("aborted");
		expect(selectViewModel(state).lastRun?.outcome).toBe("aborted");
		// A delayed duplicate can also recover a session already marked ended.
		expect(event("run.completed", { snapshot: { status: "running" } })).toEqual(
			[],
		);
		expect(selectViewModel(state).runStatus).toBe("running");
		expect(selectViewModel(state).lastRun).toBeUndefined();
		expect(
			event("run.failed", {
				reason: "Provider failed",
				snapshot: { status: "failed" },
			}),
		).toEqual([{ id: `error:${sequence * 1000}`, kind: "error" }]);
		expect(selectViewModel(state).lastRun?.outcome).toBe("failed");
		expect(selectViewModel(state).lastError).toBe("Provider failed");
	});

	it("does not announce completion while an approval or question still needs attention", () => {
		const previous = { ...view(), runStatus: "running" as const };
		const completed = { ...view(), runStatus: "completed" as const };
		expect(
			attentionChanges(previous, {
				...completed,
				pendingApprovals: [approval],
			}),
		).toEqual([{ id: "approval:a1", kind: "approval" }]);
		expect(
			attentionChanges(previous, {
				...completed,
				pendingQuestions: [
					{ requestId: "q1", question: "Which?", options: ["A", "B"] },
				],
			}),
		).toEqual([{ id: "question:q1", kind: "question" }]);
	});

	it("restores a running session without a model update and clears the previous summary", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = reduceSession(state, {
			type: "hydrated",
			messages: [],
			runStatus: "completed",
		});
		state = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "run.completed",
				eventId: "finished",
				timestamp: 1,
				payload: {},
			},
		});
		expect(selectViewModel(state).lastRun?.outcome).toBe("completed");
		state = reduceSession(state, {
			type: "event",
			envelope: {
				version: "v1",
				event: "session.updated",
				eventId: "next-running",
				payload: { session: { sessionId: "inner", status: "running" } },
			},
		});
		expect(selectViewModel(state).runStatus).toBe("running");
		expect(selectViewModel(state).lastRun).toBeUndefined();
	});

	it("emits exact Cloud IDs and current focus, and retires focus and listeners on sign-out clear", () => {
		const descriptor = {
			mode: "cloud" as const,
			url: "https://saved.invalid/task",
			remoteSessionId: "outer",
			hubSessionId: "inner",
		};
		const controller = new SessionConnectionController(descriptor);
		vi.spyOn(controller, "start").mockResolvedValue();
		let snapshot: ConnectionSnapshot = {
			view: view(),
			status: { phase: "ready" },
			sessionId: "inner",
		};
		vi.spyOn(controller, "getSnapshot").mockImplementation(() => snapshot);
		let changed = () => {};
		vi.spyOn(controller, "subscribe").mockImplementation((callback) => {
			changed = callback;
			return () => {};
		});
		const launches = new CloudLaunches(() => controller);
		const events: AttentionEvent[] = [];
		const remove = launches.subscribeAttention((event) => events.push(event));
		launches.open(descriptor);
		changed();
		const oldFocus = launches.focusForAttention({
			...descriptor,
			url: "https://saved.invalid/old",
		});
		launches.focusForAttention(descriptor);
		oldFocus();
		expect(launches.isAttentionFocused(descriptorKey(descriptor))).toBe(true);
		snapshot = {
			...snapshot,
			view: { ...snapshot.view, pendingApprovals: [approval] },
		};
		changed();
		changed();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "attention",
			kind: "approval",
			remoteSessionId: "outer",
			sessionId: "inner",
			endpointKey: descriptorKey(descriptor),
			focused: true,
		});
		launches.clear();
		expect(launches.isAttentionFocused(descriptorKey(descriptor))).toBe(false);
		expect(events.at(-1)).toEqual({ type: "clear" });
		const count = events.length;
		remove();
		changed();
		expect(events).toHaveLength(count);
	});
});
