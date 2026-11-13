import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { runFactoryCommand } from "./factory-local";
import {
	FactoryReviewInputError,
	parseFactoryGitHubRemote,
	readFactoryReviewInput,
	resolveFactoryPullRequestReference,
} from "./factory-review-input";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

type Result = Awaited<ReturnType<typeof runFactoryCommand>>;
const ok = (output: string): Result => ({
	exitCode: 0,
	output,
	stdout: output,
	truncated: false,
	timedOut: false,
});

function fixture(
	overrides: {
		origin?: string;
		pr?: Record<string, unknown>;
		rest?: Record<string, unknown>;
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
	return vi.fn<typeof runFactoryCommand>(async ({ file, args }) => {
		const command = `${file} ${args.join(" ")}`;
		if (
			command === "git remote get-url origin" ||
			command === "git config --get remote.origin.url"
		)
			return ok(`${overrides.origin ?? "git@github.com:acme/widgets.git"}\n`);
		if (command.startsWith("gh repo view"))
			return ok(JSON.stringify({ nameWithOwner: "acme/widgets" }));
		if (command.startsWith("gh pr view")) return ok(JSON.stringify(pr));
		if (command.startsWith("gh api repos/")) return ok(JSON.stringify(rest));
		if (command === "gh api user --jq .login") return ok("alice\n");
		throw new Error(`Unexpected command: ${command}`);
	});
}

describe("readFactoryReviewInput", () => {
	it("reads a same-repository PR without reading its head", async () => {
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
			},
			number: 42,
			title: "Fix the widget parser",
			author: { login: "carol", association: "COLLABORATOR" },
			isCrossRepository: false,
			baseSha: BASE,
			headSha: HEAD,
			changedFiles: 4,
			viewerLogin: "alice",
		});
		// Every command is an argument array; nothing reads the PR head.
		for (const [call] of run.mock.calls) {
			expect(call.args.join(" ")).not.toContain(HEAD);
		}
	});

	it("reads a fork PR by URL", async () => {
		const input = await readFactoryReviewInput({
			workspaceRoot: tmpdir(),
			pullRequest: "https://github.com/acme/widgets/pull/42/files",
			run: fixture({ pr: { isCrossRepository: true } }),
		});
		expect(input.isCrossRepository).toBe(true);
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

	it("rejects malformed references", async () => {
		for (const pullRequest of [
			0,
			-1,
			"abc",
			"acme/widgets#x",
			"https://github.com/acme/widgets/issues/1",
		])
			await expect(
				readFactoryReviewInput({
					workspaceRoot: tmpdir(),
					pullRequest,
					run: fixture(),
				}),
			).rejects.toThrow(
				"Give the pull request as a number, owner/repo#number or a pull request URL.",
			);
	});

	it("names a pull request by owner/repo#number, only in the project's origin", async () => {
		await expect(
			resolveFactoryPullRequestReference({
				workspaceRoot: tmpdir(),
				pullRequest: "acme/widgets#42",
				run: fixture(),
			}),
		).resolves.toEqual({
			host: "github.com",
			owner: "acme",
			name: "widgets",
			number: 42,
			url: "https://github.com/acme/widgets/pull/42",
		});
		await expect(
			resolveFactoryPullRequestReference({
				workspaceRoot: tmpdir(),
				pullRequest: "other/repo#42",
				run: fixture(),
			}),
		).rejects.toThrow(
			"That pull request belongs to other/repo, but this project's origin is acme/widgets",
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
