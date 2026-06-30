import { describe, expect, it } from "vitest";
import {
	fetchGitHubPrDashboardData,
	normalizePullRequest,
	normalizeReview,
} from "../github";

describe("github PR dashboard GitHub client", () => {
	it("normalizes pull requests", () => {
		expect(
			normalizePullRequest("cline/cline", {
				number: 12,
				title: "Dashboard",
				html_url: "https://github.com/cline/cline/pull/12",
				state: "open",
				draft: false,
				user: { login: "john" },
				created_at: "2026-06-01T00:00:00Z",
				updated_at: "2026-06-02T00:00:00Z",
				requested_reviewers: [{ login: "amy" }],
				requested_teams: [{ slug: "platform" }],
			}),
		).toEqual({
			number: 12,
			title: "Dashboard",
			url: "https://github.com/cline/cline/pull/12",
			state: "open",
			draft: false,
			author: "john",
			createdAt: "2026-06-01T00:00:00Z",
			updatedAt: "2026-06-02T00:00:00Z",
			requestedReviewers: ["amy"],
			requestedTeams: ["platform"],
		});
	});

	it("normalizes reviews", () => {
		expect(
			normalizeReview("cline/cline", 12, {
				user: { login: "amy" },
				state: "APPROVED",
				submitted_at: "2026-06-02T00:00:00Z",
			}),
		).toEqual({
			repository: "cline/cline",
			prNumber: 12,
			reviewer: "amy",
			state: "APPROVED",
			submittedAt: "2026-06-02T00:00:00Z",
		});
	});

	it("fetches open pulls separately so open counts are not limited by recent activity", async () => {
		const urls: string[] = [];
		const result = await fetchGitHubPrDashboardData({
			env: {
				GITHUB_REPOSITORIES: "cline/cline",
				GITHUB_TOKEN: "token-1",
				GITHUB_PR_DASHBOARD_MAX_PRS: "5",
			} as NodeJS.ProcessEnv,
			fetchJson: async (url) => {
				urls.push(url);
				if (url.includes("/reviews")) {
					return [
						{
							user: { login: "amy" },
							state: "APPROVED",
							submitted_at: "2026-06-03T00:00:00Z",
						},
					];
				}
				if (url.includes("state=open")) {
					return [
						{
							number: 1,
							title: "Open PR 1",
							state: "open",
							user: { login: "john" },
							created_at: "2026-06-01T00:00:00Z",
							updated_at: "2026-06-02T00:00:00Z",
						},
						{
							number: 2,
							title: "Open PR 2",
							state: "open",
							user: { login: "amy" },
							created_at: "2026-06-01T00:00:00Z",
							updated_at: "2026-06-01T12:00:00Z",
						},
					];
				}
				if (url.includes("state=closed")) {
					return [
						{
							number: 3,
							title: "Recently closed PR",
							state: "closed",
							user: { login: "sam" },
							created_at: "2026-06-01T00:00:00Z",
							updated_at: "2026-06-03T00:00:00Z",
							closed_at: "2026-06-03T00:00:00Z",
						},
					];
				}
				return [
					{
						number: 4,
						title: "Recent activity PR",
						state: "open",
						user: { login: "lee" },
						created_at: "2026-06-01T00:00:00Z",
						updated_at: "2026-06-03T00:00:00Z",
					},
				];
			},
			now: new Date("2026-06-04T00:00:00Z"),
		});

		expect(
			result.pullsByRepo["cline/cline"]?.map((pull) => pull.number),
		).toEqual([4, 3, 1, 2]);
		expect(result.reviewsByRepo["cline/cline"]?.[0]?.reviewer).toBe("amy");
		expect(urls.some((url) => url.includes("state=open"))).toBe(true);
		expect(urls.some((url) => url.includes("state=closed"))).toBe(true);
		expect(urls.some((url) => url.includes("state=all"))).toBe(true);
		expect(urls.some((url) => url.includes("/pulls/4/reviews"))).toBe(true);
		expect(urls.some((url) => url.includes("/pulls/1/reviews"))).toBe(false);
	});

	it("caps open PR pagination and returns a warning when the cap is reached", async () => {
		const urls: string[] = [];
		const fullPage = Array.from({ length: 100 }, (_, index) => ({
			number: index + 1,
			title: `Open PR ${index + 1}`,
			state: "open",
			user: { login: "john" },
			created_at: "2026-06-01T00:00:00Z",
			updated_at: "2026-06-02T00:00:00Z",
		}));
		const result = await fetchGitHubPrDashboardData({
			env: {
				GITHUB_REPOSITORIES: "cline/cline",
				GITHUB_PR_DASHBOARD_MAX_OPEN_PAGES: "2",
			} as NodeJS.ProcessEnv,
			fetchJson: async (url) => {
				urls.push(url);
				if (url.includes("state=open")) return fullPage;
				return [];
			},
			now: new Date("2026-06-04T00:00:00Z"),
		});

		expect(result.pullsByRepo["cline/cline"]).toHaveLength(100);
		expect(
			urls
				.filter((url) => url.includes("state=open"))
				.map((url) => new URL(url).searchParams.get("page")),
		).toEqual(["1", "2"]);
		expect(result.warnings).toEqual([
			expect.objectContaining({
				repository: "cline/cline",
				type: "open-pr-page-limit",
			}),
		]);
	});
});
