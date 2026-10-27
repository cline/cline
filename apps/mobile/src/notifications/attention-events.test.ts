import type { PendingApprovalInfo } from "@cline/shared";
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
import { createSessionState, selectViewModel } from "../session";
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
