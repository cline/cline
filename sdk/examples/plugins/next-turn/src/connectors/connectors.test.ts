import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerRegistration } from "@cline/core";
import { sourceOff } from "../context/policy";
import type { SourceEnv } from "../context/source";
import type { RunCommand } from "../run";
import { defaultSettings, type Settings } from "../settings/settings";
import { useTempDirs } from "../test-support";
import { connectorAccess } from "./access";
import {
	type ConnectionLoaders,
	clineConnectionLoaders,
	parseChannels,
	parseComposio,
	readClineConnections,
} from "./cline-connections";
import { COMPOSIO_READ_UNAVAILABLE } from "./composio";
import { GhReader, githubRepository, normalizeCheck } from "./github/gh";
import {
	defaultCiLine,
	GitHubConnector,
	githubRoutes,
	prLine,
	reviewLine,
} from "./github/github";
import { Connectors } from "./index";
import { Refresher } from "./refresher";
import { type McpRunnerDeps, mcpRunner } from "./runners";

const tempDir = useTempDirs("next-turn-connectors-");

type Call = { file: string; args: readonly string[] };

function fakeRun(
	handler: (call: Call) => string,
): RunCommand & { calls: Call[] } {
	const calls: Call[] = [];
	const run: RunCommand = async (file, args) => {
		const call = { file, args };
		calls.push(call);
		return handler(call);
	};
	return Object.assign(run, { calls });
}

function failure(code: number | string, stderr = ""): Error {
	return Object.assign(new Error("failed"), { code, stderr });
}

const repoEnv: SourceEnv = {
	client: "cline-desktop",
	providerId: "anthropic",
	workspaceRoot: "/repo",
	git: { branch: "fix/405", remotes: ["git@github.com:cline/router.git"] },
	tools: ["read_file"],
};

const PR_LIST = JSON.stringify([
	{
		number: 7,
		state: "CLOSED",
		headRepositoryOwner: { login: "cline" },
		headRepository: { name: "router" },
	},
	{
		number: 9,
		state: "OPEN",
		headRepositoryOwner: { login: "fork" },
		headRepository: { name: "router" },
	},
	{
		number: 12,
		state: "OPEN",
		headRepositoryOwner: { login: "Cline" },
		headRepository: { name: "router" },
	},
]);
const PR_VIEW = JSON.stringify({
	number: 12,
	title: "Return 405 for wrong methods",
	url: "https://github.com/cline/router/pull/12",
	state: "OPEN",
	isDraft: false,
	mergeable: "MERGEABLE",
	statusCheckRollup: [
		{
			__typename: "CheckRun",
			name: "lint",
			status: "COMPLETED",
			conclusion: "FAILURE",
		},
		{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS" },
		{ __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
	],
});
const THREADS = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: [
						{
							isResolved: false,
							isOutdated: false,
							path: "src/routes.ts",
							comments: {
								nodes: [
									{ author: { login: "ana" }, body: "PRIVATE REVIEW TEXT" },
								],
							},
						},
						{
							isResolved: true,
							isOutdated: false,
							path: "src/old.ts",
							comments: { nodes: [{ author: { login: "bo" } }] },
						},
						{
							isResolved: false,
							isOutdated: true,
							path: "src/stale.ts",
							comments: { nodes: [{ author: { login: "cy" } }] },
						},
					],
				},
			},
		},
	},
});

function ghHandler({ args }: Call): string {
	const joined = args.join(" ");
	if (joined.startsWith("auth status")) return "";
	if (joined.startsWith("pr list")) return PR_LIST;
	if (joined.startsWith("pr view")) return PR_VIEW;
	if (joined.startsWith("api graphql")) return THREADS;
	if (joined.startsWith("repo view"))
		return JSON.stringify({ defaultBranchRef: { name: "main" } });
	if (joined.startsWith("run list")) {
		return JSON.stringify([
			{ workflowName: "CI", status: "completed", conclusion: "failure" },
			{ workflowName: "CI", status: "completed", conclusion: "success" },
			{ workflowName: "Docs", status: "in_progress" },
			{ workflowName: "Lint", status: "completed", conclusion: "success" },
		]);
	}
	throw new Error(`unexpected gh ${joined}`);
}

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

