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
	/**
	 * When the row happened, in epoch milliseconds — {@link clockOfMessage}. Undefined when the
	 * transcript cannot say, and then the marker carries no time at all rather than a wrong one.
	 */
	clock?: number
	kind: TimelineMarkerKind
	/** Single-line label, at most {@link TIMELINE_SUMMARY_MAX_CHARS} characters. */
	summary: string
	/** Position within the rendered (folded) list — what the rail scales itself by. */
	listIndex: number
}

/**
 * Whether a number can be read as an epoch in milliseconds.
 *
 * `ClineMessage.ts` is an identity counter, not a clock: `MessageIdMinter` hands out 1, 2, 3 …, so
 * the newest row of a resumed session used to render as "Jan 1, 1970 01:00". The floor is
 * 2001-09-09 and the ceiling is far enough out that no counter reaches it.
 */
export function isPlausibleTimestamp(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 1e12 && value <= 1e14
}

/**
 * The row's wall clock, or undefined when the transcript cannot say when it happened.
 *
 * Prefers `createdAt` — the extension's own clock: the transcript entry's time for restored rows,
 * the mint moment for live ones. `ts` is only trusted when it really is a clock, which is how the
 * classic path behaved before ids became counters.
 */
export function clockOfMessage(message: Pick<ClineMessage, "ts" | "createdAt">): number | undefined {
	const { createdAt, ts } = message
	if (isPlausibleTimestamp(createdAt)) {
		return createdAt
	}
	return isPlausibleTimestamp(ts) ? ts : undefined
}

/** One prompt with the answer that concluded it; either side can be missing. */
export interface TimelineTurn {
	prompt?: TimelineMarker
	answer?: TimelineMarker
}

/**
 * Length a rail label may run to. Deliberately a full clause rather than a stub: the preview box
 * wraps, so the limit is set by what stays glanceable, not by what fits on one line.
 */
export const TIMELINE_SUMMARY_MAX_CHARS = 110

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

