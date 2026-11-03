import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	clockOfMessage,
	collectTimelineMarkers,
	formatClockTime,
	formatDurationMinutes,
	formatElapsed,
	formatRelativeStep,
	formatTimeAgo,
	groupIntoTurns,
	interpolateRatios,
	markerStepLabel,
	nearestByRatio,
	relativeLabelIndices,
	resolveChatScroller,
	resolveSelectedOption,
	summarizeTimelineText,
	TIMELINE_LABEL_SLOTS,
	timelineAnchorClock,
	timelineKindOf,
} from "./turnTimeline"

const say = (ts: number, tag: string, text = ""): ClineMessage => ({ ts, type: "say", say: tag as never, text })
const ask = (ts: number, tag: string, text = ""): ClineMessage => ({ ts, type: "ask", ask: tag as never, text })

describe("timelineKindOf", () => {
	it("classifies prompts and answers", () => {
		expect(timelineKindOf(say(1, "task"))).toBe("prompt")
		expect(timelineKindOf(say(2, "user_feedback"))).toBe("prompt")
		expect(timelineKindOf(say(3, "completion_result"))).toBe("answer")
		expect(timelineKindOf(say(4, "plan_completion_result"))).toBe("answer")
		expect(timelineKindOf(ask(5, "completion_result"))).toBe("answer")
	})

	it("ignores bookkeeping and plain answers", () => {
		expect(timelineKindOf(say(1, "text"))).toBeUndefined()
		expect(timelineKindOf(say(2, "tool"))).toBeUndefined()
		expect(timelineKindOf(say(3, "reasoning"))).toBeUndefined()
	})
})

describe("summarizeTimelineText", () => {
	it("unwraps the fork's user_input envelope", () => {
		expect(summarizeTimelineText('<user_input mode="act">test</user_input>')).toBe("test")
	})

	it("strips code, links and emphasis", () => {
		expect(summarizeTimelineText("```bash\nls -la\n```\nSee **the [docs](https://x.y)** now")).toBe("See the docs now")
	})

	it("keeps every sentence that fits", () => {
		const text = "Erste Sache. Zweite Sache, die jetzt mitläuft, weil sie ins Limit passt."
		expect(summarizeTimelineText(text)).toBe(text)
	})

	it("does not cut on decimals", () => {
		expect(summarizeTimelineText("Es sind 1.5 GB übrig")).toBe("Es sind 1.5 GB übrig")
	})

	it("ends on the last sentence boundary inside the limit", () => {
		const head = `${"a".repeat(60)}.`
		const out = summarizeTimelineText(`${head} Und ein zweiter Satz, der über das Limit hinausgeht und deshalb wegfällt.`)
		expect(out).toBe(head)
		expect(out.endsWith("…")).toBe(false)
	})

	it("cuts on a word boundary when no sentence boundary fits", () => {
		const out = summarizeTimelineText("Wort ".repeat(50))
		expect(out.length).toBeLessThanOrEqual(111)
		expect(out.endsWith("…")).toBe(true)
		expect(out).not.toMatch(/\s…$/)
	})

	it("does not end a label on a single-letter abbreviation", () => {
		const text =
			"Erste Erklärung z. B. mit Abkürzung und danach noch deutlich zu viel Text, damit die Grenze irgendwo mitten durch den Satz fällt."
		const out = summarizeTimelineText(text)
		expect(out).not.toBe("Erste Erklärung z.")
		expect(out.length).toBeLessThanOrEqual(111)
	})

	it("returns empty for contentless text", () => {
		expect(summarizeTimelineText("   \n\t ")).toBe("")
		expect(summarizeTimelineText("<br/>")).toBe("")
	})
})

