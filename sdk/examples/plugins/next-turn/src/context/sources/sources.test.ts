import { describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyFold, foldEvent } from "../../hub/fold";
import type { HubEvent, HubLinkStatus } from "../../hub/link";
import { useTempDirs } from "../../test-support";
import { ageLabel } from "../facts";
import { redactSecrets } from "../redact";
import type { Facts, SourceEnv } from "../source";
import { ClineSetupSource, parseSetup } from "./cline-setup";
import { historySource, rankHistory, searchTerms } from "./history";
import {
	documentedCommands,
	makeTargets,
	RepoReader,
	readConventions,
	repoSource,
	verifyScripts,
} from "./repo";
import { dirtyFileCounter, parseGitStatusV2 } from "./workspace";

const tempDir = useTempDirs("next-turn-sources-");

const env: SourceEnv = {
	client: "cline-desktop",
	sessionId: "me",
	workspaceRoot: "/repo",
	tools: [],
};

describe("history", () => {
	test("search terms: edited files' names first, then the request's most repeated words, without stopwords", () => {
		expect(
			searchTerms({
				editedPaths: ["src/routes/users.ts", "src/routes/users.test.ts"],
				request:
					"Return 405 for wrong methods on users; methods should be listed",
			}),
		).toEqual(["users", "methods", "listed", "return"]);
		expect(
			searchTerms({
				editedPaths: [],
				request: redactSecrets(
					"Rotate the deploy key: api_key=AAAAAAAAAAAA and token=BBBBBBBBBBBB then rerun the deploy pipeline migration",
				),
			}),
		).toEqual(["deploy", "api_key", "migration", "pipeline"]);
		expect(searchTerms(undefined)).toEqual([]);
	});

	test("ranks related chats by terms matched, this workspace only, never this chat", () => {
		const listed = {
			sessions: [
				{
					sessionId: "old",
					workspaceRoot: "/repo",
					updatedAt: 1,
					metadata: { title: "Upgrade the test runner" },
				},
				{ sessionId: "other-repo", workspaceRoot: "/elsewhere", updatedAt: 9 },
				{ sessionId: "me", workspaceRoot: "/repo", updatedAt: 10 },
			],
		};
		const hit = (sessionId: string, workspaceRoot = "/repo") => ({
			sessionId,
			workspaceRoot,
			title: sessionId,
			snippet: "the [lockfile] decision",
			startedAt: "2026-10-01T00:00:00.000Z",
		});
		const ranked = rankHistory(
			listed,
			[
				{ hits: [hit("old"), hit("fresh"), hit("me")] },
				{ hits: [hit("old"), hit("other-repo", "/elsewhere")] },
			],
			env,
		);
		expect(ranked.map((entry) => [entry.sessionId, entry.matches])).toEqual([
			["old", 2],
			["fresh", 1],
		]);
		expect(ranked[0]?.title).toBe("Upgrade the test runner");
	});

	test("with nothing to search, the most recent chats stand in", () => {
		const listed = {
			sessions: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
				sessionId: `s${n}`,
				workspaceRoot: "/repo",
				updatedAt: n,
			})),
		};
		expect(
			rankHistory(listed, [], env).map((entry) => entry.sessionId),
		).toEqual(["s7", "s6", "s5", "s4", "s3"]);
		expect(
			rankHistory(listed, [undefined, undefined], env).map(
				(entry) => entry.sessionId,
			),
		).toEqual(["s7", "s6", "s5", "s4", "s3"]);
	});

	test("when every search fails, the recent chats stand in under their own heading", async () => {
		const link = {
			availability: () => "present" as const,
			async command(name: string) {
				if (name !== "session.list") throw new Error("search failed");
				return {
					sessions: [
						{
							sessionId: "old",
							workspaceRoot: "/repo",
							updatedAt: 0,
							metadata: { title: "Ship it" },
						},
					],
				};
			},
		};
		const facts = await historySource(
			link,
			emptyFold,
			() => 3 * 3_600_000,
		).facts?.({ ...env, turn: { editedPaths: ["deploy.ts"] } }, 100);
		expect(facts).toEqual({
			heading: "Recent chats in this workspace",
			lines: ['"Ship it" · 3h ago · idle'],
		});
	});

	test("facts carry title, age, state and a redacted snippet; never more", async () => {
		const fold = (
			[
				{ event: "run.started", sequence: 1, sessionId: "old" },
				{ event: "run.failed", sequence: 2, sessionId: "old" },
			] satisfies HubEvent[]
		).reduce(foldEvent, emptyFold());
		const link = {
			availability: () => "present" as const,
			async command(name: string) {
				if (name === "session.list")
					return {
						sessions: [
							{
								sessionId: "old",
								workspaceRoot: "/repo",
								updatedAt: 0,
								metadata: { title: "Ship it" },
							},
						],
					};
				return {
					hits: [
						{
							sessionId: "old",
							workspaceRoot: "/repo",
							snippet: "used [sk-abcdefghijklmnopqrstuv] here",
						},
					],
				};
			},
		};
		const facts = await historySource(
			link,
			() => fold,
			() => 3 * 3_600_000,
		).facts?.({ ...env, turn: { editedPaths: ["deploy.ts"] } }, 100);
		expect(facts).toEqual({
			heading: "Related chats in this workspace",
			lines: ['"Ship it" · 3h ago · failed · "used [redacted] here"'],
		});
	});

	test("unreadable when every read fails; ages read plainly", async () => {
		const down = {
			availability: () => "unknown" as const,
			command: () => Promise.reject(new Error("down")),
		};
		expect(await historySource(down, emptyFold).facts?.(env, 100)).toBe(
			"unknown",
		);
		expect(ageLabel(undefined, 0)).toBe("age unknown");
		expect(ageLabel(0, 30_000)).toBe("just now");
		expect(ageLabel(0, 2 * 86_400_000)).toBe("2d ago");
	});
});

