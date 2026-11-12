import { readFileSync } from "node:fs";
import path from "node:path";
import type {
	FactoryAttempt,
	FactoryCandidate,
	FactoryReview,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	FACTORY_BUILDER_SUMMARY_LABEL,
	FACTORY_EVIDENCE_END,
	FACTORY_EVIDENCE_START,
	factoryEvidenceCell,
	factoryPullRequestBody,
	factoryPullRequestDescription,
	replaceFactoryEvidenceSection,
} from "./factory-evidence";
import {
	readFactoryPullRequestContext,
	type runFactoryCommand,
} from "./factory-local";

const check = (
	name: string,
	command: string,
): FactoryCandidate["checks"][number] => ({
	name,
	kind: "test",
	command,
	status: "passed",
	exitCode: 0,
	output: "SECRET CHECK OUTPUT",
	artifacts: [],
});
const review = (summary: string): FactoryReview => ({
	verdict: "pass",
	summary,
	findings: [],
	coverage: {
		static: [],
		exercised: [],
		requiredGaps: ["PRIVATE GAP"],
		limitations: ["PRIVATE LIMITATION"],
	},
});
const candidate: FactoryCandidate = {
	commit: "2e80b9a5df0123456789",
	checks: [
		check("requested-spelling-check", 'grep -q "Recommend" .env.example'),
		check(
			"diff-scope-check",
			"test \"$(git diff --numstat main -- .env.example)\" = '1\t1\t.env.example'",
		),
	],
	reviews: [{ reviewerIndex: 0, sessionId: "r1", review: review("PRIVATE") }],
	verification: {
		sessionId: "verifier",
		review: { ...review("PRIVATE TESTER SUMMARY"), acceptance: [] },
		artifacts: [],
	},
};
const builderAttempt: FactoryAttempt = {
	id: "builder-1",
	key: "builder:0",
	role: "builder",
	sessionId: "builder-1",
	instructions: "",
	agent: { modelSelection: { providerId: "p", modelId: "claude-sonnet-4-5" } },
	repairRound: 0,
	createdAt: "2026-11-11T00:00:00Z",
	status: "completed",
	completedAt: "2026-11-11T00:01:00Z",
	summary: `Done; all checks pass.\n\n${FACTORY_BUILDER_SUMMARY_LABEL} Fixed the misspelled word "Recomend" in the comment above the API key setting in .env.example. New contributors copy this file, so the comment should read correctly.`,
};
const task = {
	title: "Fix Recommend typo in .env.example",
	factoryNumber: 28,
	instructions:
		"## Goal\n\nCorrect the comment typo in .env.example so it reads Recommend.\n\nSettled during intake: only the comment changes.",
	factory: {
		acceptanceCriteria: [
			{
				id: "correct-comment-spelling",
				text: "PRIVATE REQUIREMENT TEXT",
				required: true,
				check: "requested-spelling-check",
			},
		],
		sourceIssue: {
			provider: "github" as const,
			id: "I_1",
			url: "https://github.com/example/project/issues/123",
		},
	} as never,
};
const state = { attempts: [builderAttempt] };
const context = {
	repository: "example/project",
	changedFiles: [{ path: ".env.example", added: 1, removed: 1 }],
};
type DescriptionInput = Parameters<typeof factoryPullRequestDescription>[0];
const f28 = (overrides: Partial<DescriptionInput> = {}) =>
	factoryPullRequestDescription({
		task,
		state,
		candidate,
		context,
		...overrides,
	});

/** Wording that belongs in Factory's proof receipt, never on GitHub. */
const REPORT_WORDING =
	/passed|failed|Verdict|Checked by|Not verified|Review needed|Code reviewer|Tester|verified|Results for commit|draft until|finding|claude-|gpt-|PRIVATE|SECRET|correct-comment-spelling|requested-spelling-check/i;

