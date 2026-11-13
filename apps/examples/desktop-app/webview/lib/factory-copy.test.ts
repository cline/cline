import {
	FACTORY_SECURITY_FINDINGS_REVIEW,
	FACTORY_UNRESOLVED_FINDINGS_REVIEW,
} from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import {
	FACTORY_AGENT_LANES,
	FACTORY_CARD,
	FACTORY_CHECK_RESULT,
	FACTORY_COMPARE,
	FACTORY_MESSAGES,
	FACTORY_OPEN_FINDINGS,
	FACTORY_PANEL,
	FACTORY_PHASE_LABEL,
	FACTORY_PROOF,
	FACTORY_READY,
	factoryApprovalReasonText,
	factoryFeedbackLabel,
	factoryHistoryStatus,
	factoryPhaseLabel,
	factoryReviewReason,
	factoryReviewRequest,
	factoryRoleCount,
	factoryWorkingLimit,
	factoryWorkingOverLimit,
} from "./factory-copy";

describe("Factory copy", () => {
	it("names run phases in plain words", () => {
		expect(factoryPhaseLabel("implementing")).toBe("Building");
		expect(factoryPhaseLabel("verifying")).toBe("Testing");
		expect(factoryPhaseLabel("watching")).toBe("Watching CI on the draft PR");
		expect(factoryPhaseLabel("some_new_phase")).toBe("Some new phase");
		expect(Object.values(FACTORY_PHASE_LABEL).join(" ")).not.toMatch(
			/implement|candidate|verif/i,
		);
	});

	it("pluralizes role counts", () => {
		expect(factoryRoleCount("implementer", 1)).toBe("1 builder");
		expect(factoryRoleCount("implementer", 2)).toBe("2 builders");
		expect(factoryRoleCount("planReviewer", 0)).toBe("0 plan checkers");
	});

	it("states the working limit, and when it is lowered below the running work", () => {
		expect(factoryWorkingLimit(3)).toBe("of 3");
		expect(factoryWorkingOverLimit(2, 3)).toBeUndefined();
		expect(factoryWorkingOverLimit(15, 3)).toMatch(/limit of 3/);
	});

	it("describes feedback and finished work without engine terms", () => {
		// Feedback is optional: an unrated result has no feedback label.
		expect(factoryFeedbackLabel({})).toBeUndefined();
		expect(factoryFeedbackLabel(undefined)).toBeUndefined();
		expect(
			factoryFeedbackLabel({ reviewedAt: "2026-01-01", finding: "Missed X" }),
		).toBe("Feedback: something's off");
		expect(factoryHistoryStatus({ status: "completed", reviewed: true })).toBe(
			"Reviewed",
		);
		expect(factoryHistoryStatus({ status: "completed", phase: "ready" })).toBe(
			"Done",
		);
		expect(factoryHistoryStatus({ status: "pending_approval" })).toBe(
			"Waiting for approval",
		);
		expect(factoryHistoryStatus({ status: "cancelled", phase: "ready" })).toBe(
			"Cancelled",
		);
	});

	it("says why Factory asks for review in plain words", () => {
		expect(factoryReviewReason("shared contract")).toBe(
			"touches a shared contract",
		);
		expect(factoryReviewReason("cross cutting")).toBe(
			"cuts across the codebase",
		);
		expect(factoryReviewReason("review escalated")).toBe(
			"a reviewer found it riskier than planned",
		);
		expect(factoryReviewReason("impact unknown")).toBe(
			"Factory could not tell how far the change reaches",
		);
		expect(factoryReviewReason("sensitive paths")).toBe(
			"it changes sensitive files",
		);
		// The reasons core freezes for findings it could not clear.
		expect(factoryReviewReason(FACTORY_UNRESOLVED_FINDINGS_REVIEW)).toBe(
			"the reviewer left findings it could not clear",
		);
		expect(factoryReviewReason(FACTORY_SECURITY_FINDINGS_REVIEW)).toBe(
			"a possible security issue, kept off the PR",
		);
		expect(factoryReviewReason("verification profile changed")).toBe(
			"changes the test setup",
		);
		expect(factoryReviewReason("something new")).toBe("something new");
		expect(factoryReviewRequest("shared contract")).toBe(
			"Factory asks for your review: touches a shared contract.",
		);
	});

	it("words check limitations beside the result", () => {
		expect(
			FACTORY_CHECK_RESULT.limitations(["evidence file not captured"]),
		).toBe("Passed, but did not check: evidence file not captured");
	});
});

describe("card copy", () => {
	it("maps core's approval blockers to plain words and keeps the rest", () => {
		expect(
			factoryApprovalReasonText(
				"Complete adaptive design and reviewer selection for this revision before approval.",
			),
		).toBe(
			"Scoping has not chosen reviewers for this plan yet. Refine the plan to finish it.",
		);
		expect(
			factoryApprovalReasonText(
				"Complete plan review for this revision before approval. Refine the design to resolve missing reviews, findings or unverified work.",
			),
		).not.toContain("revision");
		expect(
			factoryApprovalReasonText("Describe every acceptance criterion."),
		).toBe("Describe every acceptance criterion.");
		expect(factoryApprovalReasonText(null)).toBeNull();
	});

	it("counts agent runs and cost without engine terms", () => {
		expect(FACTORY_CARD.costLine("$3.86", 1, 0)).toBe(
			"Model cost $3.86 · 1 agent run",
		);
		expect(FACTORY_CARD.costLine(undefined, 4, 0)).toBe("4 agent runs");
		expect(FACTORY_CARD.costLine("$1.00", 2, 1)).toBe(
			"Model cost $1.00 · cost unknown for 1 run · 2 agent runs",
		);
	});
});

describe("card redesign wording", () => {
	it("says what was delivered, not checked and left to do in plain words", () => {
		expect(FACTORY_READY.changes).toBe("Delivered on a branch, no PR");
		expect(FACTORY_PANEL.tabs.live).toBe("Agents");
		expect(FACTORY_PANEL.liveIdle({ role: "Builder", ago: "4m" })).toBe(
			"No agent on this card. Builder finished 4m ago.",
		);
		expect(FACTORY_PANEL.liveIdle()).toBe("No agent on this card yet.");
		expect(FACTORY_OPEN_FINDINGS.next(2)).toBe(
			"The reviewer left 2 findings Factory did not fix. Have Factory fix them, or accept as is.",
		);
		expect(FACTORY_OPEN_FINDINGS.next(1)).toContain("left 1 finding Factory");
		expect(FACTORY_CARD.noCriterionResults).toBe(
			"Not proven per requirement: this run only ran the checks.",
		);
		expect(FACTORY_MESSAGES.notFound).toBe(
			"Can't find this card. Back to Factory.",
		);
		expect(FACTORY_PROOF.provenCount(6, 7)).toBe("6 of 7 requirements proven");
		expect(FACTORY_PROOF.checkLimitation("ui", ["no screenshot"])).toBe(
			"ui: Passed, but did not check: no screenshot",
		);
		expect(FACTORY_AGENT_LANES.finished("Builder", "4m")).toBe(
			"Builder finished · 4m",
		);
		expect(FACTORY_COMPARE.runOption(2, 3, "completed")).toBe(
			"Attempt 2 · plan version 3 · completed",
		);
	});
});