describe("the person's Cline connections", () => {
	test("the Composio state is read through the resolver the host's core exports, under either of its names", async () => {
		const statePath = join(tempDir(), "composio.json");
		const state = { toolkits: { linear: { connectedAccountId: "ca_1" } } };
		writeFileSync(statePath, JSON.stringify(state));
		const hostCore = (resolvers: Record<string, () => string>) => async () =>
			({
				ProviderSettingsManager: class {
					getProviderSettings() {
						return { auth: { accountId: "acct_1" } };
					}
				},
				...resolvers,
			}) as never;
		for (const name of [
			"resolveComposioConnectionStatePath",
			"resolveComposioToolsStatePath",
		]) {
			const loaders = clineConnectionLoaders(
				undefined,
				hostCore({ [name]: () => statePath }),
			);
			expect(await loaders.composio()).toEqual(state);
		}
		expect(
			await clineConnectionLoaders(undefined, hostCore({})).composio(),
		).toBeUndefined();
	});

	test("Composio toolkits, MCP servers and channels: names and states only", async () => {
		const connections = await readClineConnections({
			composio: async () => ({
				toolkits: {
					GitHub: { connectedAccountId: "ca_1" },
					linear: {},
				},
			}),
			mcp: async () => ({
				mcpServers: {
					github: {
						transport: {
							type: "stdio",
							command: "docker",
							args: ["run", "ghcr.io/github/github-mcp-server"],
							env: { GITHUB_TOKEN: "SECRET" },
						},
					},
					sentry: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.sentry.dev/mcp",
							headers: { Authorization: "SECRET" },
						},
						disabled: true,
					},
				},
			}),
			channels: async () => {
				throw new Error("no hub");
			},
		});
		expect(connections.composio).toEqual([
			{ toolkit: "github", connected: true },
			{ toolkit: "linear", connected: false },
		]);
		expect(
			connections.mcp.map((server) => [
				server.name,
				server.target,
				server.disabled,
			]),
		).toEqual([
			["github", "docker run ghcr.io/github/github-mcp-server", false],
			["sentry", "mcp.sentry.dev/mcp", true],
		]);
		expect(connections.channels).toEqual([]);
		expect(JSON.stringify(connections)).not.toContain("SECRET");
		expect(
			parseChannels({
				configured: [
					{ id: "a", type: "slack" },
					{ id: "b", type: "slack" },
					{ id: "c", type: "telegram" },
				],
			}),
		).toEqual(["slack", "telegram"]);
		expect(parseComposio(null)).toEqual([]);
	});

	test("GitHub's routes: gh reads; Composio and MCP mention, each saying why it cannot read yet", () => {
		const routes = githubRoutes(true, {
			composio: [{ toolkit: "github", connected: true }],
			mcp: [
				{
					name: "gh-server",
					transport: "stdio",
					disabled: false,
					target: "github-mcp-server",
				},
			],
			channels: [],
		});
		expect(routes.map((route) => [route.id, route.read === true])).toEqual([
			["gh", true],
			["composio", false],
			["mcp:gh-server", false],
		]);
		expect(routes[1]?.read).toEqual({ reason: COMPOSIO_READ_UNAVAILABLE });
	});
});

function settingsWith(
	role: "off" | "mention" | "read",
	scopes: string[] = [],
): Settings {
	const settings = defaultSettings();
	settings.connectors.github = { role, scopes };
	return settings;
}

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

describe("access and the provider rule", () => {
	test("Mention by default once detected, Off when not; Read needs scopes and the chat's own provider", () => {
		expect(
			connectorAccess(defaultSettings(), "github", true, "anthropic"),
		).toEqual({ role: "mention", scopes: [], readAllowed: false });
		expect(
			connectorAccess(
				settingsWith("read", ["pr"]),
				"github",
				false,
				"anthropic",
			).role,
		).toBe("off");
		expect(
			connectorAccess(settingsWith("read", []), "github", true, "anthropic")
				.readAllowed,
		).toBe(false);
		expect(
			connectorAccess(settingsWith("read", ["pr"]), "github", true, "anthropic")
				.readAllowed,
		).toBe(true);
		const otherModel = settingsWith("read", ["pr"]);
		otherModel.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(connectorAccess(otherModel, "github", true, "anthropic")).toEqual({
			role: "read",
			scopes: ["pr"],
			readAllowed: false,
		});
		const chosen = defaultSettings();
		chosen.connectors["composio:gmail"] = { role: "mention", scopes: [] };
		expect(
			connectorAccess(defaultSettings(), "composio:gmail", true, "anthropic")
				.role,
		).toBe("off");
		expect(
			connectorAccess(chosen, "composio:gmail", true, "anthropic").role,
		).toBe("mention");
		expect(
			sourceOff(
				settingsWith("off"),
				{},
			)({ id: "github", tier: "T3", probe: () => "present" }),
		).toBe(true);
	});
});