describe("collectTimelineMarkers", () => {
	it("keeps prompts and answers with their rendered-list index", () => {
		const list = [
			say(1, "task", "prompt one"),
			say(2, "reasoning"),
			say(3, "tool"),
			say(4, "completion_result", "answer one"),
			say(5, "user_feedback", "prompt two"),
		]
		const markers = collectTimelineMarkers(list)

		expect(markers.map((m) => [m.kind, m.ts, m.listIndex])).toEqual([
			["prompt", 1, 0],
			["answer", 4, 3],
			["prompt", 5, 4],
		])
		expect(markers[0].summary).toBe("prompt one")
	})

	it("skips folds and rows without usable text", () => {
		const list = [[say(1, "tool")], say(2, "task", "   "), say(3, "completion_result", "ok")]
		const markers = collectTimelineMarkers(list)

		expect(markers).toHaveLength(1)
		expect(markers[0].listIndex).toBe(2)
	})
})

describe("groupIntoTurns", () => {
	it("pairs each prompt with the answer that concludes it", () => {
		const markers = collectTimelineMarkers([
			say(1, "task", "frage 1"),
			say(2, "completion_result", "antwort 1"),
			say(3, "user_feedback", "frage 2"),
		])
		const turns = groupIntoTurns(markers)

		expect(turns).toHaveLength(2)
		expect(turns[0].prompt?.ts).toBe(1)
		expect(turns[0].answer?.ts).toBe(2)
		expect(turns[1].prompt?.ts).toBe(3)
		expect(turns[1].answer).toBeUndefined()
	})

	it("handles an answer that arrives without a prompt row", () => {
		const turns = groupIntoTurns(collectTimelineMarkers([say(1, "completion_result", "a")]))

		expect(turns).toHaveLength(1)
		expect(turns[0].prompt).toBeUndefined()
		expect(turns[0].answer?.ts).toBe(1)
	})
})

describe("time formatting", () => {
	it("renders wall-clock distance with a leading minus", () => {
		const now = 1_700_000_000_000
		expect(formatTimeAgo(now, now)).toBe("now")
		expect(formatTimeAgo(now - 45_000, now)).toBe("-45s")
		expect(formatTimeAgo(now - 60_000, now)).toBe("-1m")
		expect(formatTimeAgo(now - 12 * 60_000, now)).toBe("-12m")
		expect(formatTimeAgo(now - 3_600_000, now)).toBe("-1h")
		expect(formatTimeAgo(now - 2 * 86_400_000, now)).toBe("-2d")
	})

	it("renders durations unsigned and zero-padded", () => {
		expect(formatElapsed(42_000)).toBe("42s")
		expect(formatElapsed(187_000)).toBe("3m 07s")
		expect(formatElapsed(3_840_000)).toBe("1h 04m")
		expect(formatElapsed(-1)).toBe("")
	})
})

describe("resolveSelectedOption", () => {
	const OPTIONS = ["Option A", "Option B mit Langtext", "Option C"]

	it("recovers the choice from the answer submitted right after the question", () => {
		const messages = [
			say(1, "task", "start"),
			ask(2, "followup", JSON.stringify({ question: "Wie?", options: OPTIONS })),
			say(3, "user_feedback", "Option B mit Langtext"),
		]

		expect(resolveSelectedOption(messages, 2, OPTIONS)).toBe("Option B mit Langtext")
	})

	it("ignores whitespace differences but never matches a free-text answer", () => {
		const messages = [ask(1, "followup", "{}"), say(2, "user_feedback", "  Option A  ")]
		expect(resolveSelectedOption(messages, 1, OPTIONS)).toBe("Option A")

		const other = [ask(1, "followup", "{}"), say(2, "user_feedback", "ganz was anderes")]
		expect(resolveSelectedOption(other, 1, OPTIONS)).toBeUndefined()
	})

	it("stops at the first answer and never attributes a later one", () => {
		const messages = [
			ask(1, "followup", "{}"),
			say(2, "user_feedback", "ganz was anderes"),
			say(3, "user_feedback", "Option C"),
		]

		expect(resolveSelectedOption(messages, 1, OPTIONS)).toBeUndefined()
	})

	it("returns nothing without options or for an unknown question", () => {
		const messages = [ask(1, "followup", "{}"), say(2, "user_feedback", "Option A")]

		expect(resolveSelectedOption(messages, 1, undefined)).toBeUndefined()
		expect(resolveSelectedOption(messages, 99, OPTIONS)).toBeUndefined()
	})
})

