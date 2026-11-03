/**
 * Chat timeline.
 *
 * Only two kinds of rows carry the actual conversation: the user's prompts (`task`,
 * `user_feedback`) and the agent's final answers (`completion_result`,
 * `plan_completion_result` — including the ones this fork retags when rehydrating a
 * session). Everything else is agent bookkeeping and is deliberately absent from the
 * timeline, which is what makes the rail useful for jumping around a long task.
 *
 * Timestamps are the only thing this module needs from the message list, so both
 * durations come for free: an answer took `answer.ts - prompt.ts`, and the typing time of
 * a prompt is recorded separately in {@link ./promptTimings} because nothing in the
 * transcript knows when the user started typing.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { type ChatListItem, isTurnBoundaryMessage } from "./activityFolding"

export type TimelineMarkerKind = "prompt" | "answer"

export interface TimelineMarker {
	ts: number
	kind: TimelineMarkerKind
	/** Single-line label, at most {@link TIMELINE_SUMMARY_MAX_CHARS} characters. */
	summary: string
	/** Position within the rendered (folded) list — what the rail scales itself by. */
	listIndex: number
}

/** One prompt with the answer that concluded it; either side can be missing. */
export interface TimelineTurn {
	prompt?: TimelineMarker
	answer?: TimelineMarker
}

export const TIMELINE_SUMMARY_MAX_CHARS = 30

const PROMPT_TAGS = new Set(["task", "user_feedback"])
const ANSWER_TAGS = new Set(["completion_result", "plan_completion_result"])

/** Which timeline role a row plays, if any. */
export function timelineKindOf(message: ClineMessage): TimelineMarkerKind | undefined {
	const tag = message.say ?? message.ask
	if (!tag) {
		return undefined
	}
	if (PROMPT_TAGS.has(tag)) {
		return "prompt"
	}
	return ANSWER_TAGS.has(tag) ? "answer" : undefined
}

/**
 * Collapse a message body into a short single-line label.
 *
 * Strips fenced code, tag-like wrappers (the fork's prompts arrive as
 * `<user_input mode="…">…</user_input>`), markdown links and emphasis, then keeps the first
 * sentence and truncates on a word boundary.
 */