describe("the refresher", () => {
	function stub(refreshed: string[], gate?: Promise<void>) {
		return {
			id: "github",
			tier: "T3" as const,
			scopes: [
				{ id: "pr", label: "PR", everyMinutes: 5, onPush: true },
				{ id: "ci", label: "CI", everyMinutes: 15 },
			],
			probe: () => "present" as const,
			refresh: async (scope: string) => {
				refreshed.push(scope);
				await gate;
			},
		};
	}

	test("start and a branch change refresh every chosen scope; a push only the push-sensitive ones; never two at once", async () => {
		const refreshed: string[] = [];
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let env = repoEnv;
		const refresher = new Refresher({
			connectors: () => [stub(refreshed, gate)],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => env,
			startTicking: () => () => undefined,
		});
		const started = refresher.start();
		await refresher.onTurn({ pushed: true });
		expect(refreshed).toEqual(["pr", "ci"]);
		release();
		await started;
		await refresher.onTurn({ pushed: true });
		await refresher.onTurn({ pushed: false });
		expect(refreshed).toEqual(["pr", "ci", "pr"]);
		env = { ...repoEnv, git: { branch: "next", remotes: [] } };
		await refresher.onTurn();
		await refresher.onTurn();
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr", "ci"]);
		refresher.stop();
	});

	test("the tick refreshes each scope on its own cadence, and only scopes the person chose", async () => {
		const refreshed: string[] = [];
		const github = stub(refreshed);
		let now = 0;
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [github],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => repoEnv,
			now: () => now,
			startTicking: (run) => {
				tick = run;
				return () => undefined;
			},
		});
		await refresher.start();
		const at = async (minutes: number) => {
			now = minutes * 60_000;
			tick();
			await Bun.sleep(0);
		};
		await at(4);
		await at(5);
		await at(15);
		expect(refreshed).toEqual(["pr", "ci", "pr", "pr", "ci"]);
		const off = new Refresher({
			connectors: () => [stub(refreshed)],
			access: () => ({ role: "mention", scopes: ["pr"], readAllowed: false }),
			env: () => repoEnv,
			startTicking: () => () => undefined,
		});
		await off.start();
		expect(refreshed).toHaveLength(5);
	});

	test("a connector found again after it was removed reads at the next tick, without waiting out its cadence", async () => {
		const refreshed: string[] = [];
		let connector = stub(refreshed);
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [connector],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => repoEnv,
			now: () => 0,
			startTicking: (run) => {
				tick = run;
				return () => undefined;
			},
		});
		await refresher.start();
		tick();
		await Bun.sleep(0);
		expect(refreshed).toEqual(["pr", "ci"]);
		connector = stub(refreshed);
		tick();
		await Bun.sleep(0);
		expect(refreshed).toEqual(["pr", "ci", "pr", "ci"]);
	});
});

describe("a pinned read on an MCP server", () => {
	test("a connection that comes up after the read gave up on it is closed", async () => {
		let finishConnecting: () => void = () => undefined;
		let open = false;
		const resolveRunner = mcpRunner(
			"linear",
			{
				registration: async (name) => ({
					name,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				}),
				client: async () => ({
					connect: () =>
						new Promise<void>((resolve) => {
							finishConnecting = () => {
								open = true;
								resolve();
							};
						}),
					disconnect: async () => {
						open = false;
					},
					callTool: async () => ({ content: [] }),
				}),
			},
			10,
		);
		const run = await resolveRunner();
		if (typeof run !== "function") throw new Error(run.reason);
		await expect(run("list_my_issues", {})).rejects.toThrow(
			'connecting to "linear" took longer than 10 ms',
		);
		finishConnecting();
		await Bun.sleep(0);
		expect(open).toBe(false);
	});
});

function connectorsWith(options: {
	settings: Settings;
	loaders: Partial<ConnectionLoaders>;
	gh?: GhReader;
	mcp?: McpRunnerDeps;
}): Connectors {
	return new Connectors({
		loaders: {
			composio: async () => undefined,
			mcp: async () => ({ mcpServers: {} }),
			channels: async () => undefined,
			...options.loaders,
		},
		gh: options.gh ?? new GhReader(fakeRun(ghHandler)),
		mcp: options.mcp ?? {
			registration: async () => undefined,
			client: async () => Promise.reject(new Error("unused")),
		},
		settings: () => options.settings,
		env: () => repoEnv,
	});
}