describe("interpolateRatios", () => {
	const markers = [0, 10, 20, 30, 40].map((listIndex) => ({ listIndex }))

	it("uses a measured anchor exactly", () => {
		expect(interpolateRatios(markers, [{ listIndex: 20, ratio: 0.5 }])[2]).toBe(0.5)
	})

	it("interpolates between anchors by list index", () => {
		const out = interpolateRatios(markers, [
			{ listIndex: 0, ratio: 0 },
			{ listIndex: 40, ratio: 1 },
		])

		expect(out).toEqual([0, 0.25, 0.5, 0.75, 1])
	})

	it("clamps the ends to the nearest known anchor when nothing surrounds them", () => {
		const out = interpolateRatios(markers, [{ listIndex: 20, ratio: 0.4 }])

		expect(out).toEqual([0.4, 0.4, 0.4, 0.4, 0.4])
	})

	it("keeps ratios inside 0..1", () => {
		const out = interpolateRatios(markers, [
			{ listIndex: 0, ratio: -0.5 },
			{ listIndex: 40, ratio: 3 },
		])

		expect(Math.min(...out)).toBeGreaterThanOrEqual(0)
		expect(Math.max(...out)).toBeLessThanOrEqual(1)
	})

	it("returns nothing for no markers", () => {
		expect(interpolateRatios([], [])).toEqual([])
	})
})

describe("nearestByRatio", () => {
	it("finds the closest position", () => {
		expect(nearestByRatio([0, 0.25, 0.5, 1], 0.6)).toBe(2)
		expect(nearestByRatio([0, 0.25, 0.5, 1], 0.02)).toBe(0)
		expect(nearestByRatio([0, 0.25, 0.5, 1], 0.99)).toBe(3)
	})

	it("reports -1 without positions", () => {
		expect(nearestByRatio([], 0.5)).toBe(-1)
	})
})

describe("formatDurationMinutes", () => {
	it("hides anything under a minute", () => {
		expect(formatDurationMinutes(0)).toBe("")
		expect(formatDurationMinutes(59_999)).toBe("")
		expect(formatDurationMinutes(-1)).toBe("")
		expect(formatDurationMinutes(Number.NaN)).toBe("")
	})

	it("rounds to whole minutes", () => {
		expect(formatDurationMinutes(60_000)).toBe("1m")
		expect(formatDurationMinutes(89_000)).toBe("1m")
		expect(formatDurationMinutes(455_700)).toBe("8m")
	})
})

describe("interpolateRatios without measurements", () => {
	it("spreads markers evenly instead of stacking them on one spot", () => {
		const markers = [0, 2, 4, 6].map((listIndex) => ({ listIndex }))

		const out = interpolateRatios(markers, [])

		// All-zero output made every tick overlap and read as "the markers disappeared".
		expect(out).toEqual([0, 1 / 3, 2 / 3, 1])
		expect(new Set(out.map((v) => v.toFixed(6))).size).toBe(4)
	})

	it("places a single marker at the start", () => {
		expect(interpolateRatios([{ listIndex: 0 }], [])).toEqual([0])
	})
})

describe("formatTimeAgo with implausible timestamps", () => {
	it("shows nothing for a zero timestamp instead of a confident -20760d", () => {
		const now = Date.now()

		expect(formatTimeAgo(0, now)).toBe("")
		expect(formatTimeAgo(-5, now)).toBe("")
		expect(formatTimeAgo(Number.NaN, now)).toBe("")
	})

	it("still labels a normal recent timestamp", () => {
		const now = Date.now()

		expect(formatTimeAgo(now - 12 * 60_000, now)).toBe("-12m")
	})
})