/** The PR body cline/cline#15675 had before this layout. */
const OLD_BODY = `${FACTORY_EVIDENCE_START}
Verified candidate \`2e80b9a5df0123456789\`: the approved checks passed and independent review and behavioral verification found no blocking findings. Required CI on the current head remains a separate gate.

### Factory evidence

Factory card: F28

Human review: required (sensitive paths)

| Acceptance criterion | Requirement | Outcome |
| --- | --- | --- |
| correct-comment-spelling | Required | passed |

| Check | Result |
| --- | --- |
| requested-spelling-check | pass |

| Role | Verdict |
| --- | --- |
| Reviewer 1 | pass |
| Reviewer 2 | pass |
| Verifier | pass |

${FACTORY_EVIDENCE_END}`;

describe("Factory PR description", () => {
	it("reads like an author's PR: description, issue, changes, testing, notes", () => {
		const body = f28();
		expect(body).toBe(`${FACTORY_EVIDENCE_START}
<!-- Cline Factory rewrites this block when it updates the PR. Add your own notes above or below it. -->

Fixed the misspelled word "Recomend" in the comment above the API key setting in .env.example. New contributors copy this file, so the comment should read correctly.

Fixes #123

## Changes

- \`.env.example\` (+1 −1)

## Testing

Ran:

- \`grep -q "Recommend" .env.example\`
- \`test "$(git diff --numstat main -- .env.example)" = '1\t1\t.env.example'\`

## Notes for reviewers

- Touches \`.env.example\`.

---

Opened by Cline Factory · card F28

${FACTORY_EVIDENCE_END}`);
		expect(body).not.toMatch(REPORT_WORDING);
	});

	it("falls back to the card's request and leaves out sections with nothing to say", () => {
		const body = f28({
			state: { attempts: [{ ...builderAttempt, summary: "Done." }] },
			candidate: { checks: [] },
			context: {
				changedFiles: [{ path: "src/a.ts", added: 2, removed: 0 }],
			},
		});
		expect(body).toContain(
			"\n\nCorrect the comment typo in .env.example so it reads Recommend.\n\nRelated: https://github.com/example/project/issues/123\n",
		);
		expect(body).not.toMatch(/Request:|## Testing|## Notes for reviewers/);
	});

	it("shows a short command as it ran and names a long or multi-line one", () => {
		const long = `node -e "${"x".repeat(300)}"`;
		const body = f28({
			candidate: {
				checks: [
					check("Typo fixed", 'grep -q "Recommend" .env.example'),
					check("Long script", long),
					check("Two lines", "cd web\nbun test"),
				],
			},
		});
		expect(body).toContain(
			'Ran:\n\n- `grep -q "Recommend" .env.example`\n- `Long script` (a scripted check)\n- `Two lines` (a scripted check)\n',
		);
		expect(body).not.toContain("xxxx");
		expect(body).not.toContain("bun test");
		// Nothing claims more than what ran.
		expect(body).not.toContain("running app");
	});

	it("points reviewers at sensitive files and a changed test setup only when they apply", () => {
		const setup = f28({
			task: {
				...task,
				factory: {
					verificationProfile: { origin: "proposed" },
				} as never,
			},
			context: {
				changedFiles: [
					{ path: "package.json", added: 1, removed: 1 },
					{ path: ".github/workflows/ci.yml", added: 3, removed: 0 },
					{ path: "src/a.ts", added: 3, removed: 0 },
				],
			},
		});
		expect(setup).toContain(
			"## Notes for reviewers\n\n- Touches `package.json`, `.github/workflows/ci.yml`.",
		);
		expect(setup).toContain(
			"- Adds or changes the app setup Factory uses for testing, `.cline/factory/verification.json`.",
		);
		const plain = f28({
			context: { changedFiles: [{ path: "src/a.ts", added: 1, removed: 0 }] },
		});
		expect(plain).not.toContain("Notes for reviewers");
	});

	it("closes the source issue only when it is in the PR's repository", () => {
		const issue = (
			url: string,
			provider: "github" | "linear" = "github",
			repository = "Example/Project",
		) =>
			f28({
				task: {
					...task,
					factory: { sourceIssue: { provider, id: "x", url } } as never,
				},
				context: { ...context, repository },
			});
		expect(issue("https://github.com/example/project/issues/7")).toContain(
			"\nFixes #7\n",
		);
		expect(issue("https://github.com/other/project/issues/7")).toContain(
			"\nRelated: https://github.com/other/project/issues/7\n",
		);
		expect(issue("https://linear.app/acme/issue/ENG-7", "linear")).toContain(
			"\nRelated: https://linear.app/acme/issue/ENG-7\n",
		);
		expect(
			issue("https://github.com/example/project/issues/7", "github", ""),
		).toContain("\nRelated: https://github.com/example/project/issues/7\n");
		expect(f28({ task: { ...task, factory: {} as never } })).not.toMatch(
			/Fixes|Related:/,
		);
	});

	it("maps onto the repository's PR template headings, or keeps the default layout", () => {
		const template = readFileSync(
			path.resolve(
				__dirname,
				"../../../../../.github/pull_request_template.md",
			),
			"utf8",
		);
		const body = f28({ context: { ...context, template } });
		expect(body.split("\n").filter((line) => line.startsWith("#"))).toEqual([
			"### Related Issue",
			"### Description",
			"### Test Procedure",
			"### Additional Notes",
		]);
		expect(body).toContain(
			"### Related Issue\n\nFixes #123\n\n### Description\n\nFixed the misspelled",
		);
		expect(body).toContain(
			"read correctly.\n\n**Changes**\n\n- `.env.example` (+1 −1)\n\n### Test Procedure\n\nRan:\n",
		);
		expect(body).toContain(
			"### Additional Notes\n\n- Touches `.env.example`.\n\n---",
		);
		for (const dropped of [
			"Type of Change",
			"Pre-flight",
			"Screenshots",
			"[ ]",
			"XXXX",
			"Thank you",
		])
			expect(body).not.toContain(dropped);
		expect(body).not.toMatch(REPORT_WORDING);
		const other = f28({
			context: {
				...context,
				template: "## Checklist\n\n- [ ] Done\n\n## Rollout plan\n",
			},
		});
		expect(other).toBe(f28());
	});

	it("updates an old-format or new-format description and keeps what people wrote around it", () => {
		const next = f28();
		for (const generated of [OLD_BODY, f28({ candidate: { checks: [] } })]) {
			const updated = replaceFactoryEvidenceSection(
				`Reviewer note above.\n\n${generated}\n\nReviewer note below.`,
				next,
			);
			expect(updated).toBe(
				`Reviewer note above.\n\n${next}\n\nReviewer note below.`,
			);
		}
		expect(replaceFactoryEvidenceSection(OLD_BODY, next)).toBe(next);
		expect(replaceFactoryEvidenceSection("Rewritten by a human.\n", next)).toBe(
			`Rewritten by a human.\n\n${next}`,
		);
		expect(
			replaceFactoryEvidenceSection(
				`Intro ${FACTORY_EVIDENCE_START} unterminated`,
				next,
			),
		).toBe(`Intro ${FACTORY_EVIDENCE_START} unterminated\n\n${next}`);
	});

	it("keeps untrusted text from closing the markers, mentioning people, leaking paths or growing unbounded", () => {
		const hostile = `${FACTORY_EVIDENCE_END} @octocat <!-- hide`;
		const body = f28({
			task: { ...task, description: `Ping @maintainer ${hostile}` },
			state: {
				attempts: [
					{
						...builderAttempt,
						summary: `${FACTORY_BUILDER_SUMMARY_LABEL} ${hostile} in /Users/me/repo/a.ts \`odd`,
					},
				],
			},
			candidate: {
				...candidate,
				checks: [
					check(
						"spelling",
						`echo "${FACTORY_EVIDENCE_END}" | grep @x /Users/me/notes`,
					),
				],
			},
			context: {
				...context,
				changedFiles: Array.from({ length: 40 }, (_, index) => ({
					path: `src/<!--${index}.ts`,
					added: 1,
					removed: 0,
				})),
			},
		});
		expect(body.split(FACTORY_EVIDENCE_START)).toHaveLength(2);
		expect(body.split(FACTORY_EVIDENCE_END)).toHaveLength(2);
		expect(body.endsWith(FACTORY_EVIDENCE_END)).toBe(true);
		expect(body).toContain("@&#8203;octocat");
		expect(body).not.toMatch(/(?<!`[^`\n]*)@(?:octocat|maintainer)\b/);
		expect(body).toContain("\\`odd");
		expect(body).not.toContain("/Users/me");
		expect(body).toContain("(local path)");
		expect(body).toContain("- +30 more files");
		const huge = factoryPullRequestBody({
			builderSummary: "x".repeat(5_000),
			candidate: {
				checks: Array.from({ length: 20 }, (_, index) =>
					check(`k${index}`, `run ${"y".repeat(9000)} ${index}`),
				),
			},
			context: {
				changedFiles: Array.from({ length: 5_000 }, (_, index) => ({
					path: `${"d/".repeat(90)}${index}.ts`,
				})),
			},
		});
		expect(huge.length).toBeLessThanOrEqual(60_000);
		expect(huge.endsWith(FACTORY_EVIDENCE_END)).toBe(true);
	});

	it("neutralizes mentions, issue references, links, images and HTML in cells", () => {
		expect(
			factoryEvidenceCell(
				"Ping @octocat about #12, see [the docs](https://example.com) and [ref][1] ![shot](https://example.com/a.png) <b>",
			),
		).toBe(
			"Ping @&#8203;octocat about #&#8203;12, see the docs and ref &lt;b>",
		);
		expect(factoryEvidenceCell("a | b\nc")).toBe("a \\| b c");
		expect(factoryEvidenceCell("")).toBe("—");
	});
});