describe("Connected to Next Turn", () => {
	test("rows for GitHub, each Composio toolkit and each channel, with reasons on what is disabled", async () => {
		const settings = settingsWith("mention");
		const connectors = connectorsWith({
			settings,
			loaders: {
				composio: async () => ({
					toolkits: {
						github: { connectedAccountId: "ca" },
						linear: { connectedAccountId: "cb" },
						gmail: { connectedAccountId: "cc" },
					},
				}),
				channels: async () => ({ configured: [{ id: "c", type: "slack" }] }),
			},
		});
		await connectors.detect();
		expect(connectors.all().map((entry) => entry.id)).toEqual([
			"github",
			"composio:gmail",
			"composio:linear",
		]);
		expect(connectors.access("composio:linear").role).toBe("mention");
		expect(connectors.access("composio:gmail").role).toBe("off");
		const rows = connectors.rows();
		expect(rows.map((row) => [row.id, row.group, row.role])).toEqual([
			["github", "GitHub", "mention"],
			["composio:gmail", "Composio", "off"],
			["composio:linear", "Composio", "mention"],
			["menubar", "Chat channels", "notify"],
			["channel:slack", "Chat channels", "off"],
		]);
		expect(rows[0]?.scopes.map((scope) => scope.cadence)).toEqual([
			"on push · every 5 min",
			"every 5 min",
			"every 15 min",
		]);
		const github = rows[0];
		expect(github?.status).toBe(
			"gh, signed in (the sign-in Cline's PR bar uses) · Composio, through your Cline account",
		);
		expect(github?.roles.find((option) => option.role === "read")).toEqual({
			role: "read",
			enabled: true,
		});
		expect(
			github?.roles.find((option) => option.role === "notify")?.enabled,
		).toBe(false);
		expect(
			rows[2]?.roles.find((option) => option.role === "read")?.reason,
		).toBe(COMPOSIO_READ_UNAVAILABLE);
		expect(
			rows[4]?.roles.find((option) => option.role === "notify")?.reason,
		).toBe(
			"Needs-you notifications reach the menubar today; this channel cannot receive them yet",
		);
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(
			connectors.rows()[0]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe(
			"Facts go to the same model as your chat. Choosing another model for suggestions turns Read off.",
		);
	});

	test("MCP servers get rows; Read opens once a pin exists; the refresher runs pinned reads", async () => {
		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		settings.connectors["composio:notion"] = { role: "mention", scopes: [] };
		const ran: string[] = [];
		const connectors = connectorsWith({
			settings,
			loaders: {
				composio: async () => ({
					toolkits: { notion: { connectedAccountId: "x" } },
				}),
				mcp: async () => ({
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
						},
						sentry: {
							transport: {
								type: "stdio",
								command: "npx",
								args: ["sentry-mcp"],
							},
						},
						off: { transport: { type: "stdio", command: "x" }, disabled: true },
					},
				}),
			},
			gh: new GhReader(
				fakeRun(() => {
					throw failure("ENOENT");
				}),
			),
			mcp: {
				registration: async (name) => ({
					name,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				}),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async ({ name }) => {
						ran.push(name);
						return { content: [{ type: "text", text: "[]" }] };
					},
				}),
			},
		});
		await connectors.detect();
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
			"composio:notion",
			"mcp:linear",
			"mcp:sentry",
		]);
		const byId = Object.fromEntries(
			connectors.rows().map((row) => [row.id, row]),
		);
		expect(byId["mcp:linear"]?.status).toBe("In Cline's MCP settings · HTTP");
		expect(
			byId["mcp:linear"]?.roles.find((option) => option.role === "read"),
		).toEqual({ role: "read", enabled: true });
		expect(byId["mcp:linear"]?.scopes).toEqual([
			{
				id: "mine",
				label: "list_my_issues",
				everyMinutes: 15,
				checked: true,
				cadence: "every 15 min",
			},
		]);
		expect(byId["mcp:sentry"]?.status).toBe(
			"In Cline's MCP settings · stdio; each read starts the server",
		);
		expect(
			byId["mcp:sentry"]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe("Pin a read-only tool, with its arguments, to read through it");
		expect(byId["mcp:off"]?.detected).toBe(false);
		expect(
			byId["composio:notion"]?.roles.find((option) => option.role === "read")
				?.reason,
		).toBe(COMPOSIO_READ_UNAVAILABLE);
		await connectors.refresher.start();
		connectors.refresher.stop();
		expect(ran).toEqual(["list_my_issues"]);
	});

	test("after a turn, connections added or removed during the chat count, and a kept one keeps its facts", async () => {
		const settings = defaultSettings();
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		const linear = {
			transport: {
				type: "streamableHttp" as const,
				url: "https://mcp.linear.app/mcp",
			},
		};
		let servers: Record<string, Omit<McpServerRegistration, "name">> = {
			linear,
			sentry: { transport: { type: "stdio", command: "npx" } },
		};
		let now = 0;
		let signedIn = false;
		const connectors = connectorsWith({
			settings,
			loaders: { mcp: async () => ({ mcpServers: servers }) },
			gh: new GhReader(
				fakeRun((call) => {
					if (!signedIn) throw failure(1);
					return ghHandler(call);
				}),
				() => now,
			),
			mcp: {
				registration: async (name) => ({ name, transport: linear.transport }),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async () => ({
						content: [{ type: "text", text: '["ENG-1"]' }],
					}),
				}),
			},
		});
		await connectors.detect();
		await connectors.refresher.start();
		connectors.refresher.stop();
		const linearFacts = () =>
			connectors
				.all()
				.find((connector) => connector.id === "mcp:linear")
				?.facts?.(repoEnv, 100);
		const read = linearFacts();
		expect(connectors.access("github").role).toBe("off");
		servers = {
			linear,
			notion: { transport: { type: "stdio", command: "x" } },
		};
		signedIn = true;
		now = 300_001;
		await connectors.onTurn({});
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
			"mcp:linear",
			"mcp:notion",
		]);
		expect(connectors.access("github").role).toBe("mention");
		expect(connectors.access("mcp:sentry").role).toBe("off");
		expect(linearFacts()).toEqual(read);
		expect(JSON.stringify(read)).toContain("ENG-1");
	});

	test("a store or gh check that fails after a turn keeps what it last found, facts included; a store that is gone has nothing", async () => {
		const settings = settingsWith("mention");
		settings.connectors["mcp:linear"] = {
			role: "read",
			scopes: ["mine"],
			reads: [{ id: "mine", tool: "list_my_issues", arguments: {} }],
		};
		const linear = {
			transport: {
				type: "streamableHttp" as const,
				url: "https://mcp.linear.app/mcp",
			},
		};
		let storeError: Error | undefined;
		let ghFails = false;
		let now = 0;
		const reads: string[] = [];
		const connectors = connectorsWith({
			settings,
			loaders: {
				mcp: async () => {
					if (storeError) throw storeError;
					return { mcpServers: { linear } };
				},
				channels: async () => {
					if (storeError) throw storeError;
					return { configured: [{ id: "c", type: "slack" }] };
				},
			},
			gh: new GhReader(
				fakeRun((call) => {
					if (ghFails) throw failure("ETIMEDOUT");
					return ghHandler(call);
				}),
				() => now,
			),
			mcp: {
				registration: async (name) => ({ name, transport: linear.transport }),
				client: async () => ({
					connect: async () => undefined,
					disconnect: async () => undefined,
					callTool: async ({ name }) => {
						reads.push(name);
						return { content: [{ type: "text", text: '["ENG-1"]' }] };
					},
				}),
			},
		});
		const linearFacts = () =>
			connectors
				.all()
				.find((connector) => connector.id === "mcp:linear")
				?.facts?.(repoEnv, 100);
		await connectors.detect();
		await connectors.refresher.start();
		connectors.refresher.stop();
		const read = linearFacts();
		expect(JSON.stringify(read)).toContain("ENG-1");

		storeError = new Error('Failed to parse MCP settings JSON at "mcp.json"');
		ghFails = true;
		now = 300_001;
		await connectors.onTurn({});
		expect(connectors.access("mcp:linear").readAllowed).toBe(true);
		expect(linearFacts()).toEqual(read);
		expect(connectors.access("github").role).toBe("mention");
		expect(connectors.rows().map((row) => row.id)).toContain("channel:slack");

		storeError = Object.assign(new Error("no such file"), { code: "ENOENT" });
		await connectors.onTurn({});
		expect(connectors.all().map((connector) => connector.id)).toEqual([
			"github",
		]);
		expect(connectors.access("mcp:linear").role).toBe("off");
		expect(reads).toEqual(["list_my_issues"]);
	});
});
