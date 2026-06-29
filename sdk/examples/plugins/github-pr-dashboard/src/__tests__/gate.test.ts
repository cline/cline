import { describe, expect, it, vi } from "vitest";
import { runGitHubPrDashboardGate } from "../gate";

const env = {
	GITHUB_REPOSITORIES: "cline/cline",
	GITHUB_PR_DASHBOARD_MAX_PRS: "5",
	GITHUB_PR_DASHBOARD_PATH: "docs/pr-dashboard.md",
} as NodeJS.ProcessEnv;

const pull = {
	number: 1,
	title: "Dashboard PR",
	state: "open",
	draft: false,
	user: { login: "john" },
	created_at: "2026-06-09T00:00:00Z",
	updated_at: "2026-06-09T12:00:00Z",
	requested_reviewers: [{ login: "amy" }],
};

describe("github PR dashboard gate", () => {
	it("returns handoff when dashboard snapshot changes", async () => {
		const writeState = vi.fn();
		const result = await runGitHubPrDashboardGate({
			env,
			readState: () => ({ version: 1 }),
			writeState,
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});

		expect(result.stop).toBeUndefined();
		expect(result.dashboardPath).toBe("docs/pr-dashboard.md");
		expect(result.handoffText).toContain(
			"Dashboard path to update: docs/pr-dashboard.md",
		);
		expect(result.handoffText).toContain("# GitHub PR Dashboard");
		expect(result.changeSummary).toEqual([
			"Initial dashboard snapshot captured; future runs will summarize changes from this baseline.",
		]);
		expect(writeState).toHaveBeenCalledWith(
			expect.objectContaining({
				lastSnapshotHash: result.snapshotHash,
				lastSnapshot: result.snapshot,
			}),
		);
	});

	it("stops before model when snapshot hash is unchanged", async () => {
		let hash = "";
		const first = await runGitHubPrDashboardGate({
			env,
			readState: () => ({ version: 1 }),
			writeState: (state) => {
				hash = state.lastSnapshotHash ?? "";
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});
		const second = await runGitHubPrDashboardGate({
			env,
			readState: () => ({ version: 1, lastSnapshotHash: hash }),
			writeState: vi.fn(),
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});

		expect(first.stop).toBeUndefined();
		expect(second.stop).toBe(true);
		expect(second.reason).toBe("no GitHub PR dashboard changes, exiting");
		expect(second.changeSummary).toEqual([]);
		expect(second.handoffText).toBeUndefined();
	});

	it("includes deterministic change summary from previous snapshot", async () => {
		let previousSnapshot:
			| import("../schema").GitHubPrDashboardSnapshot
			| undefined;
		const first = await runGitHubPrDashboardGate({
			env,
			readState: () => ({ version: 1 }),
			writeState: (state) => {
				previousSnapshot = state.lastSnapshot;
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});
		const second = await runGitHubPrDashboardGate({
			env,
			readState: () => ({
				version: 1,
				lastSnapshotHash: first.snapshotHash,
				lastSnapshot: previousSnapshot,
			}),
			writeState: () => undefined,
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) =>
				url.includes("/reviews")
					? []
					: [
							pull,
							{
								...pull,
								number: 2,
								title: "Second PR",
							},
						],
		});

		expect(second.stop).toBeUndefined();
		expect(second.changeSummary).toContain("Open PRs: 1 → 2 (+1)");
		expect(second.handoffText).toContain(
			"What changed since the previous run:",
		);
		expect(second.handoffText).toContain("Open PRs: 1 → 2 (+1)");
	});

	it("treats an unreadable state file as empty state", async () => {
		const result = await runGitHubPrDashboardGate({
			env,
			readState: () => ({ version: 1 }),
			writeState: () => undefined,
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});

		expect(result.stop).toBeUndefined();
		expect(result.handoffText).toContain("# GitHub PR Dashboard");
	});
});
