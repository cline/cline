import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { runFactoryCommand } from "./factory-local";
import {
	codeOwnersFor,
	FactoryReviewInputError,
	factoryCodeOwnership,
	factoryReviewTrust,
	parseCodeOwners,
	parseFactoryGitHubRemote,
	readFactoryReviewInput,
} from "./factory-review-input";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const CODEOWNERS = [
	"# Owners",
	"*           @acme/everyone",
	"/src/       @alice",
	"src/legacy/ @acme/legacy",
	"docs/*      @bob",
	"",
].join("\n");

type Result = Awaited<ReturnType<typeof runFactoryCommand>>;
const ok = (output: string): Result => ({
	exitCode: 0,
	output,
	stdout: output,
	truncated: false,
	timedOut: false,
});
const fail = (output: string): Result => ({
	exitCode: 1,
	output,
	truncated: false,
	timedOut: false,
});

function fixture(
	overrides: {
		origin?: string;
		pr?: Record<string, unknown>;
		rest?: Record<string, unknown>;
		codeowners?: Record<string, string>;
		baseMissing?: boolean;
	} = {},
) {
	const pr = {
		number: 42,
		url: "https://github.com/acme/widgets/pull/42",
		title: "Fix\u0007 the‮ widget\nparser",
		state: "OPEN",
		author: { login: "carol" },
		isCrossRepository: false,
		isDraft: false,
		baseRefName: "main",
		baseRefOid: BASE,
		headRefName: "carol/fix",
		headRefOid: HEAD,
		files: [
			{ path: "src/parser.ts", additions: 10, deletions: 2 },
			{ path: "src/legacy/old.ts", additions: 1, deletions: 1 },
			{ path: "docs/guide.md", additions: 3, deletions: 0 },
			{ path: "README.md", additions: 1, deletions: 0 },
		],
		additions: 15,
		deletions: 3,
		changedFiles: 4,
		...overrides.pr,
	};
	const rest = {
		author_association: "COLLABORATOR",
		base_repo: "acme/widgets",
		head_sha: HEAD,
		...overrides.rest,
	};
	const codeowners = overrides.codeowners ?? {
		".github/CODEOWNERS": CODEOWNERS,
	};
	return vi.fn<typeof runFactoryCommand>(async ({ file, args }) => {
		const command = `${file} ${args.join(" ")}`;
		if (command === "git remote get-url origin")
			return ok(`${overrides.origin ?? "git@github.com:acme/widgets.git"}\n`);
		if (command.startsWith("gh repo view"))
			return ok(
				JSON.stringify({
					nameWithOwner: "acme/widgets",
					viewerPermission: "WRITE",
				}),
			);
		if (command.startsWith("gh pr view")) return ok(JSON.stringify(pr));
		if (command.startsWith("gh api repos/")) return ok(JSON.stringify(rest));
		if (command === "gh api user --jq .login") return ok("alice\n");
		if (command.startsWith("git cat-file"))
			return overrides.baseMissing ? fail("missing") : ok("");
		if (command.startsWith("git fetch")) return ok("");
		if (file === "git" && args[0] === "show") {
			const [sha, path] = (args[1] ?? "").split(/:(.*)/s);
			if (sha !== BASE) return fail("wrong commit");
			const text = path ? codeowners[path] : undefined;
			return text === undefined ? fail("does not exist") : ok(text);
		}
		throw new Error(`Unexpected command: ${command}`);
	});
}