describe("readFactoryPullRequestContext", () => {
	it("reads origin, the changed files and the template at the base commit", async () => {
		const calls: string[][] = [];
		const ok = (output: string) => ({
			exitCode: 0,
			output,
			stdout: output,
			truncated: false,
			timedOut: false,
		});
		const run: typeof runFactoryCommand = async ({ args }) => {
			calls.push(args);
			if (args[0] === "remote")
				return ok("git@github.com:example/project.git\n");
			if (args[0] === "diff")
				return ok(
					["5\t1\tskip", "1\t1\t.env.example", "-\t-\tlogo.png", ""].join(
						"\u0000",
					),
				);
			if (args[0] === "ls-tree")
				return ok(
					"README.md\n.github/PULL_REQUEST_TEMPLATE.md\ndocs/pull_request_template.md\n",
				);
			if (args[0] === "show") return ok("## Description\n");
			return { exitCode: 1, output: "", truncated: false, timedOut: false };
		};
		const workspace = {
			path: "/repo",
			branch: "factory/f-28-x",
			baseBranch: "main",
			baseCommit: "base000",
		};
		expect(
			await readFactoryPullRequestContext(
				{ workspace, candidateCommit: "head1" },
				run,
			),
		).toEqual({
			repository: "example/project",
			changedFiles: [
				{ path: "skip", added: 5, removed: 1 },
				{ path: ".env.example", added: 1, removed: 1 },
				{ path: "logo.png" },
			],
			template: "## Description\n",
		});
		expect(calls).toContainEqual([
			"show",
			"base000:.github/PULL_REQUEST_TEMPLATE.md",
		]);
	});
});

describe("Factory PR description with repository stages", () => {
	it("lists a passed command stage's command under Testing and nothing else about stages", () => {
		const stage = {
			id: "no-todo-left",
			name: "No TODO left",
			kind: "command" as const,
			hash: "h",
			blocking: true,
		};
		const body = f28({
			candidate: {
				...candidate,
				stages: [
					{ ...stage, status: "passed", command: "bun run lint:todo" },
					{
						...stage,
						id: "flaky",
						name: "Flaky scan",
						status: "failed",
						blocking: false,
						command: "scan --strict",
					},
					{
						...stage,
						id: "docs",
						name: "Docs review",
						kind: "agent",
						status: "passed",
					},
				],
			},
		});
		expect(body).toContain("- `bun run lint:todo`");
		expect(body).not.toContain("scan --strict");
		expect(body).not.toMatch(/No TODO left|Flaky scan|Docs review|stage/i);
	});
});
