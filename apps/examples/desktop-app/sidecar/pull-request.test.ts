import { describe, expect, it, vi } from "vitest";
import { getMergeStatus, summarizeChecks } from "../webview/lib/pull-request";
import {
	createPullRequestStatusReader,
	GITHUB_AVAILABILITY_CACHE_MS,
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
		const result = await createPullRequestStatusReader({ run })("/worktree");
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
			(await createPullRequestStatusReader({ run: runner([]) })("/repo"))
				?.pullRequest,
		).toBeNull();
		expect(
			await createPullRequestStatusReader({ run: runner([], "main") })("/repo"),
		).toBeNull();
	});
	it("keeps merged and closed PR states", async () => {
		for (const state of ["MERGED", "CLOSED"] as const) {
			const result = await createPullRequestStatusReader({
				run: runner([{ ...pr, state }]),
			})("/repo");
			expect(result?.pullRequest?.state).toBe(state);
		}
	});
	it("does not invoke GitHub for detached HEAD or unsupported remotes", async () => {
		const detached = runner([], "");
		expect(
			await createPullRequestStatusReader({ run: detached })("/repo"),
		).toBeNull();
		expect(detached).toHaveBeenCalledTimes(1);
		const local = vi.fn(async () => "local");
		expect(
			await createPullRequestStatusReader({ run: local })("/repo"),
		).toBeNull();
		expect(local).toHaveBeenCalledTimes(2);
	});
	it.each([
		"ENOENT",
		1,
		4,
	])("hides unavailable GitHub CLI (%s), shares the cooldown, and recovers after login", async (code) => {
		let time = 0;
		let authenticated = false;
		const base = runner();
		const run = vi.fn(async (file: string, args: string[], cwd: string) => {
			if (file === "gh" && args[0] === "auth" && !authenticated)
				throw Object.assign(new Error("private stderr"), { code });
			return base(file, args, cwd);
		});
		const read = createPullRequestStatusReader({ run, now: () => time });
		expect(await read("/repo")).toBeNull();
		const attempts = run.mock.calls.length;
		authenticated = true;
		time = GITHUB_AVAILABILITY_CACHE_MS - 1;
		expect(await read("/other-workspace")).toBeNull();
		expect(run).toHaveBeenCalledTimes(attempts);
		time++;
		expect((await read("/repo"))?.pullRequest?.number).toBe(42);
		expect(run.mock.calls.filter((call) => call[1][0] === "auth")).toHaveLength(
			2,
		);
	});

	it("shares an in-flight availability check across concurrent workspaces", async () => {
		let finish!: () => void;
		const waiting = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const base = runner();
		const run = vi.fn(async (file: string, args: string[], cwd: string) => {
			if (args[0] === "auth") await waiting;
			return base(file, args, cwd);
		});
		const read = createPullRequestStatusReader({ run });
		const first = read("/first");
		const second = read("/second");
		await vi.waitFor(() =>
			expect(
				run.mock.calls.filter((call) => call[1][0] === "auth"),
			).toHaveLength(1),
		);
		finish();
		await Promise.all([first, second]);
		expect(run.mock.calls.filter((call) => call[1][0] === "auth")).toHaveLength(
			1,
		);
	});

	it("hides default-branch authentication failures before any repository query", async () => {
		const base = runner([], "main");
		const run = vi.fn(async (file: string, args: string[], cwd: string) => {
			if (file === "gh")
				throw Object.assign(new Error("Not logged in"), { code: 1 });
			return base(file, args, cwd);
		});
		expect(await createPullRequestStatusReader({ run })("/repo")).toBeNull();
		expect(
			run.mock.calls.filter((call) => call[0] === "gh").map((call) => call[1]),
		).toEqual([["auth", "status", "--active", "--hostname", "github.com"]]);
	});

	it.each([
		{ code: 4 },
		{ code: 1, stderr: "HTTP 401: Bad credentials" },
	])("invalidates cached availability if authentication expires during a lookup", async (failure) => {
		let expired = false;
		const base = runner();
		const run = vi.fn(async (file: string, args: string[], cwd: string) => {
			if (args[0] === "repo" && expired)
				throw Object.assign(new Error("Failed"), failure);
			return base(file, args, cwd);
		});
		const read = createPullRequestStatusReader({ run });
		expect((await read("/repo"))?.pullRequest?.number).toBe(42);
		expired = true;
		expect(await read("/repo")).toBeNull();
		const attempts = run.mock.calls.length;
		expect(await read("/other")).toBeNull();
		expect(run).toHaveBeenCalledTimes(attempts);
	});

	it("preserves transient lookup errors after successful authentication", async () => {
		const base = runner();
		const run = async (file: string, args: string[], cwd: string) => {
			if (args[0] === "repo")
				throw Object.assign(new Error("private stderr"), {
					code: 1,
					stderr: "error connecting to api.github.com",
				});
			return base(file, args, cwd);
		};
		await expect(
			createPullRequestStatusReader({ run })("/repo"),
		).rejects.toThrow(
			"Could not load pull request status. Check your connection and try again.",
		);
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
		const result = await createPullRequestStatusReader({ run: runner() })(
			"/repo",
		);
		const value = result!.pullRequest!;
		expect(
			getMergeStatus({ ...value, mergeStateStatus: "BLOCKED" }).label,
		).toBe("Blocked");
		expect(getMergeStatus({ ...value, isDraft: true }).label).toBe("Draft");
		expect(
			getMergeStatus({
				...value,
				mergeable: "UNKNOWN",
				mergeStateStatus: "UNKNOWN",
			}).label,
		).toBe("Merge status pending");
		expect(getMergeStatus({ ...value, mergeable: "CONFLICTING" }).label).toBe(
			"Conflicts",
		);
	});
});