describe("formatRelativeStep", () => {
	const reference = Date.UTC(2026, 10, 3, 12)
	const before = (ms: number) => reference - ms
	const after = (ms: number) => reference + ms

	it("rounds up to the grid instead of to the nearest step", () => {
		expect(formatRelativeStep(before(3 * 60_000), reference)).toBe("-5m")
		expect(formatRelativeStep(before(6 * 60_000), reference)).toBe("-15m")
		expect(formatRelativeStep(before(20 * 60_000), reference)).toBe("-30m")
		expect(formatRelativeStep(before(45 * 60_000), reference)).toBe("-1h")
		expect(formatRelativeStep(before(3 * 3_600_000 + 1), reference)).toBe("-6h")
		expect(formatRelativeStep(before(10 * 86_400_000), reference)).toBe("-30d")
	})

	it("signs by direction, so the grid reads both ways", () => {
		expect(formatRelativeStep(before(90_000), reference)).toBe("-5m")
		expect(formatRelativeStep(after(90_000), reference)).toBe("+5m")
		expect(formatRelativeStep(reference, reference)).toBe("now")
		expect(formatRelativeStep(after(20_000), reference)).toBe("now")
	})

	it("stays quiet about implausible distances, like formatTimeAgo does", () => {
		expect(formatRelativeStep(0, reference)).toBe("")
		expect(formatRelativeStep(reference, Number.NaN)).toBe("")
	})
})

describe("relativeLabelIndices", () => {
	const reference = Date.UTC(2026, 10, 3, 12)
	// Markers a minute apart: neighbouring steps repeat, which is what the dedupe exists for.
	const markers = Array.from({ length: 7 }, (_, offset) => ({ clock: reference + offset * 60_000 }))

	it("keeps a window around the reading position, one label per step", () => {
		for (const current of [0, 2, 4, 6]) {
			const picked = relativeLabelIndices(markers, current)
			const labels = picked.map((index) => markerStepLabel(markers[index], markers[current].clock))
			// The position itself is always labelled, no step appears twice, nothing leaves the window.
			expect(picked).toContain(current)
			expect(new Set(labels).size).toBe(labels.length)
			expect(Math.max(...picked) - Math.min(...picked)).toBeLessThan(TIMELINE_LABEL_SLOTS)
		}
	})

	it("collapses to the position alone while every marker falls in the same step", () => {
		const tight = markers.map((_, offset) => ({ clock: reference + offset * 5_000 }))
		expect(relativeLabelIndices(tight, 3)).toEqual([3])
	})

	it("labels nothing while no row knows its time", () => {
		// A session restored before the host sent clocks: `ts` is a counter, so there is no time.
		expect(relativeLabelIndices([{ clock: undefined }, { clock: undefined }], 0)).toEqual([])
	})

	it("falls back to the bottom of the list before the first measurement", () => {
		expect(relativeLabelIndices([], 0)).toEqual([])
		expect(relativeLabelIndices(markers, -1)).toContain(markers.length - 1)
	})
})

describe("clockOfMessage", () => {
	const real = Date.UTC(2026, 10, 3, 12)

	it("prefers the host's clock over the identity counter", () => {
		// MessageIdMinter hands out 1, 2, 3 … — 145 is the 145th row, not 145 ms after the epoch.
		expect(clockOfMessage({ ts: 145, createdAt: real })).toBe(real)
		expect(clockOfMessage({ ts: 145 })).toBeUndefined()
	})

	it("still reads a clock off ts where ts really is one, as the classic path sent it", () => {
		expect(clockOfMessage({ ts: real })).toBe(real)
		expect(clockOfMessage({ ts: real, createdAt: 7 })).toBe(real)
	})

	it("reaches the markers through collectTimelineMarkers", () => {
		const [marker] = collectTimelineMarkers([say(real, "task", "heute vor drei Stunden")])
		expect(marker.clock).toBe(real)
		const [counter] = collectTimelineMarkers([{ ts: 3, type: "say", say: "task", text: "id ist kein Datum" }])
		expect(counter.clock).toBeUndefined()
		expect(counter.ts).toBe(3)
	})
})

