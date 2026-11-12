import { describe, expect, it } from "vitest";
import {
	assembleFactoryReviewDraft,
	FACTORY_REVIEW_DRAFT_LIMITS,
	type FactoryReviewDraftReviewer,
	factoryReviewDraftStale,
} from "./factory-review-draft";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const reviewer = (
	reviewerIndex: number,
	review: Partial<FactoryReviewDraftReviewer["review"]> = {},
): FactoryReviewDraftReviewer => ({
	reviewerIndex,
	review: {
		verdict: "pass",
		summary: "Looks fine.",
		findings: [],
		...review,
	},
});

describe("assembleFactoryReviewDraft", () => {
	it("suggests approval only when every reviewer passed with no findings", () => {
		const clean = assembleFactoryReviewDraft({
			headSha: HEAD,
			reviewers: [reviewer(0), reviewer(1)],
		});
		expect(clean.verdict).toBe("approve_suggested");
		expect(clean.comments).toEqual([]);
		expect(clean.body).toContain("Approval is a suggestion");
		expect(
			assembleFactoryReviewDraft({ headSha: HEAD, reviewers: [] }).verdict,
		).toBe("comment");
		expect(
			assembleFactoryReviewDraft({
				headSha: HEAD,
				reviewers: [reviewer(0), reviewer(1, { findings: ["Nit: rename x."] })],
			}).verdict,
		).toBe("comment");
		expect(
			assembleFactoryReviewDraft({
				headSha: HEAD,
				reviewers: [
					reviewer(0),
					reviewer(1, {
						verdict: "changes_requested",
						summary: "Broken.",
						findings: ["The parser drops the last token."],
					}),
				],
			}).verdict,
		).toBe("request_changes");
	});

	it("merges duplicate findings across reviewers by location and by text", () => {
		const draft = assembleFactoryReviewDraft({
			headSha: HEAD,
			files: [{ path: "src/parser.ts" }],
			reviewers: [
				reviewer(0, {
					verdict: "changes_requested",
					findings: [
						"The parser drops the last token when input ends without a newline.",
						"Missing test for empty input.",
					],
					locations: [
						{
							path: "src/parser.ts",
							line: 12,
							body: "Off-by-one: the loop stops early.",
						},
					],
				}),
				reviewer(1, {
					verdict: "changes_requested",
					findings: [
						"the parser drops the last token when input ends without a newline!",
						"Off-by-one: the loop stops early.",
					],
					locations: [
						{
							path: "src/parser.ts",
							line: 12,
							body: "Loop bound should be <= length.",
						},
					],
				}),
			],
		});
		expect(draft.comments).toEqual([
			{
				path: "src/parser.ts",
				line: 12,
				body: "Off-by-one: the loop stops early.\n\nLoop bound should be &lt;= length.",
				reviewers: ["Reviewer 1", "Reviewer 2"],
			},
		]);
		expect(draft.body).toContain(
			"- The parser drops the last token when input ends without a newline. (Reviewer 1, Reviewer 2)",
		);
		expect(draft.body).toContain(
			"- Missing test for empty input. (Reviewer 1)",
		);
		expect(draft.dropped.map((entry) => entry.reason)).toEqual([
			"duplicate",
			"duplicate",
		]);
	});

	it("keeps inline only comments on PR files and covered lines; the rest go into the body", () => {
		const draft = assembleFactoryReviewDraft({
			headSha: HEAD,
			files: [
				{ path: "src/a.ts", ranges: [{ start: 10, end: 20 }] },
				{ path: "src/b.ts" },
			],
			reviewers: [
				reviewer(0, {
					findings: [],
					locations: [
						{ path: "src/a.ts", line: 15, body: "Inside the hunk." },
						{ path: "src/a.ts", line: 40, body: "Outside the hunk." },
						{ path: "./src/b.ts", line: 3, body: "Any line of a listed file." },
						{ path: "src/other.ts", line: 1, body: "Not in this PR." },
						{ path: "../etc/passwd", line: 1, body: "Escapes." },
						{ path: "src/a.ts", line: 0, body: "No line." },
						{ path: "src/a.ts", line: 11, body: "   " },
					],
				}),
			],
		});
		expect(draft.comments.map((c) => `${c.path}:${c.line}`)).toEqual([
			"src/a.ts:15",
			"src/b.ts:3",
		]);
		expect(draft.body).toContain(
			"- src/a.ts:40: Outside the hunk. (Reviewer 1)",
		);
		expect(draft.body).toContain(
			"- src/other.ts:1: Not in this PR. (Reviewer 1)",
		);
		expect(draft.dropped.map((entry) => entry.reason)).toEqual([
			"invalid_location",
			"invalid_location",
			"empty",
		]);
		// Without a diff, nothing is placed inline.
		expect(
			assembleFactoryReviewDraft({
				headSha: HEAD,
				reviewers: [
					reviewer(0, {
						locations: [{ path: "src/a.ts", line: 15, body: "Inside." }],
					}),
				],
			}).comments,
		).toEqual([]);
	});

	it("caps comments, body findings and lengths", () => {
		const limits = FACTORY_REVIEW_DRAFT_LIMITS;
		const locations = Array.from({ length: limits.comments + 5 }, (_, i) => ({
			path: "src/a.ts",
			line: i + 1,
			body: `Distinct comment number ${i} about ${"z".repeat(i)}`,
		}));
		const findings = Array.from(
			{ length: limits.bodyFindings + 10 },
			(_, i) => `Finding ${i} ${"q".repeat(i + 1)} ${"long ".repeat(400)}`,
		);
		const draft = assembleFactoryReviewDraft({
			headSha: HEAD,
			files: [{ path: "src/a.ts" }],
			reviewers: [reviewer(0, { findings, locations })],
		});
		expect(draft.comments).toHaveLength(limits.comments);
		expect(
			draft.body.split("\n").filter((line) => line.startsWith("- Finding")),
		).toHaveLength(limits.bodyFindings);
		expect(draft.body).toContain("- 15 more findings in Factory");
		expect(draft.body.length).toBeLessThanOrEqual(limits.bodyChars);
		for (const line of draft.body.split("\n"))
			expect(line.length).toBeLessThan(limits.findingChars + 100);
		expect(
			draft.dropped.filter((entry) => entry.reason === "limit"),
		).toHaveLength(15);
	});

	it("sanitises mentions, references, links, images and HTML like the PR evidence", () => {
		const draft = assembleFactoryReviewDraft({
			headSha: HEAD,
			files: [{ path: "src/a.ts" }],
			reviewers: [
				{
					reviewerIndex: 0,
					label: "@security-team",
					review: {
						verdict: "changes_requested",
						summary: "See [details](https://evil.example) <script>x</script>",
						findings: [
							"Ping @octocat about #123 ![img](https://evil.example/i.png)",
						],
						locations: [
							{
								path: "src/a.ts",
								line: 2,
								body: "<img src=x onerror=alert(1)> fixes #9",
							},
						],
					},
				},
			],
		});
		const text = `${draft.body}\n${draft.comments.map((c) => `${c.body} ${c.reviewers}`).join("\n")}`;
		expect(text).not.toMatch(/@[a-z]/i);
		expect(text).not.toMatch(/(?<!&)#\d/);
		expect(text).not.toContain("https://evil.example");
		expect(text).not.toContain("<script");
		expect(text).not.toContain("<img");
		expect(draft.body).toContain("See details &lt;script>");
	});

	it("ends with a footer naming the reviewers and the commit", () => {
		const draft = assembleFactoryReviewDraft({
			headSha: HEAD.toUpperCase(),
			reviewers: [reviewer(0), { ...reviewer(1), label: "Security" }],
		});
		expect(draft.headSha).toBe(HEAD);
		expect(draft.body.split("\n").at(-1)).toBe(
			"<sub>Draft by Cline Factory: Reviewer 1, Security reviewed commit `0123456789ab`.</sub>",
		);
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
