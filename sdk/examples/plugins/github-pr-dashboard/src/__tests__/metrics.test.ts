import { describe, expect, it } from "vitest";
import { renderDashboardHtml, summarizeDashboardChanges } from "../format";
import { buildDashboardSnapshot, hashDashboardSnapshot } from "../metrics";

describe("github PR dashboard metrics", () => {
	it("computes summary, waiting list, trends, authors, and reviewers", () => {
		const snapshot = buildDashboardSnapshot({
			generatedAt: new Date("2026-06-10T00:00:00Z"),
			repositories: ["cline/cline"],
			newPrHours: 48,
			recentlyClosedDays: 7,
			trendDays: 3,
			pullsByRepo: {
				"cline/cline": [
					{
						number: 1,
						title: "Open waiting",
						url: "https://github.com/cline/cline/pull/1",
						state: "open",
						draft: false,
						author: "john",
						createdAt: "2026-06-09T00:00:00Z",
						updatedAt: "2026-06-09T12:00:00Z",
						requestedReviewers: ["amy"],
						requestedTeams: [],
					},
					{
						number: 2,
						title: "Merged",
						url: "https://github.com/cline/cline/pull/2",
						state: "closed",
						draft: false,
						author: "sam",
						createdAt: "2026-06-08T00:00:00Z",
						updatedAt: "2026-06-09T00:00:00Z",
						closedAt: "2026-06-09T01:00:00Z",
						mergedAt: "2026-06-09T01:00:00Z",
						requestedReviewers: [],
						requestedTeams: [],
					},
				],
			},
			reviewsByRepo: {
				"cline/cline": [
					{
						repository: "cline/cline",
						prNumber: 2,
						reviewer: "amy",
						state: "APPROVED",
						submittedAt: "2026-06-09T00:30:00Z",
					},
				],
			},
		});

		expect(snapshot.summary.openCount).toBe(1);
		expect(snapshot.summary.newOpenCount).toBe(1);
		expect(snapshot.summary.recentlyClosedCount).toBe(1);
		expect(snapshot.waitingForReview[0]?.waitingHours).toBe(24);
		expect(snapshot.leadingAuthors.week).toEqual([
			{ login: "john", count: 1 },
			{ login: "sam", count: 1 },
		]);
		expect(snapshot.leadingReviewers.week).toEqual([
			{ login: "amy", count: 1 },
		]);
		expect(snapshot.volumeTrend.at(-2)).toEqual({
			date: "2026-06-09",
			opened: 1,
			closed: 1,
			merged: 1,
		});
	});

	it("de-duplicates reviewer counts per repository and PR number", () => {
		const snapshot = buildDashboardSnapshot({
			generatedAt: new Date("2026-06-10T00:00:00Z"),
			repositories: ["cline/cline", "cline/sdk"],
			newPrHours: 24,
			recentlyClosedDays: 7,
			trendDays: 1,
			pullsByRepo: { "cline/cline": [], "cline/sdk": [] },
			reviewsByRepo: {
				"cline/cline": [
					{
						repository: "cline/cline",
						prNumber: 12,
						reviewer: "amy",
						state: "APPROVED",
						submittedAt: "2026-06-09T00:00:00Z",
					},
					{
						repository: "cline/cline",
						prNumber: 12,
						reviewer: "amy",
						state: "COMMENTED",
						submittedAt: "2026-06-09T01:00:00Z",
					},
				],
				"cline/sdk": [
					{
						repository: "cline/sdk",
						prNumber: 12,
						reviewer: "amy",
						state: "APPROVED",
						submittedAt: "2026-06-09T00:00:00Z",
					},
				],
			},
		});

		expect(snapshot.leadingReviewers.week).toEqual([
			{ login: "amy", count: 2 },
		]);
	});

	it("hash ignores generatedAt and time-derived age fields", () => {
		const base = {
			generatedAt: "2026-06-10T00:00:00Z",
			repositories: ["cline/cline"],
			window: { newPrHours: 24, recentlyClosedDays: 7, trendDays: 1 },
			summary: {
				openCount: 0,
				newOpenCount: 0,
				recentlyClosedCount: 0,
				avgOpenAgeHours: 1,
				avgWaitingForReviewHours: 2,
			},
			waitingForReview: [
				{
					repository: "cline/cline",
					number: 1,
					title: "Waiting",
					url: "https://github.com/cline/cline/pull/1",
					author: "john",
					waitingHours: 3,
					requestedReviewers: ["amy"],
					requestedTeams: [],
					updatedAt: "2026-06-10T00:00:00Z",
				},
			],
			volumeTrend: [{ date: "2026-06-10", opened: 0, closed: 0, merged: 0 }],
			leadingAuthors: { week: [], month: [] },
			leadingReviewers: { week: [], month: [] },
			repositoryBreakdown: [
				{
					repository: "cline/cline",
					openCount: 0,
					newOpenCount: 0,
					recentlyClosedCount: 0,
					avgOpenAgeHours: 4,
					avgWaitingForReviewHours: 5,
				},
			],
		};
		expect(hashDashboardSnapshot(base)).toBe(
			hashDashboardSnapshot({
				...base,
				generatedAt: "2026-06-11T00:00:00Z",
				summary: {
					...base.summary,
					avgOpenAgeHours: 10,
					avgWaitingForReviewHours: 20,
				},
				waitingForReview: base.waitingForReview.map((pull) => ({
					...pull,
					waitingHours: 30,
				})),
				repositoryBreakdown: base.repositoryBreakdown.map((repository) => ({
					...repository,
					avgOpenAgeHours: 40,
					avgWaitingForReviewHours: 50,
				})),
			}),
		);
	});

	it("renders a standalone HTML dashboard", () => {
		const snapshot = buildDashboardSnapshot({
			generatedAt: new Date("2026-06-10T00:00:00Z"),
			repositories: ["cline/cline"],
			newPrHours: 24,
			recentlyClosedDays: 7,
			trendDays: 1,
			pullsByRepo: { "cline/cline": [] },
			reviewsByRepo: { "cline/cline": [] },
		});

		const html = renderDashboardHtml(snapshot);
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("GitHub PR Dashboard");
		expect(html).toContain("cline/cline");
	});

	it("summarizes dashboard deltas from a previous snapshot", () => {
		const previous = buildDashboardSnapshot({
			generatedAt: new Date("2026-06-10T00:00:00Z"),
			repositories: ["cline/cline"],
			newPrHours: 24,
			recentlyClosedDays: 7,
			trendDays: 1,
			pullsByRepo: { "cline/cline": [] },
			reviewsByRepo: { "cline/cline": [] },
		});
		const current = buildDashboardSnapshot({
			generatedAt: new Date("2026-06-10T00:00:00Z"),
			repositories: ["cline/cline"],
			newPrHours: 24,
			recentlyClosedDays: 7,
			trendDays: 1,
			pullsByRepo: {
				"cline/cline": [
					{
						number: 1,
						title: "New dashboard PR",
						url: "https://github.com/cline/cline/pull/1",
						state: "open",
						draft: false,
						author: "john",
						createdAt: "2026-06-10T00:00:00Z",
						updatedAt: "2026-06-10T00:00:00Z",
						requestedReviewers: ["amy"],
						requestedTeams: [],
					},
				],
			},
			reviewsByRepo: { "cline/cline": [] },
		});

		expect(summarizeDashboardChanges(previous, current)).toContain(
			"Open PRs: 0 → 1 (+1)",
		);
		expect(summarizeDashboardChanges(previous, current)).toContain(
			"Newly waiting for review: cline/cline#1 New dashboard PR",
		);
	});
});