describe("timelineAnchorClock", () => {
	const real = Date.UTC(2026, 10, 3, 12)

	it("uses the nearest row that knows its time", () => {
		const markers = [{ clock: real }, { clock: undefined }, { clock: real + 60_000 }]
		expect(timelineAnchorClock(markers, 1)).toBe(real)
		expect(timelineAnchorClock(markers, 0)).toBe(real)
		expect(timelineAnchorClock([{ clock: undefined }], 0)).toBeUndefined()
	})

	it("says nothing about a row without a clock", () => {
		expect(markerStepLabel({ clock: undefined }, real)).toBe("")
		expect(markerStepLabel({ clock: real }, undefined)).toBe("")
		expect(markerStepLabel(undefined, real)).toBe("")
	})
})

describe("formatClockTime", () => {
	const now = new Date(2026, 10, 3, 14, 32).getTime()

	it("gives just the time for today", () => {
		const today = formatClockTime(new Date(2026, 10, 3, 9, 5).getTime(), now)
		expect(today).toMatch(/9:05|09:05/)
		expect(today).not.toMatch(/Nov|2026/)
	})

	it("adds the day earlier this year and the year once it changes", () => {
		expect(formatClockTime(new Date(2026, 10, 1, 9, 5).getTime(), now)).toMatch(/Nov/)
		expect(formatClockTime(new Date(2025, 10, 1, 9, 5).getTime(), now)).toMatch(/2025/)
	})

	it("stays quiet about a timestamp that is not one", () => {
		expect(formatClockTime(0, now)).toBe("")
		expect(formatClockTime(Number.NaN, now)).toBe("")
	})
})

describe("resolveChatScroller", () => {
	it("walks from the layout wrapper to the element that actually scrolls", () => {
		const wrapper = document.createElement("div")
		const scroller = document.createElement("div")
		scroller.className = "scrollable chat-scrollbar grow overflow-y-scroll"
		wrapper.append(scroller)

		expect(resolveChatScroller(wrapper)).toBe(scroller)
	})

	it("returns the scroller unchanged when already given one", () => {
		const scroller = document.createElement("div")
		scroller.className = "chat-scrollbar"

		expect(resolveChatScroller(scroller)).toBe(scroller)
	})

	it("falls back to the candidate when no scroller exists", () => {
		const lonely = document.createElement("div")

		expect(resolveChatScroller(lonely)).toBe(lonely)
		expect(resolveChatScroller(null)).toBeNull()
	})
})

describe("interpolateRatios with only the tail measured", () => {
	it("spreads markers above the first anchor instead of stacking them on it", () => {
		const markers = [0, 20, 40, 60, 80, 100].map((listIndex) => ({ listIndex }))
		// Realistic case at the end of a long task: only the last rows are rendered. With the
		// boundary anchors useTimelinePositions adds, everything above interpolates across the rail.
		const anchors = [
			{ listIndex: 0, ratio: 0 },
			{ listIndex: 80, ratio: 0.8 },
			{ listIndex: 100, ratio: 1 },
		]

		const out = interpolateRatios(markers, anchors)

		// Without the leading anchor all four upper markers collapsed onto 0.8, which read as
		// "only the last few markers exist". Assert the property, not exact floats.
		expect(new Set(out.map((value) => value.toFixed(4))).size).toBe(6)
		expect(out[0]).toBe(0)
		expect(out[out.length - 1]).toBe(1)
		expect(out.every((value, i) => i === 0 || value >= out[i - 1])).toBe(true)
		// Every marker above the first measurement is spread, not parked on it.
		expect(out.slice(0, 4).every((value) => value < 0.8)).toBe(true)
	})
})
