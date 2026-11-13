import {
	FACTORY_REVIEW_DRAFT_LIMITS,
	FACTORY_REVIEW_SEVERITIES,
	type FactoryReviewDraft,
	factoryReviewInertMarkdown,
	parseFactoryJson,
} from "@cline/shared";
import { z } from "zod";

/*
 * Pure assembly of a draft GitHub review from Factory reviewer results.
 * Nothing here posts: posting is a separate, person-only command that
 * re-checks the head (see factoryReviewDraftStale). Reviewer text is model
 * output about untrusted code: each piece is put on one line and bounded,
 * and every text Factory stores or posts is made inert
 * (factoryReviewInertMarkdown) as a whole, as it will be posted.
 */

/** What one reviewer of a pull request returns. */
export const factoryPullRequestReviewSchema = z.object({
	verdict: z.enum(["comment", "approve", "request_changes"]),
	summary: z.string().trim().min(1).max(4_000),
	comments: z
		.array(
			z.object({
				path: z.string().max(2_000),
				line: z.number(),
				severity: z.enum(FACTORY_REVIEW_SEVERITIES),
				body: z.string().max(10_000),
			}),
		)
		.max(50)
		.default([]),
	findings: z.array(z.string().max(10_000)).max(50).default([]),
	questions: z.array(z.string().max(4_000)).max(20).default([]),
	notChecked: z.array(z.string().max(4_000)).max(20).default([]),
});
export type FactoryPullRequestReview = z.infer<
	typeof factoryPullRequestReviewSchema
>;

/** A reviewer's final answer, or a thrown error that names what is wrong. */
export function parseFactoryPullRequestReview(
	text: string,
): FactoryPullRequestReview {
	return factoryPullRequestReviewSchema.parse(parseFactoryJson(text));
}

export interface FactoryReviewDraftReviewer {
	reviewerIndex: number;
	/** Shown on the card; defaults to `Reviewer <n>`. */
	label?: string;
	sessionId?: string;
	/** Absent when the reviewer did not finish; `error` says why. */
	review?: FactoryPullRequestReview;
	error?: string;
}

/** A file in the PR, with the new-side line ranges its diff covers. */
export interface FactoryReviewDiffFile {
	path: string;
	/** Inclusive new-side line ranges (added and context lines of its hunks). */
	ranges: { start: number; end: number }[];
}

type DraftComment = FactoryReviewDraft["comments"][number];
type DropReason = FactoryReviewDraft["dropped"][number]["reason"];

const limits = FACTORY_REVIEW_DRAFT_LIMITS;
const MAX_PATH = 1024;
const SIMILARITY = 0.85;

function normalizedWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** Same words, or nearly (Jaccard ≥ 0.85 over word sets of 4+ words). */
function nearlySame(a: string, b: string): boolean {
	const left = normalizedWords(a);
	const right = normalizedWords(b);
	if (left.join(" ") === right.join(" ")) return true;
	if (left.length < 4 || right.length < 4) return false;
	const setA = new Set(left);
	const setB = new Set(right);
	let shared = 0;
	for (const word of setA) if (setB.has(word)) shared++;
	return shared / (setA.size + setB.size - shared) >= SIMILARITY;
}

/** A repository-relative path, or undefined when it cannot be one. */
function cleanPath(path: string): string | undefined {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point.
	if (/[\u0000-\u001f\u007f]/.test(path)) return undefined;
	const trimmed = path.trim().replace(/^\.\//, "");
	if (
		!trimmed ||
		trimmed.length > MAX_PATH ||
		trimmed.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(trimmed) ||
		trimmed.split(/[\\/]/).includes("..")
	)
		return undefined;
	return trimmed;
}

const cleanSha = (sha: string) => sha.replace(/[^0-9a-f]/gi, "").toLowerCase();

/** `text` on one line, cut to `max` characters. */
function line(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** factoryReviewInertMarkdown of `text`, cut until it fits `max`. */
function inert(text: string, max: number): string {
	const render = (budget: number) =>
		factoryReviewInertMarkdown(
			text.length > budget ? `${text.slice(0, budget - 1)}…` : text,
		);
	let budget = max;
	let out = render(budget);
	while (out.length > max && budget > 1) {
		budget = Math.max(1, Math.floor((budget * max) / out.length) - 1);
		out = render(budget);
	}
	return out;
}

/** One stored piece of reviewer text: one line, inert, within `max`. */
const piece = (text: string, max: number) => inert(line(text, max), max);

const severityRank = (severity: DraftComment["severity"]) =>
	FACTORY_REVIEW_SEVERITIES.indexOf(severity);

function addReviewer(list: string[], reviewer: string) {
	if (!list.includes(reviewer)) list.push(reviewer);
}

/**
 * The files a unified diff changes, each with the new-side line ranges its
 * hunks cover; deleted files are left out. Paths come from each file
 * header's `+++ b/` line (never from a hunk's added line), so a comment can
 * anchor only where GitHub accepts one.
 */
export function factoryReviewDiffFiles(diff: string): FactoryReviewDiffFile[] {
	const files: FactoryReviewDiffFile[] = [];
	let current: FactoryReviewDiffFile | undefined;
	// Between a `diff --git` line and its first hunk; hunk lines never start
	// with `diff --git`, so an added line cannot open a header.
	let header = false;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			current = undefined;
			header = true;
			continue;
		}
		if (line.startsWith("@@")) header = false;
		if (header && line.startsWith("+++ ")) {
			const target = line.slice(4).trim().replace(/^"|"$/g, "");
			const path = target.startsWith("b/")
				? cleanPath(target.slice(2))
				: undefined;
			current = path ? { path, ranges: [] } : undefined;
			if (current) files.push(current);
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk && current) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			if (count > 0) current.ranges.push({ start, end: start + count - 1 });
		}
	}
	return files;
}

