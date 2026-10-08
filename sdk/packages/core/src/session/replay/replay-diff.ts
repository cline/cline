import { createHash } from "node:crypto";

/**
 * The divergence model shared by the replay source (strict request checks)
 * and the replay comparison (live iteration vs recorded iteration). Both
 * report differences as {@link SessionReplayDivergence} so hosts render one
 * format, and later modes reuse it instead of building another diff.
 */

export const SESSION_REPLAY_DIVERGENCE_KINDS = [
	/** The model id the request was sent to. */
	"request-model",
	"request-system-prompt",
	/** Tool definitions offered to the model (name, description, input schema). */
	"request-tools",
	/** The request's messages, compared by role and content. */
	"request-messages",
	"assistant-text",
	/** Tool calls the model made, by position: name and input. */
	"tool-calls",
	/** Tool results, by position: content and error flag. */
	"tool-results",
	/** Recorded human/host decisions: approvals, prompt delivery, mode, aborts. */
	"decisions",
	/** One side has more iterations than the other. */
	"iteration-count",
] as const;
export type SessionReplayDivergenceKind =
	(typeof SESSION_REPLAY_DIVERGENCE_KINDS)[number];

export const SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS = [
	"request-model",
	"request-system-prompt",
	"request-tools",
	"request-messages",
] as const satisfies readonly SessionReplayDivergenceKind[];

/**
 * `strict`: a request that differs from the recording is a failure that names
 * the iteration and the first difference. `lenient`: the same difference is
 * reported, and the recorded data is served or the comparison completes,
 * without failing.
 */
export const SESSION_REPLAY_STRICTNESS = ["strict", "lenient"] as const;
export type SessionReplayStrictness =
	(typeof SESSION_REPLAY_STRICTNESS)[number];

/** One side of a difference: a content hash plus a short readable excerpt. */
export interface SessionReplayDiffValue {
	/** sha256 of the compared value (message content hash, prompt hash, …). */
	sha256?: string;
	excerpt: string;
}

export interface SessionReplayDiffEntry {
	/** What differs, e.g. `message 3 (user)`, `tool call 1`, `tool run_commands`. */
	label: string;
	change: "added" | "removed" | "changed";
	/** Position within the compared list, when the entry is one list item. */
	index?: number;
	/** First differing location inside the value, e.g. `input.commands[0]`. */
	path?: string;
	recorded?: SessionReplayDiffValue;
	live?: SessionReplayDiffValue;
	/**
	 * Request messages only: the message is an assistant or tool-result
	 * message, so it was produced by an earlier iteration whose own output
	 * comparison already covers the difference.
	 */
	inherited?: boolean;
}

export interface SessionReplayDivergence {
	kind: SessionReplayDivergenceKind;
	/** 1-based session iteration (the playback numbering). */
	iteration: number;
	/** Whether this kind counts under the options it was compared with. */
	counted: boolean;
	/** One line, e.g. `system prompt differs at line 3, column 14`. */
	summary: string;
	entries: SessionReplayDiffEntry[];
	/** Decisions only: before or after the iteration's model call (by `seq`). */
	phase?: "before-model-call" | "after-model-call";
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => (item === undefined ? null : sortKeys(item)));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item !== undefined) out[key] = sortKeys(item);
		}
		return out;
	}
	return value;
}

/** JSON with object keys sorted, so field order never affects comparison. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value)) ?? "null";
}

export function canonicalSha256(value: unknown): string {
	return sha256Hex(canonicalJson(value));
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function joinPath(base: string, key: string | number): string {
	if (typeof key === "number") return `${base}[${key}]`;
	return /^[A-Za-z_$][\w$]*$/.test(key)
		? base
			? `${base}.${key}`
			: key
		: `${base}[${JSON.stringify(key)}]`;
}

/**
 * The first location where two values differ structurally (object key order
 * ignored), with the values found there. Undefined when they are equal.
 */
export function firstStructuralDifference(
	recorded: unknown,
	live: unknown,
	path = "",
): { path: string; recorded: unknown; live: unknown } | undefined {
	if (structurallyEqual(recorded, live)) return undefined;
	if (Array.isArray(recorded) && Array.isArray(live)) {
		const length = Math.max(recorded.length, live.length);
		for (let index = 0; index < length; index += 1) {
			const found = firstStructuralDifference(
				recorded[index],
				live[index],
				joinPath(path, index),
			);
			if (found) return found;
		}
	}
	if (isPlainObject(recorded) && isPlainObject(live)) {
		const keys = [
			...new Set([...Object.keys(recorded), ...Object.keys(live)]),
		].sort();
		for (const key of keys) {
			const found = firstStructuralDifference(
				recorded[key],
				live[key],
				joinPath(path, key),
			);
			if (found) return found;
		}
	}
	return { path, recorded, live };
}

