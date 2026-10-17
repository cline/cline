import { describe, expect, test } from "bun:test";
import { buildManifest, collectFacts, manifestTags } from "./manifest";
import type { ContextSource, SourceEnv } from "./source";
import { hubBackedSource } from "./sources/hub";
import { gitSource, remoteTags, turnSource } from "./sources/workspace";

const repo: SourceEnv = {
	client: "cline-desktop",
	workspaceRoot: "/repo",
	git: {
		branch: "fix/404",
		commit: "abc",
		remotes: ["git@github.com:cline/router.git"],
	},
	tools: ["read_file", "github_list_pull_requests"],
	mode: "act",
};

const bare: SourceEnv = { client: "cline-cli", tools: [] };

describe("environment manifest", () => {
	test("a git repository on GitHub: turn and git present, the remote as a capability", async () => {
		const manifest = await buildManifest([turnSource, gitSource], repo);
		expect(manifest.sources).toEqual({ turn: "present", git: "present" });
		expect(manifest.capabilities).toEqual(["remote:github"]);
	});

	test("a folder that is not a repository: git is absent and never named", async () => {
		const manifest = await buildManifest([turnSource, gitSource], bare);
		expect(manifest.sources.git).toBe("absent");
		expect(manifest.capabilities).toEqual([]);
	});

	test("a source the person turned off is recorded as off and never probed", async () => {
		let probed = false;
		const history: ContextSource = {
			id: "history",
			tier: "T2",
			probe: () => {
				probed = true;
				return "present";
			},
		};
		const manifest = await buildManifest([history], repo, {
			isOff: (source) => source.id === "history",
		});
		expect(manifest.sources.history).toBe("off");
		expect(probed).toBe(false);
	});

	test("a slow or throwing probe reads as unknown, and only present sources add capabilities", async () => {
		const slow: ContextSource = {
			id: "slow",
			tier: "T2",
			probe: () =>
				new Promise((resolve) => setTimeout(() => resolve("present"), 50)),
			capabilities: () => ["never"],
		};
		const broken: ContextSource = {
			id: "broken",
			tier: "T1",
			probe: () => {
				throw new Error("no");
			},
		};
		const manifest = await buildManifest([slow, broken], repo, {
			budgetMs: () => 5,
		});
		expect(manifest.sources).toEqual({ slow: "unknown", broken: "unknown" });
		expect(manifest.capabilities).toEqual([]);
	});

	test("hub-backed sources follow the link: absent with no hub, unknown while unreachable", async () => {
		const absent = await buildManifest(
			[hubBackedSource("tasks", { availability: () => "absent" })],
			repo,
		);
		const unknown = await buildManifest(
			[hubBackedSource("tasks", { availability: () => "unknown" })],
			repo,
		);
		expect(absent.sources.tasks).toBe("absent");
		expect(unknown.sources.tasks).toBe("unknown");
	});

	test("off and absent sources give no facts; a slow one reads unknown", async () => {
		const reading = (
			id: string,
			state: "present" | "absent",
		): ContextSource => ({
			id,
			tier: "T2",
			probe: () => state,
			facts: () => ({ heading: "h", lines: ["x"] }),
		});
		const slow: ContextSource = {
			id: "slow",
			tier: "T2",
			probe: () => "present",
			facts: () =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ heading: "late", lines: [] }), 50),
				),
		};
		const sources = [
			reading("history", "present"),
			reading("tasks", "absent"),
			slow,
		];
		const manifest = await buildManifest(sources, repo, {
			isOff: (source) => source.id === "history",
		});
		expect(manifest.sources).toEqual({
			history: "off",
			tasks: "absent",
			slow: "present",
		});
		expect(
			await collectFacts(sources, manifest, repo, { budgetMs: () => 5 }),
		).toEqual({ slow: "unknown" });
	});

	test("tags carry ids and states only, sorted, for the offer record", async () => {
		const manifest = await buildManifest([turnSource, gitSource], repo);
		expect(manifestTags(manifest)).toEqual([
			"source:git:present",
			"source:turn:present",
			"cap:remote:github",
			"client:cline-desktop",
			"mode:act",
		]);
	});
});

describe("remote tags", () => {
	test("known hosts only, deduplicated", () => {
		expect(
			remoteTags([
				"https://github.com/a/b",
				"git@github.com:a/c.git",
				"https://git.internal/x",
			]),
		).toEqual(["remote:github"]);
		expect(remoteTags(["https://gitlab.com/a/b"])).toEqual(["remote:gitlab"]);
	});
});