describe("readFactoryReviewInput", () => {
	it("reads a same-repository PR with ownership from CODEOWNERS at the base commit", async () => {
		const run = fixture();
		const input = await readFactoryReviewInput({
			workspaceRoot: tmpdir(),
			pullRequest: 42,
			run,
		});
		expect(input).toMatchObject({
			repository: {
				host: "github.com",
				owner: "acme",
				name: "widgets",
				viewerPermission: "WRITE",
			},
			number: 42,
			title: "Fix the widget parser",
			author: { login: "carol", association: "COLLABORATOR" },
			isCrossRepository: false,
			baseSha: BASE,
			headSha: HEAD,
			changedFiles: 4,
			viewerLogin: "alice",
			codeOwners: {
				source: ".github/CODEOWNERS",
				total: 4,
				matchedFiles: ["src/parser.ts"],
				teamOwnedFiles: ["src/legacy/old.ts", "README.md"],
			},
		});
		// Every command is an argument array; nothing reads the PR head.
		for (const [call] of run.mock.calls) {
			expect(call.args.join(" ")).not.toContain(HEAD);
		}
		const shows = run.mock.calls
			.map(([call]) => call.args)
			.filter((args) => args[0] === "show");
		expect(shows).toEqual([["show", `${BASE}:.github/CODEOWNERS`]]);
		expect(factoryReviewTrust(input)).toEqual({
			authorTrusted: true,
			executable: "with_user_click",
			reason: expect.any(String),
			suggestion:
				"You own 1 of 4 touched files (2 owned by teams whose membership is unknown) and the author is a collaborator.",
		});
	});

	it("reads a fork PR by URL and marks it never executable", async () => {
		const run = fixture({
			pr: { isCrossRepository: true },
			codeowners: { "docs/CODEOWNERS": "* @alice\n" },
		});
		const input = await readFactoryReviewInput({
			workspaceRoot: tmpdir(),
			pullRequest: "https://github.com/acme/widgets/pull/42/files",
			run,
		});
		expect(input.isCrossRepository).toBe(true);
		expect(input.codeOwners).toMatchObject({
			source: "docs/CODEOWNERS",
			matchedFiles: input.files.map((file) => file.path),
		});
		expect(factoryReviewTrust(input)).toMatchObject({
			authorTrusted: true,
			executable: "never",
		});
		expect(factoryReviewTrust(input).suggestion).toBeUndefined();
	});

	it("refuses a PR URL from another repository before asking GitHub", async () => {
		const run = fixture();
		await expect(
			readFactoryReviewInput({
				workspaceRoot: tmpdir(),
				pullRequest: "https://github.com/other/widgets/pull/42",
				run,
			}),
		).rejects.toThrow(
			"Pull request #42 belongs to other/widgets, but this checkout's origin is acme/widgets; review it from a checkout of other/widgets.",
		);
		expect(run.mock.calls.some(([call]) => call.file === "gh")).toBe(false);
	});

	it("refuses when GitHub reports a different base repository", async () => {
		await expect(
			readFactoryReviewInput({
				workspaceRoot: tmpdir(),
				pullRequest: 42,
				run: fixture({ rest: { base_repo: "upstream/widgets" } }),
			}),
		).rejects.toBeInstanceOf(FactoryReviewInputError);
		await expect(
			readFactoryReviewInput({
				workspaceRoot: tmpdir(),
				pullRequest: 42,
				run: fixture({
					pr: { url: "https://github.com/upstream/widgets/pull/42" },
				}),
			}),
		).rejects.toThrow(/targets upstream\/widgets, not this checkout's origin/);
	});

	it("refuses a checkout without a GitHub origin and a head that moved mid-read", async () => {
		await expect(
			readFactoryReviewInput({
				workspaceRoot: tmpdir(),
				pullRequest: 42,
				run: fixture({ origin: "/srv/git/widgets.git" }),
			}),
		).rejects.toThrow(/no GitHub origin remote/);
		await expect(
			readFactoryReviewInput({
				workspaceRoot: tmpdir(),
				pullRequest: 42,
				run: fixture({ rest: { head_sha: "c".repeat(40) } }),
			}),
		).rejects.toThrow(/changed while Factory was reading it/);
	});

	it("reports ownership as unknown when the base commit cannot be fetched", async () => {
		const input = await readFactoryReviewInput({
			workspaceRoot: tmpdir(),
			pullRequest: "#42",
			run: fixture({ baseMissing: true }),
		});
		expect(input.codeOwners).toEqual({
			matchedFiles: [],
			total: 4,
			teamOwnedFiles: [],
			limitation:
				"The base commit is not available locally, so CODEOWNERS could not be read.",
		});
	});

	it("rejects malformed references", async () => {
		for (const pullRequest of [
			0,
			-1,
			"abc",
			"https://github.com/acme/widgets/issues/1",
		])
			await expect(
				readFactoryReviewInput({
					workspaceRoot: tmpdir(),
					pullRequest,
					run: fixture(),
				}),
			).rejects.toThrow(
				"Give the pull request as a number or a pull request URL.",
			);
	});
});

describe("parseFactoryGitHubRemote", () => {
	it.each([
		["git@github.com:acme/widgets.git", "github.com/acme/widgets"],
		["https://github.com/acme/widgets", "github.com/acme/widgets"],
		[
			"https://x-access-token:secret@github.com/acme/widgets.git",
			"github.com/acme/widgets",
		],
		[
			"ssh://git@github.example.com:22/acme/widgets.git",
			"github.example.com/acme/widgets",
		],
		["/srv/git/widgets.git", undefined],
	])("%s", (url, expected) => {
		const repo = parseFactoryGitHubRemote(url);
		expect(repo && `${repo.host}/${repo.owner}/${repo.name}`).toBe(expected);
	});
});

describe("CODEOWNERS", () => {
	it("parses comments, blank lines, escapes and unsupported syntax", () => {
		const rules = parseCodeOwners(
			[
				"# heading",
				"",
				"*.js @js-owner # trailing comment",
				"\\#notes.md @notes",
				"!skip.md @nobody",
				"[ab].md @nobody",
				"/unowned/",
				"docs/  @acme/docs  docs@example.com  not-an-owner",
			].join("\n"),
		);
		expect(
			rules.map(({ pattern, owners, line }) => ({ pattern, owners, line })),
		).toEqual([
			{ pattern: "*.js", owners: ["@js-owner"], line: 3 },
			{ pattern: "#notes.md", owners: ["@notes"], line: 4 },
			{ pattern: "/unowned/", owners: [], line: 7 },
			{ pattern: "docs/", owners: ["@acme/docs", "docs@example.com"], line: 8 },
		]);
	});

	const table: [pattern: string, path: string, matches: boolean][] = [
		["*", "a/b/c.ts", true],
		["*.js", "app.js", true],
		["*.js", "src/deep/app.js", true],
		["*.js", "app.jsx", false],
		["/docs/", "docs/a.md", true],
		["/docs/", "docs/deep/a.md", true],
		["/docs/", "src/docs/a.md", false],
		["apps/", "apps/x.ts", true],
		["apps/", "src/apps/x.ts", true],
		["apps/", "apps", false],
		["docs/*", "docs/getting-started.md", true],
		["docs/*", "docs/build-app/troubleshooting.md", false],
		["docs/*", "src/docs/a.md", false],
		["/build/logs/", "build/logs/a.log", true],
		["/build/logs/", "x/build/logs/a.log", false],
		["**/logs", "logs/a.log", true],
		["**/logs", "deep/build/logs/a.log", true],
		["docs/**", "docs/a/b.md", true],
		["docs/**", "src/docs/a.md", false],
		["src/**/test.ts", "src/test.ts", true],
		["src/**/test.ts", "src/a/b/test.ts", true],
		["/README.md", "README.md", true],
		["/README.md", "docs/README.md", false],
		["README.md", "docs/README.md", true],
		["src", "src/a.ts", true],
		["src", "lib/src/a.ts", true],
		["file?.ts", "file1.ts", true],
		["file?.ts", "file12.ts", false],
		["a.b", "aXb", false],
	];
	it.each(table)("%s against %s → %s", (pattern, path, matches) => {
		const rules = parseCodeOwners(`${pattern} @owner`);
		expect(Boolean(codeOwnersFor(path, rules))).toBe(matches);
	});

	it("uses the last matching rule, including an ownerless one", () => {
		const rules = parseCodeOwners(
			["*.ts @everyone", "/src/ @alice", "/src/generated/"].join("\n"),
		);
		expect(codeOwnersFor("lib/a.ts", rules)?.owners).toEqual(["@everyone"]);
		expect(codeOwnersFor("src/a.ts", rules)?.owners).toEqual(["@alice"]);
		expect(codeOwnersFor("src/generated/a.ts", rules)?.owners).toEqual([]);
		expect(codeOwnersFor("README.md", rules)).toBeUndefined();
	});

	it("counts only the user's own files, case-insensitively, never via teams", () => {
		const rules = parseCodeOwners(
			[
				"* @acme/core",
				"/src/ @Alice @acme/core",
				"/docs/ dev@example.com",
				"/vendor/",
			].join("\n"),
		);
		expect(
			factoryCodeOwnership(
				rules,
				["src/a.ts", "src/b.ts", "lib/c.ts", "docs/d.md", "vendor/e.js"],
				"alice",
			),
		).toEqual({
			matchedFiles: ["src/a.ts", "src/b.ts"],
			total: 5,
			teamOwnedFiles: ["lib/c.ts", "docs/d.md"],
		});
	});
});

describe("factoryReviewTrust", () => {
	const owners = {
		matchedFiles: ["a", "b", "c"],
		total: 7,
		teamOwnedFiles: [],
		source: ".github/CODEOWNERS",
	};
	it.each([
		[false, "OWNER", "with_user_click", true],
		[false, "MEMBER", "with_user_click", true],
		[false, "COLLABORATOR", "with_user_click", true],
		[false, "CONTRIBUTOR", "never", false],
		[false, "FIRST_TIME_CONTRIBUTOR", "never", false],
		[false, "NONE", "never", false],
		[true, "OWNER", "never", true],
		[true, "COLLABORATOR", "never", true],
		[true, "NONE", "never", false],
	] as const)("cross-repository %s, %s → %s", (isCrossRepository, association, executable, authorTrusted) => {
		const trust = factoryReviewTrust({
			isCrossRepository,
			author: { login: "carol", association },
			codeOwners: owners,
		});
		expect(trust.executable).toBe(executable);
		expect(trust.authorTrusted).toBe(authorTrusted);
		expect(Boolean(trust.suggestion)).toBe(executable === "with_user_click");
	});

	it("words the suggestion with ownership counts or a missing CODEOWNERS file", () => {
		expect(
			factoryReviewTrust({
				isCrossRepository: false,
				author: { login: "carol", association: "COLLABORATOR" },
				codeOwners: owners,
			}).suggestion,
		).toBe("You own 3 of 7 touched files and the author is a collaborator.");
		expect(
			factoryReviewTrust({
				isCrossRepository: false,
				author: { login: "carol", association: "MEMBER" },
				codeOwners: { matchedFiles: [], total: 2, teamOwnedFiles: [] },
			}).suggestion,
		).toBe(
			"There is no CODEOWNERS file at the base commit and the author is an organization member.",
		);
	});
});
