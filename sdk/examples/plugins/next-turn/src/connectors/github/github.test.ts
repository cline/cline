import { describe, expect, test } from "bun:test";
import type { SourceEnv } from "../../context/source";
import type { RunCommand } from "../../run";
import type { Settings } from "../../settings/settings";
import { connectorAccess } from "../access";
import { type Call, failure, fakeRun, repoEnv } from "../connectors.fixtures";
import { GhReader } from "./gh";
import { defaultCiLine, GitHubConnector, prLine, reviewLine } from "./github";
import { ghHandler, PR_VIEW, settingsWith } from "./github.fixtures";

const NO_CONNECTIONS = { composio: [], mcp: [], channels: [] };

function connector(
	settings: () => Settings,
	run: RunCommand & { calls: Call[] } = fakeRun(ghHandler),
	now = () => 600_000,
) {
	const github = new GitHubConnector({
		gh: new GhReader(run, now),
		access: () => connectorAccess(settings(), "github", true, "anthropic"),
		now,
	});
	return { github, run };
}

describe("the GitHub connector", () => {
	test("absent without a GitHub remote, unknown before detection, present once a route is found", async () => {
		const { github } = connector(() => settingsWith("mention"));
		expect(
			github.probe({
				...repoEnv,
				git: { branch: "x", remotes: ["git@gitlab.com:a/b.git"] },
			}),
		).toBe("absent");
		expect(github.probe(repoEnv)).toBe("unknown");
		await github.detect(repoEnv, NO_CONNECTIONS);
		expect(github.probe(repoEnv)).toBe("present");
		expect(github.capabilities(repoEnv)).toEqual(["github", "github:gh"]);
		expect(
			github.capabilities({ ...repoEnv, tools: ["GITHUB_LIST_PULL_REQUESTS"] }),
		).toEqual(["github", "github:gh", "github:agent-tools"]);
	});

	test("Mention reads nothing from GitHub and says which connection the agent can use", async () => {
		const { github, run } = connector(() => settingsWith("mention"));
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		expect(run.calls.map((call) => call.args[0])).toEqual(["auth"]);
		expect(github.facts(repoEnv)).toEqual({
			heading: "GitHub (connected; no data read)",
			lines: [
				"Suggestions may ask the agent to use it, through gh, signed in (the sign-in Cline's PR bar uses).",
			],
		});
	});

	test("Read: the chosen scopes, bounded and dated, with the PR as the source link", async () => {
		let now = 600_000;
		const { github } = connector(
			() => settingsWith("read", ["pr", "reviews"]),
			fakeRun(ghHandler),
			() => now,
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		await github.refresh("reviews", repoEnv);
		await github.refresh("default-ci", repoEnv);
		now += 3 * 60_000;
		expect(github.facts(repoEnv)).toEqual({
			heading: "GitHub · cline/router (as of 3m ago)",
			lines: [
				'PR #12 "Return 405 for wrong methods" · open · mergeable · checks: 1 failing (lint), 1 pending, 1 passing',
				"Review threads: 1 unresolved, opened by @ana, on src/routes.ts.",
			],
		});
	});

	test("when the sign-in expires, the last facts stay, with their age", async () => {
		let now = 600_000;
		let signedIn = true;
		const { github } = connector(
			() => settingsWith("read", ["pr"]),
			fakeRun((call) => {
				if (signedIn || call.args[0] === "auth") return ghHandler(call);
				throw failure(1, "HTTP 401: Bad credentials");
			}),
			() => now,
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		signedIn = false;
		now += 5 * 60_000;
		await expect(github.refresh("pr", repoEnv)).rejects.toThrow("failed");
		expect(github.facts(repoEnv)).toMatchObject({
			heading: "GitHub · cline/router (as of 5m ago)",
			lines: [expect.stringMatching(/^PR #12 /)],
		});
		expect(github.ciEvidence(repoEnv)?.failingChecks).toEqual(["lint"]);
	});

	test("a branch change makes the old facts unknown until the next refresh", async () => {
		const { github } = connector(() => settingsWith("read", ["pr"]));
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		expect(
			github.facts({
				...repoEnv,
				git: { branch: "other", remotes: repoEnv.git?.remotes ?? [] },
			}),
		).toBe("unknown");
	});

	test("scopes refreshing at once all keep their facts, and the PR is fetched once", async () => {
		const { github, run } = connector(() =>
			settingsWith("read", ["pr", "reviews", "default-ci"]),
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		await Promise.all([
			github.refresh("pr", repoEnv),
			github.refresh("reviews", repoEnv),
			github.refresh("default-ci", repoEnv),
		]);
		expect(github.facts(repoEnv)).toMatchObject({
			lines: [
				expect.stringMatching(/^PR #12 /),
				expect.stringMatching(/^Review threads: 1 unresolved/),
				expect.stringMatching(/^Default branch \(main\) CI: failing/),
			],
		});
		expect(github.ciEvidence(repoEnv)).toEqual({
			failingChecks: ["lint"],
			url: "https://github.com/cline/router/pull/12",
		});
		expect(
			run.calls.filter(
				(call) => call.args[0] === "pr" && call.args[1] === "view",
			),
		).toHaveLength(1);
	});

	test("reviews due with the PR read the PR being fetched, not the one read before", async () => {
		let number = 12;
		const run = fakeRun((call) =>
			call.args[0] === "pr" && call.args[1] === "view"
				? JSON.stringify({ ...JSON.parse(PR_VIEW), number })
				: ghHandler(call),
		);
		const { github } = connector(
			() => settingsWith("read", ["pr", "reviews"]),
			run,
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		number = 13;
		await Promise.all([
			github.refresh("pr", repoEnv),
			github.refresh("reviews", repoEnv),
		]);
		expect(run.calls.at(-1)?.args).toContain("number=13");
	});

	test("a refresh that finishes after a branch change does not replace the new branch's facts", async () => {
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run: RunCommand = async (file, args) => {
			if (args[0] === "repo") await held;
			return ghHandler({ file, args });
		};
		const { github } = connector(
			() => settingsWith("read", ["pr", "default-ci"]),
			Object.assign(run, { calls: [] }),
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		const stale = github.refresh("default-ci", repoEnv);
		const next: SourceEnv = {
			...repoEnv,
			git: { branch: "next", remotes: repoEnv.git?.remotes ?? [] },
		};
		await github.refresh("pr", next);
		release();
		await stale;
		expect(github.facts(next)).toMatchObject({
			lines: [expect.stringMatching(/^PR #12 /)],
		});
	});

	test("a refresh for a branch left and returned to does not replace the current branch's facts", async () => {
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const run: RunCommand = async (file, args) => {
			if (args[0] === "repo") await held;
			return ghHandler({ file, args });
		};
		const { github } = connector(
			() => settingsWith("read", ["pr", "default-ci"]),
			Object.assign(run, { calls: [] }),
		);
		await github.detect(repoEnv, NO_CONNECTIONS);
		await github.refresh("pr", repoEnv);
		const next: SourceEnv = {
			...repoEnv,
			git: { branch: "next", remotes: repoEnv.git?.remotes ?? [] },
		};
		const stale = github.refresh("default-ci", next);
		await github.refresh("pr", next);
		await github.refresh("pr", repoEnv);
		release();
		await stale;
		expect(github.facts(repoEnv)).toMatchObject({
			lines: [expect.stringMatching(/^PR #12 /)],
		});
	});

	test("lines read plainly in every state", () => {
		expect(prLine(null, "fix/405")).toBe("No pull request for fix/405 yet.");
		expect(
			prLine(
				{
					number: 3,
					title: "T",
					url: "u",
					state: "OPEN",
					isDraft: true,
					checks: [],
				},
				"b",
			),
		).toBe('PR #3 "T" · draft · checks: no checks');
		expect(reviewLine(null)).toBe("No unresolved review threads.");
		expect(
			defaultCiLine({ branch: "main", failing: [], pending: [], passing: 2 }),
		).toBe("Default branch (main) CI: passing.");
		expect(
			defaultCiLine({
				branch: "main",
				failing: ["a", "b", "c", "d", "e", "f", "g"],
				pending: [],
				passing: 0,
			}),
		).toBe("Default branch (main) CI: failing in a, b, c, d, e and 2 more.");
	});
});
