import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	collectTimelineMarkers,
	formatDurationMinutes,
	formatElapsed,
	formatTimeAgo,
	groupIntoTurns,
	interpolateRatios,
	nearestByRatio,
	resolveChatScroller,
	resolveSelectedOption,
	summarizeTimelineText,
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

	it("keeps only the first sentence", () => {
		expect(summarizeTimelineText("Erste Sache. Zweite Sache, die viel zu lang ist.").startsWith("Erste Sache.")).toBe(true)
	})

	it("does not cut on decimals", () => {
		expect(summarizeTimelineText("Es sind 1.5 GB übrig")).toBe("Es sind 1.5 GB übrig")
	})

	it("truncates to the limit on a word boundary", () => {
		const out = summarizeTimelineText("Führe den SATA-Selbsttest auf allen Platten aus und korrigiere die Staffelung")
		expect(out.length).toBeLessThanOrEqual(31)
		expect(out.endsWith("…")).toBe(true)
		expect(out).not.toMatch(/\s…$/)
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