describe("Cline setup", () => {
	const reply = {
		snapshot: {
			workflows: [
				{
					name: "release-notes.md",
					enabled: true,
					description: "PRIVATE INSTRUCTIONS",
				},
				{ name: "off.md", enabled: false },
			],
			skills: [{ name: "clickhouse" }, { name: "broken", loadError: "bad" }],
			mcp: [
				{ name: "sentry", enabled: true },
				{ name: "linear", enabled: true, agentPlugin: true },
				{ name: "jira", enabled: false, agentPlugin: true },
			],
			plugins: [
				{
					name: "goals",
					enabled: true,
					contributions: { commands: ["goal", "/plan"] },
				},
			],
			rules: [{ name: "style" }],
		},
	};

	test("names only, enabled and loadable; only an Agent Plugin's MCP servers, since the rest are left to their connectors", () => {
		const inventory = parseSetup(reply);
		expect(inventory).toEqual({
			workflows: ["/release-notes"],
			skills: ["clickhouse"],
			mcp: ["linear"],
			pluginCommands: ["/goal", "/plan"],
		});
		expect(JSON.stringify(inventory)).not.toContain("PRIVATE");
		expect(JSON.stringify(inventory)).not.toContain("sentry");
	});

	test("a workflow named with and without its extension is listed once", () => {
		expect(
			parseSetup({
				snapshot: { workflows: [{ name: "a.md" }, { name: "a" }] },
			}).workflows,
		).toEqual(["/a"]);
	});

	test("reads on connect and on settings.changed; the probe answers from cache", async () => {
		const statusListeners = new Set<(status: HubLinkStatus) => void>();
		const eventListeners = new Set<(event: HubEvent) => void>();
		let reads = 0;
		let availability: "present" | "unknown" = "unknown";
		const link = {
			availability: () => availability,
			onStatus: (listener: (status: HubLinkStatus) => void) => {
				statusListeners.add(listener);
				return () => statusListeners.delete(listener);
			},
			subscribe: (
				_names: ReadonlySet<string>,
				listener: (event: HubEvent) => void,
			) => {
				eventListeners.add(listener);
				return () => eventListeners.delete(listener);
			},
			async command(name: string, payload?: Record<string, unknown>) {
				reads += 1;
				expect(name).toBe("settings.list");
				expect(payload).toEqual({
					workspaceRoot: "/repo",
					cwd: "/repo",
					includePluginTools: false,
				});
				return reply;
			},
		};
		const source = new ClineSetupSource(link, { workspaceRoot: "/repo" });
		expect(source.probe()).toBe("unknown");
		source.start();
		await Bun.sleep(0);
		expect(reads).toBe(0);
		availability = "present";
		for (const listener of statusListeners) listener("up");
		await Bun.sleep(0);
		expect(source.probe()).toBe("present");
		expect(source.capabilities()).toContain("workflow:/release-notes");
		expect(source.capabilities()).toContain("mcp:linear");
		expect(source.capabilities()).not.toContain("mcp:sentry");
		expect((source.facts() as Facts).lines).toEqual(
			expect.arrayContaining([
				"Workflows: /release-notes",
				"MCP servers: linear",
			]),
		);
		for (const listener of eventListeners)
			listener({ event: "settings.changed" });
		await Bun.sleep(0);
		expect(reads).toBe(2);
		source.stop();
		expect(statusListeners.size + eventListeners.size).toBe(0);
	});

	test("reads at start when the link is already up", async () => {
		let reads = 0;
		const link = {
			availability: () => "present" as const,
			onStatus: () => () => {},
			subscribe: () => () => {},
			async command() {
				reads += 1;
				return reply;
			},
		};
		const source = new ClineSetupSource(link, { workspaceRoot: "/repo" });
		source.start();
		await Bun.sleep(0);
		expect(reads).toBe(1);
		expect(source.capabilities()).toContain("skill:clickhouse");
		source.stop();
	});
});

