import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyFold, foldEvents } from "../../hub/fold";
import type { HubEvent, HubLinkStatus } from "../../hub/link";
import { modelChoices } from "../../settings/models";
import { defaultSettings } from "../../settings/settings";
import { buildManifest, collectFacts } from "../manifest";
import { sourceOff } from "../policy";
import { clip, redactSecrets } from "../redact";
import type { ContextSource, SourceEnv } from "../source";
import { ClineSetupSource, parseSetup } from "./cline-setup";
import { ageLabel, historySource, rankHistory, searchTerms } from "./history";
import {
	documentedCommands,
	makeTargets,
	RepoReader,
	readConventions,
	repoSource,
	verifyScripts,
} from "./repo";
import { dirtyFileCounter, parseGitStatusV2 } from "./workspace";

const temps: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "next-turn-sources-"));
	temps.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

/** Golden redaction outputs, frozen in `test-fixtures/redaction.json`. */
const redactionFixture = JSON.parse(
	readFileSync(
		new URL("../../../test-fixtures/redaction.json", import.meta.url),
		"utf8",
	),
) as {
	cases: { sample: string; expected: string }[];
};

const env: SourceEnv = {
	client: "cline-desktop",
	sessionId: "me",
	workspaceRoot: "/repo",
	tools: [],
};

describe("redaction", () => {
	test("matches the frozen redaction outputs", () => {
		for (const fixture of redactionFixture.cases)
			expect(redactSecrets(fixture.sample)).toBe(fixture.expected);
	});

	test("clip redacts, collapses whitespace and bounds the length", () => {
		expect(clip("a  sk-abcdefghijklmnopqrstuv\n b", 80)).toBe("a [redacted] b");
		expect(clip("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
	});
});

describe("history", () => {
	test("search terms: edited files' names first, then the request's most repeated words, without stopwords", () => {
		expect(
			searchTerms({
				editedPaths: ["src/routes/users.ts", "src/routes/users.test.ts"],
				request:
					"Return 405 for wrong methods on users; methods should be listed",
			}),
		).toEqual(["users", "methods", "listed", "return"]);
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
	});

	test("facts carry title, age, state and a redacted snippet; never more", async () => {
		const fold = foldEvents(emptyFold(), [
			{ event: "run.started", sequence: 1, sessionId: "old" },
			{ event: "run.failed", sequence: 2, sessionId: "old" },
		]);
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
			mcp: [{ name: "sentry", enabled: true }],
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

	test("names only, enabled and loadable, as capability tags", () => {
		const inventory = parseSetup(reply);
		expect(inventory).toEqual({
			workflows: ["/release-notes"],
			skills: ["clickhouse"],
			mcp: ["sentry"],
			pluginCommands: ["/goal", "/plan"],
		});
		expect(JSON.stringify(inventory)).not.toContain("PRIVATE");
	});

	test("reads on connect and on settings.changed; the probe answers from cache", async () => {
		const statusListeners = new Set<(status: HubLinkStatus) => void>();
		const eventListeners = new Set<(event: HubEvent) => void>();
		let reads = 0;
		const link = {
			availability: () => "present" as const,
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
		for (const listener of statusListeners) listener("up");
		await Bun.sleep(0);
		expect(source.probe()).toBe("present");
		expect(source.capabilities()).toContain("workflow:/release-notes");
		for (const listener of eventListeners)
			listener({ event: "settings.changed" });
		await Bun.sleep(0);
		expect(reads).toBe(2);
		source.stop();
		expect(statusListeners.size + eventListeners.size).toBe(0);
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

	test("absent with no workspace or none of its files", async () => {
		const source = repoSource();
		expect(source.probe({ tools: [] })).toBe("absent");
		expect(source.probe({ tools: [], workspaceRoot: tempDir() })).toBe(
			"absent",
		);
	});

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
		const count = await dirtyFileCounter(
			async () => output,
			(snap) => {
				seen = snap;
			},
		)("/repo");
		expect(count).toBe(2);
		expect(seen).toEqual({
			branch: "feat/slot-api",
			commit: "0123456789abcdef",
			dirtyFiles: 2,
		});
	});
});

describe("the M3 manifest and facts", () => {
	const hubFake = (state: "present" | "absent"): ContextSource => ({
		id: "history",
		tier: "T2",
		probe: () => state,
		facts: () => ({ heading: "h", lines: ["x"] }),
	});

	test("off and absent sources give no facts; a slow one reads unknown", async () => {
		const slow: ContextSource = {
			id: "slow",
			tier: "T2",
			probe: () => "present",
			facts: () =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ heading: "late", lines: [] }), 50),
				),
		};
		const absent: ContextSource = { ...hubFake("absent"), id: "tasks" };
		const sources = [hubFake("present"), absent, slow];
		const manifest = await buildManifest(sources, env, {
			isOff: (id) => id === "history",
		});
		expect(manifest.sources).toEqual({
			history: "off",
			tasks: "absent",
			slow: "present",
		});
		expect(
			await collectFacts(sources, manifest, env, { budgetMs: () => 5 }),
		).toEqual({ slow: "unknown" });
	});

	test("history is off when the planner would send it to another provider, or when the person turned it off", () => {
		const settings = defaultSettings();
		expect(sourceOff(settings, { providerId: "anthropic" })("history")).toBe(
			false,
		);
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(sourceOff(settings, { providerId: "anthropic" })("history")).toBe(
			true,
		);
		expect(sourceOff(settings, { providerId: "openai" })("history")).toBe(
			false,
		);
		settings.context.clineSetup = false;
		expect(sourceOff(settings, {})("cline-setup")).toBe(true);
		expect(sourceOff(settings, {})("git")).toBe(false);
	});
});

describe("model choices", () => {
	test("provider and model ids only, last used first; keys never leave", () => {
		const stored = {
			version: 1,
			lastUsedProvider: "openai",
			providers: {
				anthropic: {
					settings: {
						provider: "anthropic",
						model: "claude-sonnet",
						apiKey: "SECRET",
					},
				},
				openai: {
					settings: { provider: "openai", auth: { accessToken: "SECRET" } },
				},
			},
		};
		const choices = modelChoices(stored);
		expect(choices).toEqual([
			{ providerId: "openai", modelId: undefined, lastUsed: true },
			{ providerId: "anthropic", modelId: "claude-sonnet", lastUsed: false },
		]);
		expect(JSON.stringify(choices)).not.toContain("SECRET");
		expect(modelChoices(null)).toEqual([]);
	});
});
