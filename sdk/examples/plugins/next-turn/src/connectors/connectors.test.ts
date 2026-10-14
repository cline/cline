import { describe, expect, test } from "bun:test";
import { sourceOff } from "../context/policy";
import type { SourceEnv } from "../context/source";
import { defaultSettings, type Settings } from "../settings/settings";
import { connectorAccess } from "./access";
import {
	parseChannels,
	parseComposio,
	parseMcp,
	readClineConnections,
} from "./cline-connections";
import { GhReader, githubRepository, normalizeCheck } from "./github/gh";
import {
	defaultCiLine,
	GitHubConnector,
	githubRoutes,
	prLine,
	reviewLine,
} from "./github/github";
import { Connectors } from "./index";
import { isPushCommand, Refresher } from "./refresher";
import type { RunCommand } from "./run";
import { COMPOSIO_READ_NEEDS_U4, composioRunner } from "./runners";

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

	test("an expired sign-in mid-read reads as nothing and marks gh unavailable", async () => {
		const gh = new GhReader(
			fakeRun(({ args }) => {
				if (args[0] === "auth") return "";
				throw failure(1, "HTTP 401: Bad credentials");
			}),
		);
		expect(await gh.isAvailable("/repo")).toBe(true);
		expect(await gh.pullRequest("cline/router", "fix/405", "/repo")).toBeNull();
		expect(await gh.isAvailable("/repo")).toBe(false);
		expect(gh.status()).toBe("signed-out");
	});

	test("falls back to Homebrew gh when PATH lacks it, and reports not-found when absent everywhere", async () => {
		const fallbackRun = fakeRun(({ file }) => {
			if (file === "gh") throw failure("ENOENT");
			if (file === "/opt/homebrew/bin/gh") return "";
			throw failure("ENOENT");
		});
		const gh = new GhReader(fallbackRun);
		expect(await gh.isAvailable("/repo")).toBe(true);
		expect(gh.status()).toBe("signed-in");

		const missing = new GhReader(
			fakeRun(() => {
				throw failure("ENOENT");
			}),
		);
		expect(await missing.isAvailable("/repo")).toBe(false);
		expect(missing.status()).toBe("not-found");
	});
});

