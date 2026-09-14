/**
 * Detects degenerate assistant text loops where the model streams repeated
 * "I'm about to…" / single-token spam instead of emitting tool calls.
 *
 * Observed with DeepSeek V4 Flash (Cline Pass) on long sessions: 100k+ char
 * turns of near-identical "Let me …" lines with zero tool_use.
 */

export interface TextLoopConfig {
	/** Consecutive near-duplicate lines before soft warning. Default 8. */
	softRepeatedLines: number;
	/** Consecutive near-duplicate lines before hard stop. Default 16. */
	hardRepeatedLines: number;
	/** "Let me" / "let me" count soft threshold. Default 12. */
	softLetMeCount: number;
	/** "Let me" / "let me" count hard threshold. Default 24. */
	hardLetMeCount: number;
	/** Repeated identical short token soft threshold. Default 20. */
	softSameToken: number;
	/** Repeated identical short token hard threshold. Default 40. */
	hardSameToken: number;
	/** Minimum accumulated chars before hard checks apply. Default 1500. */
	minCharsForHard: number;
}

export interface TextLoopVerdict {
	kind: "ok" | "soft" | "hard";
	reason?: string;
	repeatedLines?: number;
	letMeCount?: number;
	sameTokenCount?: number;
}

const DEFAULT_CONFIG: TextLoopConfig = {
	softRepeatedLines: 8,
	hardRepeatedLines: 16,
	softLetMeCount: 12,
	hardLetMeCount: 24,
	softSameToken: 20,
	hardSameToken: 40,
	minCharsForHard: 1500,
};

const LET_ME_RE = /\blet me\b/gi;
const SHORT_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]{0,24}[.!]?\s*$/;

export function normalizeLoopLine(line: string): string {
	return line
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.!…]+$/g, "");
}

export function countLetMe(text: string): number {
	const matches = text.match(LET_ME_RE);
	return matches?.length ?? 0;
}

/**
 * Longest trailing run of near-duplicate non-empty lines.
 */
export function trailingRepeatedLineRun(text: string): {
	count: number;
	sample: string;
} {
	const lines = text
		.split(/\r?\n/)
		.map((line) => normalizeLoopLine(line))
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return { count: 0, sample: "" };
	}
	const sample = lines[lines.length - 1] ?? "";
	if (sample.length < 8) {
		// Very short lines handled by same-token detector.
		return { count: 0, sample };
	}
	let count = 1;
	for (let i = lines.length - 2; i >= 0; i -= 1) {
		const prev = lines[i] ?? "";
		if (prev === sample || isNearDuplicate(prev, sample)) {
			count += 1;
		} else {
			break;
		}
	}
	return { count, sample };
}

/**
 * Longest trailing run of identical short tokens (e.g. "Read." spam).
 */
export function trailingSameTokenRun(text: string): {
	count: number;
	sample: string;
} {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return { count: 0, sample: "" };
	}
	const sample = lines[lines.length - 1] ?? "";
	if (!SHORT_TOKEN_RE.test(sample)) {
		return { count: 0, sample: "" };
	}
	const normalized = normalizeLoopLine(sample);
	let count = 1;
	for (let i = lines.length - 2; i >= 0; i -= 1) {
		if (normalizeLoopLine(lines[i] ?? "") === normalized) {
			count += 1;
		} else {
			break;
		}
	}
	return { count, sample };
}

function isNearDuplicate(a: string, b: string): boolean {
	if (a === b) return true;
	if (a.length < 12 || b.length < 12) return false;
	// Prefix collapse: "let me update the themepack doc" vs "... doc and clean up"
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;
	if (longer.startsWith(shorter) && shorter.length / longer.length >= 0.7) {
		return true;
	}
	// Shared stem of first 6 words
	const aw = a.split(" ").slice(0, 6).join(" ");
	const bw = b.split(" ").slice(0, 6).join(" ");
	return aw.length >= 16 && aw === bw;
}

export function inspectAssistantTextLoop(
	text: string,
	config: Partial<TextLoopConfig> = {},
): TextLoopVerdict {
	const cfg: TextLoopConfig = { ...DEFAULT_CONFIG, ...config };
	if (!text || text.length < 200) {
		return { kind: "ok" };
	}

	const letMeCount = countLetMe(text);
	const repeated = trailingRepeatedLineRun(text);
	const sameToken = trailingSameTokenRun(text);

	// Same-token spam is unambiguous even in short buffers.
	if (sameToken.count >= cfg.hardSameToken) {
		return {
			kind: "hard",
			reason: describeLoop({
				repeated,
				letMeCount,
				sameToken,
				level: "hard",
			}),
			repeatedLines: repeated.count,
			letMeCount,
			sameTokenCount: sameToken.count,
		};
	}

	const hardEligible = text.length >= cfg.minCharsForHard;
	if (
		hardEligible &&
		(repeated.count >= cfg.hardRepeatedLines ||
			letMeCount >= cfg.hardLetMeCount)
	) {
		return {
			kind: "hard",
			reason: describeLoop({
				repeated,
				letMeCount,
				sameToken,
				level: "hard",
			}),
			repeatedLines: repeated.count,
			letMeCount,
			sameTokenCount: sameToken.count,
		};
	}

	if (
		repeated.count >= cfg.softRepeatedLines ||
		letMeCount >= cfg.softLetMeCount ||
		sameToken.count >= cfg.softSameToken
	) {
		return {
			kind: "soft",
			reason: describeLoop({
				repeated,
				letMeCount,
				sameToken,
				level: "soft",
			}),
			repeatedLines: repeated.count,
			letMeCount,
			sameTokenCount: sameToken.count,
		};
	}

	return {
		kind: "ok",
		repeatedLines: repeated.count,
		letMeCount,
		sameTokenCount: sameToken.count,
	};
}

function describeLoop(input: {
	repeated: { count: number; sample: string };
	letMeCount: number;
	sameToken: { count: number; sample: string };
	level: "soft" | "hard";
}): string {
	const parts: string[] = [];
	if (input.repeated.count > 0) {
		parts.push(
			`${input.repeated.count} repeated lines (e.g. "${input.repeated.sample.slice(0, 60)}")`,
		);
	}
	if (input.letMeCount > 0) {
		parts.push(`${input.letMeCount}× "let me"`);
	}
	if (input.sameToken.count > 0) {
		parts.push(
			`${input.sameToken.count}× token "${input.sameToken.sample}"`,
		);
	}
	return `Assistant text ${input.level} loop detected: ${parts.join("; ")}`;
}

export const TEXT_LOOP_RECOVERY_GUIDANCE = [
	"[SYSTEM] You entered a text-only loop (repeated 'Let me…' / identical lines) without emitting a tool call.",
	"Stop narrating intent. Immediately call exactly one concrete tool (run_commands, read_files, editor, etc.) to make progress.",
	"Do not repeat prior sentences. Do not apologize. Tool call now.",
].join(" ");

export const TEXT_LOOP_ABORT_MESSAGE =
	"Stopped streaming: assistant text loop detected (repeated intent text with no tool call).";
