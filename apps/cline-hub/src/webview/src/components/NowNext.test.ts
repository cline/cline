import { describe, expect, it } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import { shouldShowNowNext } from "./nowNextLogic";

const empty: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
};

const planned: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

describe("shouldShowNowNext", () => {
	it("collapses when no active plan", () => {
		expect(shouldShowNowNext(empty)).toBe(false);
	});

	it("shows when now task exists", () => {
		expect(shouldShowNowNext(planned)).toBe(true);
	});
});
