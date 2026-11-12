import type { FactoryReview } from "@cline/shared";
import { factoryEvidenceCell } from "./factory-evidence";

/*
 * Pure assembly of a draft GitHub review from Factory reviewer results.
 * Nothing here posts: posting is a separate, user-clicked command that
 * re-checks the head (see factoryReviewDraftStale). Reviewer text is model
 * output about untrusted code, so every piece goes through the same cell
 * rules as the PR evidence section (no links, images, HTML, mentions or
 * issue references) and is bounded.
 *
 * The review `locations` field and these draft types are local until the
 * route contract lands in @cline/shared.
 */

/** A finding a reviewer pinned to a line of the PR's new version. */
export interface FactoryReviewLocation {
	path: string;
	line: number;
	body: string;
}

/** A reviewer's output: the shared review shape plus optional locations. */
export type FactoryReviewWithLocations = Pick<
	FactoryReview,
	"verdict" | "summary" | "findings"
> & { locations?: FactoryReviewLocation[] };

export interface FactoryReviewDraftReviewer {
	reviewerIndex: number;
	/** Shown in the body and comments; defaults to `Reviewer <n>`. */
	label?: string;
	review: FactoryReviewWithLocations;
}

/** A file in the PR, with the new-side line ranges its diff covers. */
export interface FactoryReviewDiffFile {
	path: string;
	/** Inclusive new-side line ranges; absent means any line of the file. */
	ranges?: { start: number; end: number }[];
}

export type FactoryReviewDraftVerdict =
	| "comment"
	| "request_changes"
	| "approve_suggested";

export interface FactoryReviewDraftComment {
	path: string;
	line: number;
	body: string;
	reviewers: string[];
}

export type FactoryReviewDraftDropReason =
	| "duplicate"
	| "limit"
	| "invalid_location"
	| "empty";

export interface FactoryReviewDraft {
	headSha: string;
	verdict: FactoryReviewDraftVerdict;
	body: string;
	comments: FactoryReviewDraftComment[];
	dropped: { reason: FactoryReviewDraftDropReason; text: string }[];
}

export const FACTORY_REVIEW_DRAFT_LIMITS = {
	comments: 30,
	bodyFindings: 25,
	commentChars: 1500,
	findingChars: 600,
	summaryChars: 400,
	bodyChars: 60_000,
	droppedText: 200,
} as const;

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

const shortSha = (sha: string) => sha.slice(0, 12);
const cleanSha = (sha: string) => sha.replace(/[^0-9a-f]/gi, "").toLowerCase();

interface MergedComment {
	path: string;
	line: number;
	bodies: string[];
	reviewers: string[];
}

interface MergedFinding {
	text: string;
	reviewers: string[];
}

function addReviewer(list: string[], reviewer: string) {
	if (!list.includes(reviewer)) list.push(reviewer);
}

/**
 * A draft review of `headSha` from reviewer results. Duplicate findings
 * across reviewers (same path and line, or near-identical text) are merged
 * and credited to every reviewer who raised them. A location becomes an
 * inline comment only when `files` lists its path (and, with ranges, a
 * covered line); otherwise it goes into the body. Counts and lengths are
 * capped; what was left out is listed in `dropped`. The verdict never
 * approves: `approve_suggested` only when every reviewer passed with no
 * findings, and the UI still defaults to posting a comment.
 */