/** Offset, 1-based line and column of the first differing character. */
export function firstTextDifference(
	recorded: string,
	live: string,
): { offset: number; line: number; column: number } | undefined {
	if (recorded === live) return undefined;
	const limit = Math.min(recorded.length, live.length);
	let offset = 0;
	while (offset < limit && recorded[offset] === live[offset]) offset += 1;
	const before = recorded.slice(0, offset);
	const line = before.split("\n").length;
	const column = offset - before.lastIndexOf("\n");
	return { offset, line, column };
}

const EXCERPT_LENGTH = 80;

/** Single-line excerpt, whitespace collapsed and truncated with `…`. */
export function excerptText(text: string, max = EXCERPT_LENGTH): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Excerpt of a value: strings verbatim, anything else as canonical JSON. */
export function excerptValue(value: unknown, max = EXCERPT_LENGTH): string {
	if (value === undefined) return "(absent)";
	return excerptText(
		typeof value === "string" ? JSON.stringify(value) : canonicalJson(value),
		max,
	);
}

/** Excerpt of `text` that starts a little before `offset`. */
export function excerptAround(
	text: string,
	offset: number,
	max = EXCERPT_LENGTH,
): string {
	const start = Math.max(0, offset - 24);
	const window = text.slice(start, start + max * 2);
	const body = excerptText(window, max);
	return `${start > 0 ? "…" : ""}${body}`;
}

/** Text diff entry for long strings (system prompt, assistant text). */
export function textDiffEntry(
	label: string,
	recorded: string,
	live: string,
	hashes: { recorded?: string; live?: string } = {},
): { entry: SessionReplayDiffEntry; position?: string } {
	const difference = firstTextDifference(recorded, live);
	const offset = difference?.offset ?? 0;
	return {
		entry: {
			label,
			change: "changed",
			recorded: {
				...(hashes.recorded ? { sha256: hashes.recorded } : {}),
				excerpt: excerptAround(recorded, offset),
			},
			live: {
				...(hashes.live ? { sha256: hashes.live } : {}),
				excerpt: excerptAround(live, offset),
			},
		},
		...(difference
			? {
					position: `line ${difference.line}, column ${difference.column}`,
				}
			: {}),
	};
}

/**
 * Pairs two keyed lists by longest common subsequence. Unmatched items in
 * the same gap pair up in order (a change); the rest are additions or
 * removals. Falls back to positional pairing for very long lists.
 */
export function alignByKey<T>(
	recorded: readonly T[],
	live: readonly T[],
	key: (item: T) => string,
): Array<{ recorded?: number; live?: number }> {
	const n = recorded.length;
	const m = live.length;
	if (n * m > 4_000_000) {
		return Array.from({ length: Math.max(n, m) }, (_, index) => ({
			...(index < n ? { recorded: index } : {}),
			...(index < m ? { live: index } : {}),
		}));
	}
	const rk = recorded.map(key);
	const lk = live.map(key);
	// table[i * width + j] = LCS length of recorded[i..] and live[j..].
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	const at = (i: number, j: number): number => table[i * width + j] ?? 0;
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			table[i * width + j] =
				rk[i] === lk[j]
					? at(i + 1, j + 1) + 1
					: Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const pairs: Array<{ recorded?: number; live?: number }> = [];
	let gapRecorded: number[] = [];
	let gapLive: number[] = [];
	const flushGap = () => {
		const length = Math.max(gapRecorded.length, gapLive.length);
		for (let index = 0; index < length; index += 1) {
			pairs.push({
				...(index < gapRecorded.length ? { recorded: gapRecorded[index] } : {}),
				...(index < gapLive.length ? { live: gapLive[index] } : {}),
			});
		}
		gapRecorded = [];
		gapLive = [];
	};
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && rk[i] === lk[j]) {
			flushGap();
			pairs.push({ recorded: i, live: j });
			i += 1;
			j += 1;
		} else if (j >= m || (i < n && at(i + 1, j) >= at(i, j + 1))) {
			gapRecorded.push(i);
			i += 1;
		} else {
			gapLive.push(j);
			j += 1;
		}
	}
	flushGap();
	return pairs;
}
