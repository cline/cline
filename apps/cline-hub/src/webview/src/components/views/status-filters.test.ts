import type { StatusUpdate } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	EMPTY_STATUS_FILTERS,
	hasActiveFilters,
	matchesStatusFilters,
	sectionHeadingCount,
	type StatusFilters,
} from "./status-filters";

function update(overrides: Partial<StatusUpdate> = {}): StatusUpdate {
	return {
		schemaVersion: 1,
		updateId: "u1",
		seq: 1,
		subject: "migration/auth",
		state: "running",
		headline: "Rewriting the token exchange",
		priority: "normal",
		source: "agent",
		tags: [],
		supersededAt: null,
		createdAt: new Date(0).toISOString(),
		...overrides,
	} as StatusUpdate;
}

function filters(overrides: Partial<StatusFilters> = {}): StatusFilters {
	return { ...EMPTY_STATUS_FILTERS, ...overrides };
}

describe("hasActiveFilters", () => {
	it("is false for the empty filter set", () => {
		expect(hasActiveFilters(EMPTY_STATUS_FILTERS)).toBe(false);
	});

	it("is true for any single filter", () => {
		expect(hasActiveFilters(filters({ stateFilter: ["blocked"] }))).toBe(true);
		expect(hasActiveFilters(filters({ agentFilter: "adam" }))).toBe(true);
		expect(hasActiveFilters(filters({ search: "token" }))).toBe(true);
	});
});

describe("matchesStatusFilters", () => {
	it("admits everything when nothing is filtered", () => {
		expect(matchesStatusFilters(update(), EMPTY_STATUS_FILTERS)).toBe(true);
	});

	it("rejects a row outside the selected states", () => {
		const blockedOnly = filters({ stateFilter: ["blocked"] });
		expect(matchesStatusFilters(update({ state: "running" }), blockedOnly)).toBe(
			false,
		);
		expect(matchesStatusFilters(update({ state: "blocked" }), blockedOnly)).toBe(
			true,
		);
	});

	it("accepts a row in any of several selected states", () => {
		const f = filters({ stateFilter: ["blocked", "failed"] });
		expect(matchesStatusFilters(update({ state: "failed" }), f)).toBe(true);
		expect(matchesStatusFilters(update({ state: "done" }), f)).toBe(false);
	});

	it("rejects another agent's row", () => {
		const f = filters({ agentFilter: "adam" });
		expect(matchesStatusFilters(update({ agentId: "adam" }), f)).toBe(true);
		expect(matchesStatusFilters(update({ agentId: "beth" }), f)).toBe(false);
		// An unattributed row is not Adam's either.
		expect(matchesStatusFilters(update(), f)).toBe(false);
	});

	it("searches the headline and the detail, case-insensitively", () => {
		expect(
			matchesStatusFilters(update(), filters({ search: "TOKEN exchange" })),
		).toBe(true);
		expect(
			matchesStatusFilters(
				update({ detail: "Blocked on the KMS rotation" }),
				filters({ search: "kms" }),
			),
		).toBe(true);
		expect(matchesStatusFilters(update(), filters({ search: "kms" }))).toBe(
			false,
		);
	});

	it("requires every active filter to pass, not just one", () => {
		const f = filters({ stateFilter: ["blocked"], agentFilter: "adam" });
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "beth" }), f),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "running", agentId: "adam" }), f),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "adam" }), f),
		).toBe(true);
	});
});

describe("sectionHeadingCount", () => {
	it("prefers the whole-table count when unfiltered", () => {
		expect(sectionHeadingCount(3, 40, false)).toBe(40);
	});

	it("falls back to the row count when the summary has not arrived", () => {
		expect(sectionHeadingCount(3, undefined, false)).toBe(3);
	});

	it("describes the rows on screen once a filter is on", () => {
		// The summary counts every live row; the rows came from a filtered
		// query. Showing 40 above 3 rows contradicts the page.
		expect(sectionHeadingCount(3, 40, true)).toBe(3);
	});
});
