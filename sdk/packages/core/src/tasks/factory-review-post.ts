/**
 * Posting a review draft to GitHub: one request, made only from the
 * person's command in the app (task.factory.review.post). Nothing else in
 * Factory posts, approves or requests changes.
 */
import { createHash } from "node:crypto";
import {
	type FactoryPullRequestReference,
	type FactoryReviewEvent,
	type FactoryReviewRefusalCode,
	factoryReviewInertMarkdown,
} from "@cline/shared";
import { z } from "zod";
import { runFactoryCommand } from "./factory-local";
import {
	factoryGhHostArgs,
	factoryReviewUntrustedText,
} from "./factory-review-input";

type Command = typeof runFactoryCommand;

/**
 * Why Factory would not post or review again, with the code the Hub reply
 * carries (FACTORY_REVIEW_REFUSAL_CODES) and one sentence for the person.
 */
export class FactoryReviewRefusal extends Error {
	override name = "FactoryReviewRefusal";
	constructor(
		readonly code: FactoryReviewRefusalCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

/** Posting failed after GitHub may have received the review. */
export class FactoryReviewPostUncertainError extends FactoryReviewRefusal {
	override name = "FactoryReviewPostUncertainError";
	constructor(message: string, options?: ErrorOptions) {
		super("factory_review_unconfirmed", message, options);
	}
}

const POST_TIMEOUT_MS = 60_000;
/** GitHub's answer when an inline comment's line is not in the diff. */
const UNRESOLVED_ANCHOR = /HTTP 422|Unprocessable/i;
const CLIENT_ERROR = /HTTP 4\d\d/;

const reviewsPath = (pullRequest: FactoryPullRequestReference) =>
	`repos/${pullRequest.owner}/${pullRequest.name}/pulls/${pullRequest.number}/reviews`;

export interface FactoryReviewPostComment {
	path: string;
	line: number;
	body: string;
}

/** `text` on one line as a Markdown code span nothing inside can close. */
function codeSpan(text: string): string {
	const flat = text.replace(/\s+/g, " ");
	const longest = Math.max(
		0,
		...(flat.match(/`+/g) ?? []).map((run) => run.length),
	);
	const fence = "`".repeat(longest + 1);
	const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
	return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * The comments as one body section, for when GitHub refused an anchor. The
 * pull request's file names are code spans. The whole section is made inert
 * again (factoryReviewInertMarkdown is idempotent): a comment's first line
 * no longer starts a line here, so what was code in it may not be.
 */
function foldComments(
	body: string,
	comments: readonly FactoryReviewPostComment[],
): string {
	return factoryReviewInertMarkdown(
		[
			body.trim(),
			"",
			"**Comments**",
			"",
			...comments.map(
				(comment) =>
					`- ${codeSpan(`${comment.path}:${comment.line}`)}: ${comment.body}`,
			),
		]
			.join("\n")
			.trim(),
	);
}

const bodyDigest = (body: string) =>
	createHash("sha256").update(body.replace(/\r\n/g, "\n").trim()).digest("hex");

/**
 * Digests of the body each attempt of postFactoryReview sends: `body` as
 * given, and `bodyOnly` with the comments folded in (when there are any).
 * Recorded with the posting intent, so findFactoryPostedReview recognises
 * exactly that review.
 */
export function factoryReviewPostDigests(input: {
	body: string;
	comments: readonly FactoryReviewPostComment[];
}): { body: string; bodyOnly?: string } {
	return {
		body: bodyDigest(input.body),
		...(input.comments.length
			? { bodyOnly: bodyDigest(foldComments(input.body, input.comments)) }
			: {}),
	};
}

/**
 * Posts one review of `headSha`. When GitHub refuses an inline anchor (422)
 * it posts once more with the comments folded into the body (`bodyOnly`).
 * Throws a FactoryReviewPostUncertainError when GitHub may have received the
 * review (a timeout, an abort, or no readable reply), so the caller checks
 * before posting again; any other error means nothing was posted.
 */
export async function postFactoryReview(input: {
	workspaceRoot: string;
	pullRequest: FactoryPullRequestReference;
	headSha: string;
	event: FactoryReviewEvent;
	body: string;
	comments: readonly FactoryReviewPostComment[];
	signal: AbortSignal;
	run?: Command;
}): Promise<{ url: string; bodyOnly?: true }> {
	const run = input.run ?? runFactoryCommand;
	const send = (body: string, comments: FactoryReviewPostComment[]) =>
		run({
			cwd: input.workspaceRoot,
			file: "gh",
			args: [
				"api",
				...factoryGhHostArgs(input.pullRequest.host),
				"--method",
				"POST",
				reviewsPath(input.pullRequest),
				"--input",
				"-",
			],
			stdin: JSON.stringify({
				commit_id: input.headSha,
				event: input.event,
				body,
				comments: comments.map((comment) => ({
					path: comment.path,
					line: comment.line,
					side: "RIGHT",
					body: comment.body,
				})),
			}),
			signal: input.signal,
			timeoutMs: POST_TIMEOUT_MS,
			captureStdout: true,
		}).catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(
					"The GitHub CLI (gh) is not installed; install it from https://cli.github.com, then try again.",
				);
			throw new FactoryReviewPostUncertainError(
				"Posting was interrupted; Factory checks GitHub before posting again.",
				{ cause: error },
			);
		});
	const comments = [...input.comments];
	let bodyOnly = false;
	let result = await send(input.body, comments);
	if (
		result.exitCode !== 0 &&
		!result.timedOut &&
		comments.length &&
		UNRESOLVED_ANCHOR.test(result.output)
	) {
		bodyOnly = true;
		result = await send(foldComments(input.body, comments), []);
	}
	if (result.timedOut)
		throw new FactoryReviewPostUncertainError(
			"GitHub did not answer in time; Factory checks GitHub before posting again.",
		);
	if (result.exitCode !== 0) {
		const line = factoryReviewUntrustedText(
			result.output.split("\n").find((entry) => entry.trim()) ?? "no output",
			200,
		);
		if (CLIENT_ERROR.test(result.output))
			throw new FactoryReviewRefusal(
				"factory_review_github_refused",
				`GitHub refused the review: ${line}`,
			);
		throw new FactoryReviewPostUncertainError(
			`Could not confirm the review was posted: ${line}`,
		);
	}
	const posted = z
		.object({ html_url: z.string().url() })
		.safeParse(safeJson(result.stdout ?? result.output));
	if (!posted.success)
		throw new FactoryReviewPostUncertainError(
			"GitHub's reply did not name the posted review; Factory checks GitHub before posting again.",
		);
	return { url: posted.data.html_url, ...(bodyOnly ? { bodyOnly } : {}) };
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** GitHub's state of a submitted review of each event. */
const SUBMITTED_STATE: Record<FactoryReviewEvent, string> = {
	COMMENT: "COMMENTED",
	APPROVE: "APPROVED",
	REQUEST_CHANGES: "CHANGES_REQUESTED",
};

/**
 * The review a posting intent sent, if GitHub has it: how a post whose reply
 * was lost is recognised instead of repeated. It is the latest review by
 * `viewerLogin` on `headSha` with the intent's event whose body is not
 * empty and has one of the intent's digests (factoryReviewPostDigests);
 * `bodyOnly` when it is the folded body. An empty body would match any
 * review without one, so such a post is never recognised. No local clock is
 * involved.
 */
export async function findFactoryPostedReview(input: {
	workspaceRoot: string;
	pullRequest: FactoryPullRequestReference;
	headSha: string;
	viewerLogin: string;
	event: FactoryReviewEvent;
	digests: { body: string; bodyOnly?: string };
	signal: AbortSignal;
	run?: Command;
}): Promise<{ url: string; bodyOnly?: true } | undefined> {
	const run = input.run ?? runFactoryCommand;
	if (!/^[0-9a-f]{40,64}$/.test(input.headSha))
		throw new Error("Not a commit of the pull request.");
	const result = await run({
		cwd: input.workspaceRoot,
		file: "gh",
		args: [
			"api",
			...factoryGhHostArgs(input.pullRequest.host),
			"--paginate",
			reviewsPath(input.pullRequest),
			"--jq",
			`.[] | select(.commit_id == "${input.headSha}") | {login: .user.login, commit: .commit_id, state: .state, body: .body, url: .html_url}`,
		],
		signal: input.signal,
		timeoutMs: POST_TIMEOUT_MS,
		maxBytes: 4 * 1024 * 1024,
		captureStdout: true,
	});
	if (result.exitCode !== 0 || result.timedOut || result.truncated)
		throw new Error(
			"Factory could not check whether the review was already posted; try again.",
		);
	const entry = z.object({
		login: z.string().nullable(),
		commit: z.string().nullable(),
		state: z.string().nullable(),
		body: z.string().nullable(),
		url: z.string(),
	});
	for (const line of (result.stdout ?? "").split("\n").reverse()) {
		const parsed = entry.safeParse(safeJson(line));
		if (
			!parsed.success ||
			parsed.data.login?.toLowerCase() !== input.viewerLogin.toLowerCase() ||
			parsed.data.commit !== input.headSha ||
			parsed.data.state !== SUBMITTED_STATE[input.event] ||
			!parsed.data.body?.trim()
		)
			continue;
		const digest = bodyDigest(parsed.data.body ?? "");
		if (digest === input.digests.body) return { url: parsed.data.url };
		if (digest === input.digests.bodyOnly)
			return { url: parsed.data.url, bodyOnly: true };
	}
	return undefined;
}