export function assembleFactoryReviewDraft(input: {
	headSha: string;
	reviewers: readonly FactoryReviewDraftReviewer[];
	files?: readonly FactoryReviewDiffFile[];
}): FactoryReviewDraft {
	const limits = FACTORY_REVIEW_DRAFT_LIMITS;
	const headSha = cleanSha(input.headSha);
	const dropped: FactoryReviewDraft["dropped"] = [];
	const drop = (reason: FactoryReviewDraftDropReason, text: string) =>
		dropped.push({
			reason,
			text: factoryEvidenceCell(text, limits.droppedText),
		});
	const diff = new Map<string, FactoryReviewDiffFile>();
	for (const file of input.files ?? []) {
		const path = cleanPath(file.path);
		if (path) diff.set(path, file);
	}
	const label = (reviewer: FactoryReviewDraftReviewer) =>
		factoryEvidenceCell(
			reviewer.label ?? `Reviewer ${reviewer.reviewerIndex + 1}`,
			60,
		);

	const located: MergedComment[] = [];
	const findings: MergedFinding[] = [];
	const addFinding = (text: string, reviewer: string) => {
		const existing = findings.find((entry) => nearlySame(entry.text, text));
		if (existing) {
			addReviewer(existing.reviewers, reviewer);
			drop("duplicate", text);
			return;
		}
		findings.push({ text, reviewers: [reviewer] });
	};

	for (const reviewer of input.reviewers) {
		const name = label(reviewer);
		for (const location of reviewer.review.locations ?? []) {
			const path = cleanPath(location.path);
			const body = location.body.trim();
			if (!body) {
				drop("empty", `${location.path}:${location.line}`);
				continue;
			}
			if (!path || !Number.isSafeInteger(location.line) || location.line < 1) {
				drop("invalid_location", `${location.path}:${location.line} ${body}`);
				continue;
			}
			const existing =
				located.find(
					(entry) => entry.path === path && entry.line === location.line,
				) ??
				located.find(
					(entry) =>
						entry.path === path &&
						entry.bodies.some((text) => nearlySame(text, body)),
				);
			if (existing) {
				addReviewer(existing.reviewers, name);
				if (existing.bodies.some((text) => nearlySame(text, body)))
					drop("duplicate", body);
				else existing.bodies.push(body);
				continue;
			}
			located.push({
				path,
				line: location.line,
				bodies: [body],
				reviewers: [name],
			});
		}
	}
	for (const reviewer of input.reviewers) {
		const name = label(reviewer);
		for (const raw of reviewer.review.findings) {
			const text = raw.trim();
			if (!text) continue;
			// A finding repeated as a location is already said inline.
			const pinned = located.find((entry) =>
				entry.bodies.some((body) => nearlySame(body, text)),
			);
			if (pinned) {
				addReviewer(pinned.reviewers, name);
				drop("duplicate", text);
				continue;
			}
			addFinding(text, name);
		}
	}

	const inDiff = (entry: MergedComment) => {
		const file = diff.get(entry.path);
		if (!file) return false;
		if (!file.ranges) return true;
		return file.ranges.some(
			(range) => entry.line >= range.start && entry.line <= range.end,
		);
	};
	const comments: FactoryReviewDraftComment[] = [];
	const outside: MergedComment[] = [];
	for (const entry of located) {
		if (!inDiff(entry)) {
			outside.push(entry);
			continue;
		}
		if (comments.length >= limits.comments) {
			outside.push(entry);
			continue;
		}
		comments.push({
			path: entry.path,
			line: entry.line,
			body: entry.bodies
				.map((body) => factoryEvidenceCell(body, limits.commentChars))
				.join("\n\n"),
			reviewers: entry.reviewers,
		});
	}

	const anyChanges = input.reviewers.some(
		(reviewer) => reviewer.review.verdict === "changes_requested",
	);
	const anyFindings = findings.length + located.length > 0;
	const verdict: FactoryReviewDraftVerdict = anyChanges
		? "request_changes"
		: input.reviewers.length > 0 && !anyFindings
			? "approve_suggested"
			: "comment";

	const credit = (reviewers: string[]) => ` (${reviewers.join(", ")})`;
	const bodyItems = [
		...findings.map(
			(entry) =>
				`- ${factoryEvidenceCell(entry.text, limits.findingChars)}${credit(entry.reviewers)}`,
		),
		...outside.map(
			(entry) =>
				`- ${factoryEvidenceCell(`${entry.path}:${entry.line}`, 200)}: ${entry.bodies
					.map((body) => factoryEvidenceCell(body, limits.findingChars))
					.join(" / ")}${credit(entry.reviewers)}`,
		),
	];
	const shownItems = bodyItems.slice(0, limits.bodyFindings);
	for (const item of bodyItems.slice(limits.bodyFindings)) drop("limit", item);

	const verdictLine = {
		request_changes: "Factory reviewers requested changes.",
		comment: "Factory reviewers passed this change with comments.",
		approve_suggested:
			"Factory reviewers found no issues. Approval is a suggestion; a person decides.",
	}[verdict];
	const summaries = input.reviewers.map(
		(reviewer) =>
			`- ${label(reviewer)}: ${reviewer.review.verdict === "pass" ? "pass" : "changes requested"}. ${factoryEvidenceCell(reviewer.review.summary, limits.summaryChars)}`,
	);
	const ran = input.reviewers.map(label);
	const footer = `<sub>Draft by Cline Factory: ${ran.length ? ran.join(", ") : "no reviewers"} reviewed commit ${headSha ? `\`${shortSha(headSha)}\`` : "(unknown)"}.</sub>`;

	const build = (items: string[], omitted: number) => {
		const lines = [verdictLine];
		if (summaries.length) lines.push("", "### Reviewers", "", ...summaries);
		if (items.length || omitted) lines.push("", "### Findings", "", ...items);
		if (omitted)
			lines.push(
				`- ${omitted} more ${omitted === 1 ? "finding" : "findings"} in Factory`,
			);
		lines.push("", "---", footer);
		return lines.join("\n");
	};
	let kept = shownItems;
	let omitted = bodyItems.length - shownItems.length;
	let body = build(kept, omitted);
	while (body.length > limits.bodyChars && kept.length) {
		const last = kept.at(-1);
		kept = kept.slice(0, -1);
		omitted++;
		if (last) drop("limit", last);
		body = build(kept, omitted);
	}
	if (body.length > limits.bodyChars)
		body = `${body.slice(0, limits.bodyChars - footer.length - 2)}\n\n${footer}`;

	return { headSha, verdict, body, comments, dropped };
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
