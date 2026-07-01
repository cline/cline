import { describe, expect, it, vi } from "vitest";
import {
	markGitHubPrDashboardSnapshotApplied,
	runGitHubPrDashboardGate,
} from "../gate";

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
				pendingSnapshotHash: result.snapshotHash,
				pendingSnapshot: result.snapshot,
			}),
		);
	});

	it("stops before model when snapshot hash is unchanged", async () => {
		let state: import("../state").GitHubPrDashboardState = { version: 1 };
		const first = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});
		markGitHubPrDashboardSnapshotApplied({
			snapshotHash: first.snapshotHash ?? "",
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
		});
		const second = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
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

	it("stops before model when an identical snapshot is already pending", async () => {
		let state: import("../state").GitHubPrDashboardState = { version: 1 };
		const first = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});
		const writeState = vi.fn((nextState) => {
			state = nextState;
		});
		const second = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
			writeState,
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});

		expect(first.stop).toBeUndefined();
		expect(state.pendingSnapshotHash).toBe(first.snapshotHash);
		expect(second.stop).toBe(true);
		expect(second.handoffText).toBeUndefined();
		expect(second.changeSummary).toEqual([]);
		expect(writeState).toHaveBeenCalledWith(
			expect.objectContaining({
				pendingSnapshotHash: first.snapshotHash,
			}),
		);
		expect(state.lastSnapshotHash).toBeUndefined();
	});

	it("includes deterministic change summary from previous snapshot", async () => {
		let state: import("../state").GitHubPrDashboardState = { version: 1 };
		const first = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});
		markGitHubPrDashboardSnapshotApplied({
			snapshotHash: first.snapshotHash ?? "",
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
		});
		const second = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
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

	it("does not mark a changed snapshot as applied until explicitly promoted", async () => {
		let state: import("../state").GitHubPrDashboardState = { version: 1 };
		const result = await runGitHubPrDashboardGate({
			env,
			readState: () => state,
			writeState: (nextState) => {
				state = nextState;
			},
			now: () => new Date("2026-06-10T00:00:00Z"),
			fetchJson: async (url) => (url.includes("/reviews") ? [] : [pull]),
		});

		expect(state.lastSnapshotHash).toBeUndefined();
		expect(state.pendingSnapshotHash).toBe(result.snapshotHash);
		expect(
			markGitHubPrDashboardSnapshotApplied({
				snapshotHash: result.snapshotHash ?? "",
				readState: () => state,
				writeState: (nextState) => {
					state = nextState;
				},
			}),
		).toBe(true);
		expect(state.lastSnapshotHash).toBe(result.snapshotHash);
		expect(state.pendingSnapshotHash).toBeUndefined();
	});
});
