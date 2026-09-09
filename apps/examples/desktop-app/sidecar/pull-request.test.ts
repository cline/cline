import { describe, expect, it, vi } from "vitest";
import { mergeStatusLabel, summarizeChecks } from "../webview/lib/pull-request";
import {
	getPullRequestStatus,
	githubRepository,
	normalizeCheck,
} from "./pull-request";

const pr = {
	number: 42,
	title: "Feature",
	url: "https://github.com/cline/cline/pull/42",
	state: "OPEN",
	isDraft: false,
	mergeable: "MERGEABLE",
	mergeStateStatus: "CLEAN",
	additions: 12,
	deletions: 3,
	headRepositoryOwner: { login: "cline" },
	headRepository: { name: "cline" },
	statusCheckRollup: [
		{
			__typename: "CheckRun",
			name: "Test",
			status: "COMPLETED",
			conclusion: "SUCCESS",
		},
	],
};

function runner(prs: unknown[] = [pr], branch = "feature/pr-ui") {
	return vi.fn(async (file: string, args: string[], _cwd: string) => {
		if (file === "git")
			return args[0] === "branch" ? branch : "git@github.com:cline/cline.git";
		if (args[0] === "pr" && args[1] === "view")
			return JSON.stringify(
				prs.find((item) => (item as typeof pr).number === Number(args[2])),
			);
		return JSON.stringify(
			args[0] === "repo" ? { defaultBranchRef: { name: "main" } } : prs,
		);
	});
}

describe("pull request status", () => {
	it("reads the active workspace, filters same-named fork branches and prefers an open PR", async () => {
		const run = runner([
			{ ...pr, number: 99, headRepositoryOwner: { login: "someone" } },
			{ ...pr, number: 41, state: "MERGED" },
			pr,
		]);
		const result = await getPullRequestStatus("/worktree", run);
		expect(result?.pullRequest?.number).toBe(42);
		expect(result?.pullRequest?.checks[0].state).toBe("success");
		expect(result?.createUrl).toBe(
			"https://github.com/cline/cline/compare/main...feature%2Fpr-ui?expand=1",
		);
		expect(run.mock.calls.every((call) => call[2] === "/worktree")).toBe(true);
		expect(run.mock.calls.find((call) => call[1][0] === "pr")?.[1]).toContain(
			"feature/pr-ui",
		);
	});
	it("offers creation for a feature branch and hides it for the default branch", async () => {
		expect(
			(await getPullRequestStatus("/repo", runner([])))?.pullRequest,
		).toBeNull();
		expect(await getPullRequestStatus("/repo", runner([], "main"))).toBeNull();
	});
	it("keeps merged and closed PR states", async () => {
		for (const state of ["MERGED", "CLOSED"] as const) {
			const result = await getPullRequestStatus(
				"/repo",
				runner([{ ...pr, state }]),
			);
			expect(result?.pullRequest?.state).toBe(state);
		}
	});
	it("does not invoke GitHub for detached HEAD or unsupported remotes", async () => {
		const detached = runner([], "");
		expect(await getPullRequestStatus("/repo", detached)).toBeNull();
		expect(detached).toHaveBeenCalledTimes(1);
		const local = vi.fn(async () => "local");
		expect(await getPullRequestStatus("/repo", local)).toBeNull();
		expect(local).toHaveBeenCalledTimes(2);
	});
	it("distinguishes a missing CLI from a failed lookup, rather than offering creation", async () => {
		for (const code of ["ENOENT", "ETIMEDOUT"]) {
			const base = runner();
			const run = async (file: string, args: string[], cwd: string) => {
				if (file === "gh")
					throw Object.assign(new Error("private stderr"), { code });
				return base(file, args, cwd);
			};
			await expect(getPullRequestStatus("/repo", run)).rejects.toThrow(
				code === "ENOENT" ? "Install GitHub CLI" : "Could not load",
			);
		}
	});
	it("accepts GitHub SSH/HTTPS remotes only", () => {
		for (const remote of [
			"git@github.com:cline/cline.git",
			"https://github.com/cline/cline.git",
			"ssh://git@github.com/cline/cline",
		])
			expect(githubRepository(remote)).toBe("cline/cline");
		expect(
			githubRepository("https://github.com.evil.test/cline/cline"),
		).toBeNull();
	});
});

describe("check and merge states", () => {
	it("handles check runs, legacy statuses, skipped checks and unsafe links", () => {
		const pending = normalizeCheck({
			__typename: "CheckRun",
			status: "IN_PROGRESS",
			conclusion: "SUCCESS",
		});
		const failed = normalizeCheck({
			__typename: "StatusContext",
			state: "ERROR",
			context: "Build",
			targetUrl: "javascript:alert(1)",
		});
		const skipped = normalizeCheck({
			__typename: "CheckRun",
			status: "COMPLETED",
			conclusion: "SKIPPED",
		});
		expect(pending.state).toBe("pending");
		expect(failed).toEqual({ name: "Build", state: "failure", url: undefined });
		expect(summarizeChecks([pending, failed])).toBe("failure");
		expect(summarizeChecks([skipped])).toBe("skipped");
		expect(summarizeChecks([])).toBe("none");
	});
	it("never calls an unknown, draft or blocked PR ready to merge", async () => {
		const result = await getPullRequestStatus("/repo", runner());
		const value = result!.pullRequest!;
		expect(mergeStatusLabel({ ...value, mergeStateStatus: "BLOCKED" })).toBe(
			"Blocked",
		);
		expect(mergeStatusLabel({ ...value, isDraft: true })).toBe("Draft");
		expect(
			mergeStatusLabel({
				...value,
				mergeable: "UNKNOWN",
				mergeStateStatus: "UNKNOWN",
			}),
		).toBe("Merge status pending");
		expect(mergeStatusLabel({ ...value, mergeable: "CONFLICTING" })).toBe(
			"Conflicts",
		);
	});
});