describe("the person's Cline connections", () => {
	test("Composio toolkits, MCP servers and channels: names and states only", async () => {
		const connections = await readClineConnections({
			composio: async () => ({
				toolkits: {
					GitHub: {
						connectedAccountId: "ca_1",
						tools: [{ slug: "GITHUB_LIST" }],
					},
					linear: { tools: [] },
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
					broken: { transport: { type: "carrier-pigeon" } },
				},
			}),
			channels: async () => {
				throw new Error("no hub");
			},
		});
		expect(connections.composio).toEqual([
			{ toolkit: "github", connected: true, tools: 1 },
			{ toolkit: "linear", connected: false, tools: 0 },
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
		expect(parseMcp("nope")).toEqual([]);
	});

	test("GitHub's routes: gh reads; Composio and MCP mention, each saying why it cannot read yet", () => {
		const routes = githubRoutes(true, {
			composio: [{ toolkit: "github", connected: true, tools: 3 }],
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
		expect(routes[1]?.read).toEqual({
			reason:
				"Reading through Composio needs Cline to export its connector tool runner (upstream ask U4)",
		});
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

function connector(
	settings: () => Settings,
	run = fakeRun(ghHandler),
	now = () => 600_000,
) {
	const github = new GitHubConnector({
		gh: new GhReader(run, now),
		connections: async () => ({ composio: [], mcp: [], channels: [] }),
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
		await github.detect(repoEnv);
		expect(github.probe(repoEnv)).toBe("present");
		expect(github.capabilities(repoEnv)).toEqual(["github", "github:gh"]);
		expect(
			github.capabilities({ ...repoEnv, tools: ["GITHUB_LIST_PULL_REQUESTS"] }),
		).toEqual(["github", "github:gh", "github:agent-tools"]);
	});

	test("Mention reads nothing from GitHub and says which connection the agent can use", async () => {
		const { github, run } = connector(() => settingsWith("mention"));
		await github.detect(repoEnv);
		await github.refresh("pr", repoEnv);
		expect(run.calls.map((call) => call.args[0])).toEqual(["auth"]);
		expect(github.facts(repoEnv)).toMatchObject({
			heading: "GitHub (connected; no data read)",
			provenance: { connector: "github", route: "gh" },
		});
	});

	test("Read: the chosen scopes, bounded and dated, with the PR as the source link", async () => {
		let now = 600_000;
		const { github } = connector(
			() => settingsWith("read", ["pr", "reviews"]),
			fakeRun(ghHandler),
			() => now,
		);
		await github.detect(repoEnv);
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
			fetchedAt: 600_000,
			provenance: {
				connector: "github",
				route: "gh",
				url: "https://github.com/cline/router/pull/12",
			},
		});
	});

	test("a branch change makes the old facts unknown until the next refresh", async () => {
		const { github } = connector(() => settingsWith("read", ["pr"]));
		await github.detect(repoEnv);
		await github.refresh("pr", repoEnv);
		expect(
			github.facts({
				...repoEnv,
				git: { branch: "other", remotes: repoEnv.git?.remotes ?? [] },
			}),
		).toBe("unknown");
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
		expect(sourceOff(settingsWith("off"), {})("github")).toBe(true);
	});
});

describe("the refresher", () => {
	function stub(refreshed: string[], gate?: Promise<void>) {
		return {
			id: "github",
			kind: "github" as const,
			tier: "T3" as const,
			scopes: [
				{ id: "pr", label: "PR", everyMinutes: 5, onPush: true },
				{ id: "ci", label: "CI", everyMinutes: 15 },
			],
			probe: () => "present" as const,
			detect: async () => ({ routes: [], detectedAt: 0 }),
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
			tickMs: 60_000,
			setTimer: () => 1,
			clearTimer: () => undefined,
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
		let now = 0;
		let tick: () => void = () => undefined;
		const refresher = new Refresher({
			connectors: () => [stub(refreshed)],
			access: () => ({ role: "read", scopes: ["pr", "ci"], readAllowed: true }),
			env: () => repoEnv,
			tickMs: 60_000,
			now: () => now,
			setTimer: (run) => {
				tick = run;
				return 1;
			},
			clearTimer: () => undefined,
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
			tickMs: 60_000,
			setTimer: () => 1,
		});
		await off.start();
		expect(refreshed).toHaveLength(5);
	});

	test("push detection", () => {
		expect(isPushCommand("git push -u origin HEAD")).toBe(true);
		expect(isPushCommand({ commands: ["gh pr create --fill"] })).toBe(true);
		expect(isPushCommand("git pushd")).toBe(false);
		expect(isPushCommand(undefined)).toBe(false);
	});
});

describe("Connected to Next Turn", () => {
	test("rows for GitHub, each Composio toolkit and each channel, with reasons on what is disabled", async () => {
		const settings = settingsWith("mention");
		const connectors = new Connectors({
			loaders: {
				composio: async () => ({
					toolkits: {
						github: { connectedAccountId: "ca" },
						linear: { connectedAccountId: "cb" },
						gmail: { connectedAccountId: "cc" },
					},
				}),
				mcp: async () => ({ mcpServers: {} }),
				channels: async () => ({ configured: [{ id: "c", type: "slack" }] }),
			},
			gh: new GhReader(fakeRun(ghHandler)),
			composio: composioRunner(async () => ({})),
			mcp: {
				registration: async () => undefined,
				client: async () => Promise.reject(new Error("unused")),
			},
			settings: () => settings,
			env: () => repoEnv,
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
		).toBe(COMPOSIO_READ_NEEDS_U4);
		expect(
			rows[4]?.roles.find((option) => option.role === "notify")?.reason,
		).toContain("U5");
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
});