describe("repository conventions", () => {
	test("verify-like scripts, documented commands and make targets", () => {
		expect(
			verifyScripts(
				JSON.stringify({
					scripts: {
						test: "x",
						"check:docs": "x",
						dev: "x",
						typecheck: "x",
						lintfix: "x",
					},
				}),
			),
		).toEqual(["check:docs", "test", "typecheck"]);
		const agents = [
			"# Repo",
			"## Commands",
			"```bash",
			"bun install --frozen-lockfile",
			"bun run check   # everything",
			"```",
			"### Before you push",
			"```",
			"bun run check",
			"```",
			"## Rules",
			"```",
			"rm -rf /",
			"```",
		].join("\n");
		expect(documentedCommands(agents)).toEqual([
			"bun install --frozen-lockfile",
			"bun run check",
		]);
		expect(
			documentedCommands(
				[
					"##\tCommands",
					"```",
					"bun test",
					"```",
					"##\tRules",
					"```",
					"rm -rf /",
					"```",
				].join("\n"),
			),
		).toEqual(["bun test"]);
		expect(
			makeTargets("test:\n\tgo test\nbuild: deps\nVAR := 1\nrelease:\n"),
		).toEqual(["build", "test"]);
	});

	test("reads the workspace's files, picks the runner from the lockfile, and rereads only on change", () => {
		const root = tempDir();
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { check: "x" } }),
		);
		writeFileSync(join(root, "bun.lock"), "");
		mkdirSync(join(root, ".clinerules"));
		writeFileSync(
			join(root, ".clinerules", "push.md"),
			"## Before you push\n```\nmake lint\n```\n",
		);
		const reader = new RepoReader();
		expect(readConventions(root, reader)).toEqual({
			runner: "bun",
			scripts: ["check"],
			documented: ["make lint"],
			makeTargets: [],
		});
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { test: "x" } }),
		);
		utimesSync(
			join(root, "package.json"),
			new Date(),
			new Date(Date.now() + 5000),
		);
		expect(readConventions(root, reader)?.scripts).toEqual(["test"]);
	});

	test("facts for an environment already read pick up a package.json edited since", () => {
		const root = tempDir();
		const packageJson = join(root, "package.json");
		writeFileSync(packageJson, JSON.stringify({ scripts: { check: "x" } }));
		const source = repoSource();
		const turnEnv: SourceEnv = { tools: [], workspaceRoot: root };
		expect(source.probe(turnEnv)).toBe("present");
		expect(source.facts?.(turnEnv, 0)).toEqual({
			heading: "This repository's commands",
			lines: ["Script: `npm run check`"],
		});
		writeFileSync(packageJson, JSON.stringify({ scripts: { test: "x" } }));
		utimesSync(packageJson, new Date(), new Date(Date.now() + 5000));
		expect(source.facts?.(turnEnv, 0)).toEqual({
			heading: "This repository's commands",
			lines: ["Script: `npm run test`"],
		});
	});

	test("absent with no workspace or none of its files", () => {
		const source = repoSource();
		expect(source.probe({ tools: [] })).toBe("absent");
		expect(source.probe({ tools: [], workspaceRoot: tempDir() })).toBe(
			"absent",
		);
	});
});

describe("git status", () => {
	test("git status --porcelain=v2 --branch parses branch, oid and dirty count in one call", async () => {
		const output = [
			"# branch.oid 0123456789abcdef",
			"# branch.head feat/slot-api",
			"1 .M N... 100644 100644 100644 a b src/a.ts",
			"? src/new.ts",
		].join("\n");
		expect(parseGitStatusV2(output)).toEqual({
			branch: "feat/slot-api",
			commit: "0123456789abcdef",
			dirtyFiles: 2,
		});
		let seen: unknown;
		let argv: readonly string[] = [];
		const count = await dirtyFileCounter(
			async (_file, args) => {
				argv = args;
				return output;
			},
			(snap) => {
				seen = snap;
			},
		)("/repo");
		expect(count).toBe(2);
		expect(argv).toEqual([
			"--no-optional-locks",
			"status",
			"--porcelain=v2",
			"--branch",
		]);
		expect(seen).toEqual({
			branch: "feat/slot-api",
			commit: "0123456789abcdef",
			dirtyFiles: 2,
		});
	});
});
