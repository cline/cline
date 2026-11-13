import { describe, expect, it } from "vitest";
import type { runFactoryCommand } from "./factory-local";
import {
	factoryReviewPostDigests,
	findFactoryPostedReview,
	postFactoryReview,
} from "./factory-review-post";

const pullRequest = {
	host: "github.com",
	owner: "acme",
	name: "widgets",
	number: 15,
	url: "https://github.com/acme/widgets/pull/15",
};

describe("postFactoryReview", () => {
	it("folds refused comments with each file name in a code span and nothing that fetches", async () => {
		const sent: { body: string; comments: unknown[] }[] = [];
		const run = (async (input: { stdin?: string }) => {
			const request = JSON.parse(input.stdin ?? "{}");
			sent.push(request);
			return request.comments.length
				? {
						exitCode: 1,
						output: "gh: Validation Failed (HTTP 422)",
						truncated: false,
						timedOut: false,
					}
				: {
						exitCode: 0,
						output: "",
						stdout: JSON.stringify({ html_url: "https://example.test/r/1" }),
						truncated: false,
						timedOut: false,
					};
		}) as unknown as typeof runFactoryCommand;
		// A file name the pull request's author chose.
		const path = "src/x`: @acme/owners ![s](https://evil.example/p) `.ts";
		const posted = await postFactoryReview({
			workspaceRoot: "/project",
			pullRequest,
			headSha: "a".repeat(40),
			event: "COMMENT",
			body: "Summary.",
			comments: [
				{ path, line: 2, body: "Odd ![t]" },
				{ path: "src/b.ts", line: 3, body: "[t]: https://evil.example/c" },
			],
			signal: new AbortController().signal,
			run,
		});
		expect(posted).toEqual({ url: "https://example.test/r/1", bodyOnly: true });
		const folded = sent[1]?.body ?? "";
		expect(folded).toContain(`- \`\`${path}:2\`\`: Odd !\\[t]`);
		expect(folded).toContain("- `src/b.ts:3`: [t\\]: https\\://evil.example/c");
	});
});

describe("findFactoryPostedReview", () => {
	it("never takes a review without a body for a post whose reply was lost", async () => {
		const head = "a".repeat(40);
		// A review the person approved on GitHub by hand, with no body.
		const run = (async () => ({
			exitCode: 0,
			output: "",
			stdout: JSON.stringify({
				login: "alice",
				commit: head,
				state: "APPROVED",
				body: "",
				url: "https://github.com/acme/widgets/pull/15#pullrequestreview-9",
			}),
			truncated: false,
			timedOut: false,
		})) as unknown as typeof runFactoryCommand;
		expect(
			await findFactoryPostedReview({
				workspaceRoot: "/project",
				pullRequest,
				headSha: head,
				viewerLogin: "alice",
				event: "APPROVE",
				digests: factoryReviewPostDigests({
					body: "",
					comments: [{ path: "src/a.ts", line: 1, body: "Nice." }],
				}),
				signal: new AbortController().signal,
				run,
			}),
		).toBeUndefined();
	});
});