interface MergedComment {
	path: string;
	line: number;
	severity: DraftComment["severity"];
	bodies: string[];
	reviewers: string[];
}

/**
 * A draft review of `headSha` from the reviewers' results. Duplicates across
 * reviewers (same path and line, or near-identical text) are merged and
 * credited to each reviewer who raised them, at the highest severity. A
 * comment stays inline only on a line `files` covers; otherwise it becomes a
 * finding in the body. Counts and lengths are capped and what was left out
 * is listed in `dropped`. The verdict is a suggestion: `request_changes` when
 * any reviewer asked for changes, `approve_suggested` only when every
 * reviewer approved and nothing was found. Failed reviewers are recorded as
 * such; the body carries no attribution.
 */
export function assembleFactoryReviewDraft(input: {
	headSha: string;
	reviewers: readonly FactoryReviewDraftReviewer[];
	files: readonly FactoryReviewDiffFile[];
	createdAt?: string;
}): FactoryReviewDraft {
	const dropped: FactoryReviewDraft["dropped"] = [];
	const drop = (reason: DropReason, text: string) =>
		dropped.push({ reason, text: piece(text, limits.droppedText) });
	const diff = new Map(input.files.map((file) => [file.path, file]));
	const label = (reviewer: FactoryReviewDraftReviewer) =>
		piece(reviewer.label ?? `Reviewer ${reviewer.reviewerIndex + 1}`, 60);
	const finished = input.reviewers.flatMap((reviewer) =>
		reviewer.review ? [{ ...reviewer, review: reviewer.review }] : [],
	);

	const located: MergedComment[] = [];
	for (const reviewer of finished) {
		const name = label(reviewer);
		for (const comment of reviewer.review.comments) {
			const path = cleanPath(comment.path);
			const body = comment.body.trim();
			if (!body) {
				drop("empty", `${comment.path}:${comment.line}`);
				continue;
			}
			if (!path || !Number.isSafeInteger(comment.line) || comment.line < 1) {
				drop("invalid_location", `${comment.path}:${comment.line} ${body}`);
				continue;
			}
			const existing =
				located.find(
					(entry) => entry.path === path && entry.line === comment.line,
				) ??
				located.find(
					(entry) =>
						entry.path === path &&
						entry.bodies.some((text) => nearlySame(text, body)),
				);
			if (!existing) {
				located.push({
					path,
					line: comment.line,
					severity: comment.severity,
					bodies: [body],
					reviewers: [name],
				});
				continue;
			}
			addReviewer(existing.reviewers, name);
			if (severityRank(comment.severity) < severityRank(existing.severity))
				existing.severity = comment.severity;
			if (existing.bodies.some((text) => nearlySame(text, body)))
				drop("duplicate", body);
			else existing.bodies.push(body);
		}
	}

	const findings: { text: string; reviewers: string[] }[] = [];
	for (const reviewer of finished) {
		const name = label(reviewer);
		for (const raw of reviewer.review.findings) {
			const text = raw.trim();
			if (!text) continue;
			// A finding repeated as a comment is already said inline.
			const said =
				located.find((entry) =>
					entry.bodies.some((body) => nearlySame(body, text)),
				) ?? findings.find((entry) => nearlySame(entry.text, text));
			if (said) {
				addReviewer(said.reviewers, name);
				drop("duplicate", text);
				continue;
			}
			findings.push({ text, reviewers: [name] });
		}
	}

	const inDiff = (entry: MergedComment) =>
		diff
			.get(entry.path)
			?.ranges.some(
				(range) => entry.line >= range.start && entry.line <= range.end,
			) ?? false;
	const comments: DraftComment[] = [];
	// Most severe first, so the limit keeps what matters.
	for (const entry of [...located].sort(
		(a, b) => severityRank(a.severity) - severityRank(b.severity),
	)) {
		const outside = `${entry.path}:${entry.line}: ${entry.bodies.join(" / ")}`;
		if (!inDiff(entry) || comments.length >= limits.comments) {
			findings.push({ text: outside, reviewers: entry.reviewers });
			continue;
		}
		const share = Math.floor(limits.commentChars / entry.bodies.length) - 2;
		comments.push({
			id: `c${comments.length + 1}`,
			path: entry.path,
			line: entry.line,
			side: "RIGHT",
			severity: entry.severity,
			body: inert(
				entry.bodies.map((body) => line(body, share)).join("\n\n"),
				limits.commentChars,
			),
			reviewers: entry.reviewers,
		});
	}
	const keptFindings = findings.slice(0, limits.bodyFindings);
	for (const entry of findings.slice(limits.bodyFindings))
		drop("limit", entry.text);
	const listed = (pick: (review: FactoryPullRequestReview) => string[]) => {
		const items: string[] = [];
		for (const reviewer of finished)
			for (const raw of pick(reviewer.review)) {
				const text = raw.trim();
				if (!text || items.some((item) => nearlySame(item, text))) continue;
				if (items.length >= limits.listItems) drop("limit", text);
				else items.push(line(text, limits.listItemChars));
			}
		return items;
	};
	const questions = listed((review) => review.questions);
	const notChecked = listed((review) => review.notChecked);

	const verdicts = finished.map((reviewer) => reviewer.review.verdict);
	const verdict: FactoryReviewDraft["verdict"] = verdicts.includes(
		"request_changes",
	)
		? "request_changes"
		: verdicts.length > 0 &&
				verdicts.every((entry) => entry === "approve") &&
				!located.length &&
				!findings.length
			? "approve_suggested"
			: "comment";

	const summaries = [
		...new Set(
			finished.map((reviewer) =>
				line(reviewer.review.summary, limits.summaryChars),
			),
		),
	];
	const findingItems = keptFindings.map(
		(entry) => `- ${line(entry.text, limits.findingChars)}`,
	);
	const build = (items: string[]) => {
		const lines = summaries.flatMap((summary, index) =>
			index ? ["", summary] : [summary],
		);
		if (items.length) lines.push("", "**Findings**", "", ...items);
		if (questions.length)
			lines.push(
				"",
				"**Questions**",
				"",
				...questions.map((question) => `- ${question}`),
			);
		return lines.join("\n").trim();
	};
	let kept = findingItems;
	while (
		factoryReviewInertMarkdown(build(kept)).length > limits.bodyChars &&
		kept.length
	) {
		const last = kept.at(-1);
		kept = kept.slice(0, -1);
		if (last) drop("limit", last);
	}

	return {
		schemaVersion: 1,
		headSha: cleanSha(input.headSha),
		createdAt: input.createdAt ?? new Date().toISOString(),
		verdict,
		body: inert(build(kept), limits.bodyChars),
		comments,
		findings: keptFindings.map((entry) => ({
			text: piece(entry.text, limits.findingChars),
			reviewers: entry.reviewers,
		})),
		questions: questions.map((item) => inert(item, limits.listItemChars)),
		notChecked: notChecked.map((item) => inert(item, limits.listItemChars)),
		reviewers: input.reviewers.map((reviewer) => ({
			reviewerIndex: reviewer.reviewerIndex,
			label: label(reviewer),
			...(reviewer.sessionId ? { sessionId: reviewer.sessionId } : {}),
			...(reviewer.review
				? {
						verdict: reviewer.review.verdict,
						summary: piece(reviewer.review.summary, limits.summaryChars),
					}
				: {
						summary: piece(
							`Did not finish: ${reviewer.error ?? "no result"}`,
							limits.summaryChars,
						),
						failed: true as const,
					}),
		})),
		dropped: dropped.slice(0, 500),
	};
}

/** True when the draft no longer describes the PR's current head. */
export function factoryReviewDraftStale(
	draft: Pick<FactoryReviewDraft, "headSha">,
	currentHeadSha: string,
): boolean {
	const draftSha = cleanSha(draft.headSha);
	const current = cleanSha(currentHeadSha);
	return !draftSha || !current || draftSha !== current;
}
