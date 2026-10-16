import { describe, expect, test } from "bun:test";
import { failure, fakeRun } from "../connectors.fixtures";
import { GhReader, githubRepository, normalizeCheck } from "./gh";
import { ghHandler } from "./github.fixtures";

describe("gh, as Cline's PR bar uses it", () => {
	test("checks and remotes normalise exactly as the PR bar does", () => {
		expect(
			normalizeCheck({
				__typename: "CheckRun",
				status: "COMPLETED",
				conclusion: "TIMED_OUT",
				name: "e2e",
			}),
		).toEqual({ name: "e2e", state: "failure" });
		expect(
			normalizeCheck({
				__typename: "StatusContext",
				state: "PENDING",
				context: "ci",
			}),
		).toEqual({ name: "ci", state: "pending" });
		expect(
			normalizeCheck({
				__typename: "CheckRun",
				status: "COMPLETED",
				conclusion: "SKIPPED",
			}).state,
		).toBe("skipped");
		expect(githubRepository("https://github.com/cline/router.git")).toBe(
			"cline/router",
		);
		expect(githubRepository("origin: git@github.com:cline/router.git")).toBe(
			"cline/router",
		);
		expect(githubRepository("upstream: https://github.com/cline/router")).toBe(
			"cline/router",
		);
		expect(githubRepository("git@gitlab.com:cline/router.git")).toBeNull();
	});

	test("remembers that gh is not signed in for five minutes, then asks again", async () => {
		let now = 0;
		const run = fakeRun(() => {
			throw failure(1);
		});
		const gh = new GhReader(run, () => now);
		expect(await gh.isAvailable("/repo")).toBe(false);
		expect(await gh.isAvailable("/repo")).toBe(false);
		expect(run.calls).toHaveLength(1);
		now = 300_001;
		await gh.isAvailable("/repo");
		expect(run.calls).toHaveLength(2);
	});

	test("this branch's PR from the repository itself, open first; reviews as counts; CI per workflow", async () => {
		const gh = new GhReader(fakeRun(ghHandler));
		const pr = await gh.pullRequest("cline/router", "fix/405", "/repo");
		expect(pr).toMatchObject({ number: 12, mergeable: "MERGEABLE" });
		expect(pr?.checks.map((check) => check.state)).toEqual([
			"failure",
			"pending",
			"success",
		]);
		const reviews = await gh.reviewThreads("cline/router", 12, "/repo");
		expect(reviews).toEqual({
			unresolved: 1,
			authors: ["ana"],
			paths: ["src/routes.ts"],
		});
		expect(JSON.stringify(reviews)).not.toContain("PRIVATE");
		expect(await gh.defaultBranchCi("cline/router", "main", "/repo")).toEqual({
			branch: "main",
			failing: ["CI"],
			pending: ["Docs"],
			passing: 1,
		});
	});

	test("an expired sign-in mid-read fails the read, marks gh unavailable, and runs gh again only once that lapses", async () => {
		let now = 0;
		const run = fakeRun(({ args }) => {
			if (args[0] === "auth") return "";
			throw failure(1, "HTTP 401: Bad credentials");
		});
		const gh = new GhReader(run, () => now);
		expect(await gh.isAvailable("/repo")).toBe(true);
		await expect(
			gh.pullRequest("cline/router", "fix/405", "/repo"),
		).rejects.toThrow("failed");
		expect(await gh.isAvailable("/repo")).toBe(false);
		await expect(gh.defaultBranch("cline/router", "/repo")).rejects.toThrow(
			"gh is not available",
		);
		expect(run.calls).toHaveLength(2);
		now = 300_001;
		await expect(gh.defaultBranch("cline/router", "/repo")).rejects.toThrow(
			"failed",
		);
		expect(run.calls).toHaveLength(3);
	});

	test("falls back to Homebrew gh when PATH lacks it, and is unavailable when gh is absent everywhere", async () => {
		const fallbackRun = fakeRun((call) => {
			if (call.file === "gh") throw failure("ENOENT");
			if (call.file === "/opt/homebrew/bin/gh") return ghHandler(call);
			throw failure("ENOENT");
		});
		const gh = new GhReader(fallbackRun);
		expect(await gh.isAvailable("/repo")).toBe(true);
		expect(await gh.defaultBranch("cline/router", "/repo")).toBe("main");
		expect(fallbackRun.calls.at(-1)?.file).toBe("/opt/homebrew/bin/gh");

		const run = fakeRun(() => {
			throw failure("ENOENT");
		});
		const missing = new GhReader(run);
		expect(await missing.isAvailable("/repo")).toBe(false);
		expect(run.calls).toHaveLength(3);
	});
});