export function summarizeTimelineText(raw: string, maxChars = TIMELINE_SUMMARY_MAX_CHARS): string {
	const plain = raw
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`>#|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
	if (!plain) {
		return ""
	}

	// First sentence, but never before the first character (so "1.5 GB" survives).
	let sentence = plain
	for (const stop of [". ", "! ", "? "]) {
		const index = plain.indexOf(stop)
		if (index > 0 && index + 1 < sentence.length) {
			sentence = plain.slice(0, index + 1)
		}
	}

	if (sentence.length <= maxChars) {
		return sentence
	}
	const cut = sentence.slice(0, maxChars + 1)
	const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("-"))
	// Only honour the boundary when it keeps a useful amount of text.
	const head = boundary >= Math.ceil(maxChars * 0.6) ? cut.slice(0, boundary) : cut.slice(0, maxChars)
	return `${head.replace(/[\s,.:;]$/g, "")}…`
}

/** Markers for the rendered list, in reading order. Folds are skipped: they hold bookkeeping. */
export function collectTimelineMarkers(
	list: ChatListItem[],
	summarize: (text: string) => string = summarizeTimelineText,
): TimelineMarker[] {
	const markers: TimelineMarker[] = []
	list.forEach((item, listIndex) => {
		if (Array.isArray(item)) {
			return
		}
		const kind = timelineKindOf(item)
		if (!kind) {
			return
		}
		const summary = summarize(item.text ?? "")
		if (!summary) {
			return
		}
		markers.push({ ts: item.ts, kind, summary, listIndex })
	})
	return markers
}

/**
 * Pair each prompt with the answer that concluded it. A prompt without a following answer is a
 * turn still running (or one that ended on an error); an answer with no preceding prompt is a
 * continuation of the very first task, which has no prompt row of its own.
 */
export function groupIntoTurns(markers: TimelineMarker[]): TimelineTurn[] {
	const turns: TimelineTurn[] = []
	for (const marker of markers) {
		if (marker.kind === "prompt") {
			turns.push({ prompt: marker })
			continue
		}
		const current = turns[turns.length - 1]
		// An answer with no open turn starts one of its own, so it never gets lost.
		if (!current || current.answer) {
			turns.push({ answer: marker })
			continue
		}
		current.answer = marker
	}
	return turns
}

/** Wall-clock distance to `ts`, as `-45s`, `-1m`, `-12m`, `-1h`, `-2d`. */
export function formatTimeAgo(ts: number, now: number): string {
	if (typeof ts !== "number" || !Number.isFinite(ts)) {
		return ""
	}
	const seconds = Math.floor((now - ts) / 1000)
	// A distance beyond ten years means the timestamp is not a wall-clock time at all (a restored
	// row carrying 0, for instance) — better to show nothing than a confident "-20760d".
	if (seconds > 10 * 365 * 24 * 3600) {
		return ""
	}
	if (seconds < 1) {
		return "now"
	}
	if (seconds < 60) {
		return `-${seconds}s`
	}
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return `-${minutes}m`
	}
	const hours = Math.floor(minutes / 60)
	if (hours < 24) {
		return `-${hours}h`
	}
	return `-${Math.floor(hours / 24)}d`
}

/** A duration without a sign: `42s`, `3m 07s`, `1h 04m`. Empty for nonsense input. */
export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return ""
	}
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) {
		return `${seconds}s`
	}
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
	}
	const hours = Math.floor(minutes / 60)
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

/**
 * Recovers which option the user picked on a question row.
 *
 * The backend keeps `selected` on the ask message while a task is live, but the SDK translator
 * never writes it back when rehydrating (`selected` appears nowhere in `message-translator.ts`),
 * so after a reload the row no longer knows what was chosen. The answer itself *is* persisted:
 * picking an option submits it verbatim as the next user message. Matching that against the
 * option list therefore recovers the selection exactly rather than guessing at it.
 */
export function resolveSelectedOption(
	messages: ClineMessage[],
	questionTs: number,
	options: string[] | undefined,
): string | undefined {
	if (!options?.length) {
		return undefined
	}
	const index = messages.findIndex((message) => message.ts === questionTs)
	if (index === -1) {
		return undefined
	}
	for (const message of messages.slice(index + 1)) {
		// The first user-authored row after the question is its answer; anything later belongs to
		// a following exchange and must not be attributed to this one.
		if (!isTurnBoundaryMessage(message)) {
			continue
		}
		const answer = message.text?.trim() ?? ""
		// An option chosen while the input still held text is submitted as `option: extra`.
		return options.find((option) => {
			const wanted = option.trim()
			return answer === wanted || answer.startsWith(`${wanted}:`)
		})
	}
	return undefined
}

/**
 * Answer duration for the timeline preview: whole minutes, and nothing below one minute.
 *
 * A turn that finished in a few seconds carries no information worth a label, and showing `0s`
 * for it read as a bug. Rounding to minutes keeps the preview quiet about fast answers.
 */
export function formatDurationMinutes(ms: number): string {
	if (!Number.isFinite(ms) || ms < 60_000) {
		return ""
	}
	return `${Math.round(ms / 60_000)}m`
}

/**
 * Rail position per marker, as a 0..1 fraction of the scrollable range.
 *
 * Only rows that virtuoso currently renders can be measured, so the measured anchors are filled
 * in by interpolating along `listIndex` and clamped at both ends. Positions therefore agree with
 * the scrollbar thumb instead of an index-share guess, which drifted badly because folded rows are
 * far shorter than answers.
 *
 * With no anchors at all (nothing measured yet) the markers are spread evenly. Returning 0 for
 * every marker would stack them all on one spot and read as "the markers disappeared".
 */
export function interpolateRatios(
	markers: Array<Pick<TimelineMarker, "listIndex">>,
	anchors: Array<{ listIndex: number; ratio: number }>,
): number[] {
	const count = markers.length
	if (count === 0) {
		return []
	}
	const sorted = [...anchors].sort((a, b) => a.listIndex - b.listIndex)
	if (sorted.length === 0) {
		return markers.map((_, order) => (count > 1 ? order / (count - 1) : 0))
	}
	return markers.map(({ listIndex }) => {
		const exact = sorted.find((anchor) => anchor.listIndex === listIndex)
		if (exact) {
			return clamp01(exact.ratio)
		}
		let before: (typeof sorted)[number] | undefined
		let after: (typeof sorted)[number] | undefined
		for (const anchor of sorted) {
			if (anchor.listIndex < listIndex) {
				before = anchor
			} else if (anchor.listIndex > listIndex && !after) {
				after = anchor
			}
		}
		// Outside the measured range, hold the nearest known position.
		if (!before) {
			return clamp01((after as { ratio: number }).ratio)
		}
		if (!after) {
			return clamp01(before.ratio)
		}
		const span = after.listIndex - before.listIndex
		const weight = span <= 0 ? 0 : (listIndex - before.listIndex) / span
		return clamp01(before.ratio + (after.ratio - before.ratio) * weight)
	})
}

/** Index of the entry whose position is nearest the given fraction; `-1` when there is none. */
export function nearestByRatio(positions: number[], ratio: number): number {
	if (positions.length === 0) {
		return -1
	}
	const target = clamp01(ratio)
	let best = 0
	let bestDistance = Number.POSITIVE_INFINITY
	positions.forEach((position, index) => {
		const distance = Math.abs(position - target)
		if (distance < bestDistance) {
			bestDistance = distance
			best = index
		}
	})
	return best
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0
	}
	return Math.min(Math.max(value, 0), 1)
}

/**
 * The element that actually scrolls the conversation.
 *
 * `scrollContainerRef` points at the layout wrapper around the virtualised list, which never
 * scrolls itself — its `scrollHeight` equals its `clientHeight`. Anything that needs real scroll
 * geometry (rail positions, the highlighted tick, collapse anchoring) has to measure the
 * virtualiser's own scroller, which is the element carrying `.chat-scrollbar`.
 */
export function resolveChatScroller(candidate: HTMLElement | null): HTMLElement | null {
	if (!candidate) {
		return null
	}
	if (candidate.classList.contains("chat-scrollbar")) {
		return candidate
	}
	// Ancestor first (the wrapper around the list), then a descendant, and finally the candidate
	// itself so callers always get a real element to reason about.
	return (
		candidate.closest<HTMLElement>(".chat-scrollbar") ?? candidate.querySelector<HTMLElement>(".chat-scrollbar") ?? candidate
	)
}