/** Markdown-free single line: fenced code, tag wrappers, links and emphasis all collapse. */
function toPlainText(raw: string): string {
	return raw
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`>#|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * Index just past every sentence terminator.
 *
 * A terminator only counts where whitespace follows it, which is what keeps "1.5 GB" in one piece.
 * Single-letter abbreviations ("z. B.") are skipped as well: they would end a label mid-clause.
 */
function sentenceEnds(text: string): number[] {
	const ends: number[] = []
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (char !== "." && char !== "!" && char !== "?") {
			continue
		}
		const next = text[index + 1]
		if (next !== undefined && next !== " ") {
			continue
		}
		if (char === "." && isSingleLetterAbbreviation(text, index)) {
			continue
		}
		ends.push(index + 1)
	}
	return ends
}

function isSingleLetterAbbreviation(text: string, dot: number): boolean {
	const letter = text[dot - 1]
	if (!letter || letter === " ") {
		return false
	}
	return /^[A-Za-zÄÖÜäöüß]$/.test(letter) && (dot === 1 || text[dot - 2] === " ")
}

/** Cut on a word boundary and mark the cut, keeping at least ~60 % of the budget. */
function truncateAtWord(text: string, maxChars: number): string {
	const cut = text.slice(0, maxChars + 1)
	const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("-"))
	// Only honour the boundary when it keeps a useful amount of text.
	const head = boundary >= Math.ceil(maxChars * 0.6) ? cut.slice(0, boundary) : cut.slice(0, maxChars)
	return `${head.replace(/[\s,.:;]$/g, "")}…`
}

/**
 * Collapse a message body into a readable label.
 *
 * As much of the text as fits is kept, and a sentence boundary inside the budget wins over a
 * mid-clause cut: "Erste Sache." reads better than the same clause with an ellipsis, and a stub of
 * thirty characters said nothing about a prompt that opened with a greeting. Only a run of text
 * with no boundary near the limit is cut on a word.
 */
export function summarizeTimelineText(raw: string, maxChars = TIMELINE_SUMMARY_MAX_CHARS): string {
	const plain = toPlainText(raw)
	if (!plain) {
		return ""
	}
	if (plain.length <= maxChars) {
		return plain
	}

	let boundary = 0
	for (const end of sentenceEnds(plain)) {
		if (end > maxChars) {
			break
		}
		boundary = end
	}
	// A boundary that keeps less than ~40 % of the budget is not worth the loss of context.
	if (boundary >= Math.ceil(maxChars * 0.4)) {
		return plain.slice(0, boundary)
	}
	return truncateAtWord(plain, maxChars)
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
		markers.push({ ts: item.ts, clock: clockOfMessage(item), kind, summary, listIndex })
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
	// A counter where a clock should be (see {@link clockOfMessage}) is not a distance to now:
	// rendering one produced things like "-20760d". Better to show nothing than a confident wrong.
	if (!isPlausibleTimestamp(ts)) {
		return ""
	}
	const seconds = Math.floor((now - ts) / 1000)
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

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * The rail's grid. A distance is rounded **up** to the smallest step that covers it, so a marker a
 * few minutes off the reading position reads `-5m` rather than `-4m37s`: exact seconds would change
 * with every scroll event without saying anything the tick does not already say, and a fixed grid
 * is what lets the eye compare two labels.
 */
const RELATIVE_STEPS: Array<[number, string]> = [
	[MINUTE_MS, "1m"],
	[5 * MINUTE_MS, "5m"],
	[15 * MINUTE_MS, "15m"],
	[30 * MINUTE_MS, "30m"],
	[HOUR_MS, "1h"],
	[3 * HOUR_MS, "3h"],
	[6 * HOUR_MS, "6h"],
	[12 * HOUR_MS, "12h"],
	[DAY_MS, "1d"],
	[2 * DAY_MS, "2d"],
	[7 * DAY_MS, "7d"],
	[30 * DAY_MS, "30d"],
	[180 * DAY_MS, "6mo"],
	[365 * DAY_MS, "1y"],
]

/**
 * Distance from the reading position to `clock`, on {@link RELATIVE_STEPS}: `-15m` for a row up to
 * fifteen minutes before it, `+5m` for one after it, `now` for the position itself.
 *
 * Signed because the rail runs both ways once it is measured against a position in the middle of
 * the conversation: what is above the current row is *later*, and printing that as `-5m` too would
 * make the grid read as a countdown to nothing. Empty for either side without a clock — a row whose
 * time is unknown shows no time rather than the counter it happens to be identified by.
 */
export function formatRelativeStep(clock: number, referenceClock: number): string {
	if (!isPlausibleTimestamp(clock) || !isPlausibleTimestamp(referenceClock)) {
		return ""
	}
	const delta = clock - referenceClock
	const magnitude = Math.abs(delta)
	if (magnitude < MINUTE_MS / 2) {
		return "now"
	}
	const sign = delta < 0 ? "-" : "+"
	for (const [step, label] of RELATIVE_STEPS) {
		if (magnitude <= step) {
			return `${sign}${label}`
		}
	}
	return `${sign}1y`
}

/** How many labels stay on the rail while nothing is hovered. */
export const TIMELINE_LABEL_SLOTS = 5

/**
 * The clock the grid is measured against: the reading position's own, or — when that row has no
 * clock yet — the nearest one that does. Undefined only when nothing on the rail knows its time.
 */
export function timelineAnchorClock(markers: Array<Pick<TimelineMarker, "clock">>, current: number): number | undefined {
	const count = markers.length
	if (count === 0) {
		return undefined
	}
	// Before the first measurement there is no current row; the bottom of the list is the default.
	const index = current >= 0 ? Math.min(current, count - 1) : count - 1
	for (let distance = 0; distance < count; distance++) {
		for (const candidate of distance === 0 ? [index] : [index - distance, index + distance]) {
			const clock = markers[candidate]?.clock
			if (isPlausibleTimestamp(clock)) {
				return clock
			}
		}
	}
	return undefined
}

/** The grid label for one marker: empty when either side has no clock to measure against. */
export function markerStepLabel(marker: Pick<TimelineMarker, "clock"> | undefined, anchorClock: number | undefined): string {
	if (!marker || !isPlausibleTimestamp(marker.clock) || !isPlausibleTimestamp(anchorClock)) {
		return ""
	}
	return formatRelativeStep(marker.clock, anchorClock)
}

/**
 * Which markers carry a permanent label: a window around the reading position, one entry per step.
 *
 * Labelling every marker is unreadable in a long task — the ticks sit a handful of pixels apart —
 * and a fixed stride (every fifth) puts labels wherever the time happens to fall while the
 * interesting neighbourhood repeats itself. So the window travels with `current`, which is what
 * makes the grid relative. Buckets repeat as well (two prompts a minute apart both read `-1m`), so
 * a step that was just shown is dropped. The hovered marker is deliberately absent: its preview
 * carries the same number and would sit right on top of it.
 */
export function relativeLabelIndices(
	markers: Array<Pick<TimelineMarker, "clock">>,
	current: number,
	slots = TIMELINE_LABEL_SLOTS,
): number[] {
	const count = markers.length
	const anchor = timelineAnchorClock(markers, current)
	if (count === 0 || anchor === undefined) {
		return []
	}
	const reference = current >= 0 ? Math.min(current, count - 1) : count - 1
	const half = Math.floor((slots - 1) / 2)
	const from = Math.max(0, Math.min(reference - half, count - slots))
	const to = Math.min(count - 1, from + slots - 1)

	const picked: number[] = []
	let lastLabel: string | undefined
	for (let index = from; index <= to; index++) {
		const label = markerStepLabel(markers[index], anchor)
		// Rows without a clock are skipped, and only the anchor itself may read `now`.
		if (!label || (index !== reference && (label === lastLabel || label === "now"))) {
			continue
		}
		picked.push(index)
		lastLabel = label
	}
	return picked
}

/**
 * When the row happened on the wall clock: `14:32` today, `3 Nov 14:32` earlier this year,
 * `3 Nov 2025 14:32` before that. The grid says how far; this says *when*.
 */
export function formatClockTime(ts: number, now: number = Date.now()): string {
	if (!isPlausibleTimestamp(ts)) {
		return ""
	}
	const date = new Date(ts)
	const reference = new Date(now)
	const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
	if (date.toDateString() === reference.toDateString()) {
		return time
	}
	const sameYear = date.getFullYear() === reference.getFullYear()
	const day = date.toLocaleDateString(
		[],
		sameYear ? { day: "numeric", month: "short" } : { day: "2-digit", month: "short", year: "numeric" },
	)
	return `${day} ${time}`
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
