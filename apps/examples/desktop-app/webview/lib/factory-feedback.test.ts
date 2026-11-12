// @vitest-environment jsdom
import type { FactoryFeedbackAnalysis } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	factoryFeedbackRowState,
	factoryProposedRule,
	requestFactoryDiscussion,
	subscribeFactoryDiscussion,
	withFactoryDiscussionDraft,
} from "./factory-feedback";

const startedAt = "2026-01-02T00:00:00.000Z";
const proposal = {
	role: "factory" as const,
	scope: "repository" as const,
	change: { topic: "Billing", text: "Billing changes need a tester." },
	baseHash: "a",
	hash: "b",
	diff: "@@ -0,0 +1 @@\n+x\n",
	summary: 'Added "Billing"',
};

describe("factoryProposedRule", () => {
	it("names a card only while its rule from feedback waits for the person", () => {
		const outcome = (
			analysis: Pick<FactoryFeedbackAnalysis, "status"> &
				Partial<FactoryFeedbackAnalysis>,
			finding = "Off",
		) => ({
			taskId: "t1",
			outcome: {
				audit: {
					selectedAt: startedAt,
					finding,
					analysis: { trigger: "feedback" as const, startedAt, ...analysis },
				},
			},
		});
		expect(
			factoryProposedRule(
				outcome({ status: "proposed", summary: "Needs a tester.", proposal }),
			),
		).toEqual({ taskId: "t1", summary: "Needs a tester." });
		expect(
			factoryProposedRule(outcome({ status: "saved", proposal })),
		).toBeUndefined();
		// A later thumbs up clears the note, and with it the request.
		expect(
			factoryProposedRule(outcome({ status: "proposed", proposal }, "")),
		).toBeUndefined();
		// An unrated delivery is never counted.
		expect(factoryProposedRule({ taskId: "t2", outcome: {} })).toBeUndefined();
	});
});

describe("factoryFeedbackRowState", () => {
	it("describes the target in words and reads a stale check as stopped", () => {
		expect(
			factoryFeedbackRowState({
				status: "proposed",
				trigger: "feedback",
				startedAt,
				proposal,
			}),
		).toMatchObject({
			kind: "proposed",
			target: "Routing guidance · this project",
		});
		const now = Date.parse(startedAt);
		expect(
			factoryFeedbackRowState(
				{ status: "running", trigger: "feedback", startedAt },
				now + 60_000,
			),
		).toEqual({ kind: "running" });
		expect(
			factoryFeedbackRowState(
				{ status: "running", trigger: "feedback", startedAt },
				now + 11 * 60_000,
			),
		).toEqual({
			kind: "failed",
			message: "Factory stopped before it finished checking this note.",
		});
		expect(factoryFeedbackRowState(undefined)).toEqual({ kind: "note" });
	});
});

describe("Factory discussion requests", () => {
	it("reach the app until it unsubscribes", () => {
		const handler = vi.fn();
		const stop = subscribeFactoryDiscussion(handler);
		requestFactoryDiscussion({ taskId: "t1", shortId: "F1", draft: "Hi" });
		stop();
		requestFactoryDiscussion({ taskId: "t1", draft: "Again" });
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			taskId: "t1",
			shortId: "F1",
			draft: "Hi",
		});
	});
});

describe("withFactoryDiscussionDraft", () => {
	it("puts Discuss's draft below what is already typed, never in its place", () => {
		const draft = "My feedback on F13: wrong copy";
		expect(withFactoryDiscussionDraft("", draft)).toBe(draft);
		expect(withFactoryDiscussionDraft("  \n", draft)).toBe(draft);
		expect(withFactoryDiscussionDraft("How is F12 going?\n", draft)).toBe(
			`How is F12 going?\n\n${draft}`,
		);
		// Discuss twice adds it once.
		expect(
			withFactoryDiscussionDraft(`How is F12 going?\n\n${draft}`, draft),
		).toBe(`How is F12 going?\n\n${draft}`);
	});
});
