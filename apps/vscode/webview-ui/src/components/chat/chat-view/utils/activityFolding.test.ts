import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	flattenActivityGroup,
	formatActivityDuration,
	getActivityGroupKey,
	getActivityGroupLabel,
	getActivityGroupStats,
	getGroupHeadMessage,
	getGroupTailMessage,
	groupAgentActivities,
	hasStreamingActivity,
	isActivityGroup,
	isAgentActivityMessage,
	liveActivityChildren,
	markTurnFinalAnswers,
	resolveActivityGroupExpansion,
	resolveActivityGroupMode,
} from "./activityFolding"

const reasoning = (ts: number, text = "thinking", partial = false): ClineMessage => ({
	ts,
	type: "say",
	say: "reasoning",
	text,
	partial,
})

const tool = (ts: number, toolName: string, path = "src/file.ts", type: "say" | "ask" = "say"): ClineMessage => ({
	ts,
	type,
	...(type === "say" ? { say: "tool" as const } : { ask: "tool" as const }),
	text: JSON.stringify({ tool: toolName, path }),
})

const command = (ts: number, text = "ls", type: "say" | "ask" = "say"): ClineMessage => ({
	ts,
	type,
	...(type === "say" ? { say: "command" as const } : { ask: "command" as const }),
	text,
})

const text = (ts: number, textValue = "answer"): ClineMessage => ({ ts, type: "say", say: "text", text: textValue })
const userFeedback = (ts: number): ClineMessage => ({ ts, type: "say", say: "user_feedback", text: "prompt" })
const task = (ts: number): ClineMessage => ({ ts, type: "say", say: "task", text: "prompt" })
const errorRow = (ts: number): ClineMessage => ({ ts, type: "say", say: "error", text: "boom" })
const apiReq = (ts: number, info: Record<string, unknown>): ClineMessage => ({
	ts,
	type: "say",
	say: "api_req_started",
	text: JSON.stringify(info),
})
const completion = (ts: number): ClineMessage => ({ ts, type: "say", say: "completion_result", text: "done" })

const toolGroup = (messages: ClineMessage[]): ClineMessage[] => {
	const group = messages as ClineMessage[] & { _isToolGroup?: boolean }
	group._isToolGroup = true
	return group
}

describe("isAgentActivityMessage", () => {
	it("treats tools, commands and thinking as activity", () => {
		expect(isAgentActivityMessage(tool(1, "readFile"))).toBe(true)
		expect(isAgentActivityMessage(command(2))).toBe(true)
		expect(isAgentActivityMessage(reasoning(3))).toBe(true)
		expect(isAgentActivityMessage(command(4, "ls", "ask"))).toBe(true)
	})

	it("keeps conversation rows out of the fold", () => {
		expect(isAgentActivityMessage(text(1))).toBe(false)
		expect(isAgentActivityMessage(userFeedback(2))).toBe(false)
		expect(isAgentActivityMessage(errorRow(3))).toBe(false)
		expect(isAgentActivityMessage({ ts: 4, type: "say", say: "completion_result", text: "done" })).toBe(false)
	})

	it("keeps cancelled / failed api requests visible", () => {
		const cancelled: ClineMessage = {
			ts: 1,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ cancelReason: "user_cancelled" }),
		}
		const running: ClineMessage = { ts: 2, type: "say", say: "api_req_started", text: JSON.stringify({ cost: 0 }) }
		expect(isAgentActivityMessage(cancelled)).toBe(false)
		expect(isAgentActivityMessage(running)).toBe(true)
	})
})

describe("groupAgentActivities", () => {
	it("folds a run of consecutive activities into a single group", () => {
		const items = groupAgentActivities([reasoning(1), tool(2, "readFile", "a.ts"), command(3), text(4)])

		expect(items).toHaveLength(2)
		expect(isActivityGroup(items[0])).toBe(true)
		expect(flattenActivityGroup([items[0]])).toHaveLength(3)
		expect((items[1] as ClineMessage).say).toBe("text")
	})

	it("splits folds on every conversation row", () => {
		const items = groupAgentActivities([tool(1, "readFile"), text(2), command(3), userFeedback(4), tool(5, "searchFiles")])

		expect(items.map((item) => (isActivityGroup(item) ? "fold" : "row"))).toEqual(["fold", "row", "fold", "row", "fold"])
	})

	it("folds nested tool groups produced by groupLowStakesTools", () => {
		const items = groupAgentActivities([toolGroup([tool(1, "readFile", "a.ts"), tool(2, "searchFiles", "b.ts")]), text(3)])

		expect(items).toHaveLength(2)
		expect(isActivityGroup(items[0])).toBe(true)
		expect(flattenActivityGroup([items[0]])).toHaveLength(2)
	})

	it("passes browser session groups through as boundaries", () => {
		const browserSession = [{ ts: 1, type: "say", say: "text", text: "browsing" }]
		const items = groupAgentActivities([tool(2, "readFile"), browserSession])

		expect(isActivityGroup(items[0])).toBe(true)
		expect(items[1]).toBe(browserSession)
	})

	it("does not fold the trailing usage-only api request below the completion box", () => {
		// A completed api_req_started (it carries a cost) renders an empty <div> upstream, so a
		// fold of nothing but that row would add a visible summary line after the final answer.
		const items = groupAgentActivities([tool(1, "readFile"), completion(2), apiReq(3, { cost: 0.01 })])

		expect(items.map((item) => (isActivityGroup(item) ? "fold" : "row"))).toEqual(["fold", "row", "row"])
		expect((items[2] as ClineMessage).say).toBe("api_req_started")
	})

	it("folds a completed api request together with real activity", () => {
		// Only a group of *nothing but* silent rows is unfolded; mixed runs keep folding.
		const items = groupAgentActivities([apiReq(1, { cost: 0.01 }), tool(2, "readFile"), reasoning(3)])

		expect(items).toHaveLength(1)
		expect(isActivityGroup(items[0])).toBe(true)
		expect(flattenActivityGroup([items[0]])).toHaveLength(3)
	})

	it("returns the input untouched when folding is switched off", () => {
		const input = [reasoning(1), tool(2, "readFile")]
		expect(groupAgentActivities(input, { enabled: false })).toBe(input)
	})
})

describe("fold keys and flatten helpers", () => {
	it("derives a stable, non-colliding key from the first row", () => {
		const group = groupAgentActivities([reasoning(1000), tool(1001, "readFile")])[0] as ClineMessage[]
		expect(getActivityGroupKey(group)).toBe(-1001)
		expect(getActivityGroupKey(group)).toBeLessThan(0)
	})

	it("resolves head/tail across nesting", () => {
		const nested = [toolGroup([tool(1, "readFile", "a.ts"), tool(2, "readFile", "b.ts")]), reasoning(3)]
		expect(getGroupHeadMessage(nested)?.ts).toBe(1)
		expect(getGroupTailMessage(nested)?.ts).toBe(3)
	})

	it("detects streaming activity anywhere in the fold", () => {
		expect(hasStreamingActivity([tool(1, "readFile"), reasoning(2, "t", true)])).toBe(true)
		expect(hasStreamingActivity([tool(1, "readFile"), reasoning(2)])).toBe(false)
	})
})

describe("resolveActivityGroupExpansion", () => {
	it("folds completed activity away by default", () => {
		expect(resolveActivityGroupExpansion({ isLastGroup: false, hasStreamingMessage: false, turnPhase: "idle" })).toBe(false)
		expect(resolveActivityGroupExpansion({ isLastGroup: true, hasStreamingMessage: false, turnPhase: "completed" })).toBe(
			false,
		)
	})

	it("keeps the tail fold open while the agent works", () => {
		expect(resolveActivityGroupExpansion({ isLastGroup: true, hasStreamingMessage: false, turnPhase: "streaming" })).toBe(
			true,
		)
		expect(
			resolveActivityGroupExpansion({ isLastGroup: true, hasStreamingMessage: false, turnPhase: "awaiting_approval" }),
		).toBe(true)
	})

	it("shows live output even for a fold that is no longer the tail", () => {
		expect(resolveActivityGroupExpansion({ isLastGroup: false, hasStreamingMessage: true, turnPhase: "streaming" })).toBe(
			true,
		)
	})

	it("lets the user override win in both directions", () => {
		expect(
			resolveActivityGroupExpansion({
				override: true,
				isLastGroup: false,
				hasStreamingMessage: false,
				turnPhase: "idle",
			}),
		).toBe(true)
		expect(
			resolveActivityGroupExpansion({
				override: false,
				isLastGroup: true,
				hasStreamingMessage: true,
				turnPhase: "streaming",
			}),
		).toBe(false)
	})
})

describe("resolveActivityGroupMode", () => {
	it("shows only what is running while the agent works", () => {
		expect(resolveActivityGroupMode({ isLastGroup: true, hasStreamingMessage: true, turnPhase: "streaming" })).toBe("live")
		// Nothing in flight and the turn over: the summary line alone.
		expect(resolveActivityGroupMode({ isLastGroup: true, hasStreamingMessage: false, turnPhase: "completed" })).toBe("none")
		expect(resolveActivityGroupMode({ isLastGroup: false, hasStreamingMessage: false, turnPhase: "idle" })).toBe("none")
	})

	it("lets the user override pick everything or nothing", () => {
		expect(
			resolveActivityGroupMode({ override: true, isLastGroup: false, hasStreamingMessage: false, turnPhase: "idle" }),
		).toBe("all")
		expect(
			resolveActivityGroupMode({ override: false, isLastGroup: true, hasStreamingMessage: true, turnPhase: "streaming" }),
		).toBe("none")
	})

	it("stays the boolean `expansion` for anything that only asks whether rows show at all", () => {
		expect(resolveActivityGroupExpansion({ isLastGroup: true, hasStreamingMessage: true, turnPhase: "streaming" })).toBe(true)
		expect(resolveActivityGroupExpansion({ isLastGroup: true, hasStreamingMessage: false, turnPhase: "idle" })).toBe(false)
	})
})

describe("liveActivityChildren", () => {
	it("keeps exactly the rows that are still in flight", () => {
		const group = [reasoning(1), reasoning(2, "still streaming", true), tool(3, "readFile")]
		expect(liveActivityChildren(group).map((item) => (item as ClineMessage).ts)).toEqual([2])
	})

	it("keeps a nested tool group whole while any of its rows streams", () => {
		const nested = toolGroup([tool(1, "readFile"), reasoning(2, "streaming", true)])
		expect(liveActivityChildren([nested])).toEqual([nested])
	})

	it("keeps the tail row only while an approval is pending", () => {
		const group = [command(1), tool(2, "readFile")]
		// A pending approval is not streaming, and hiding it would hide its buttons.
		expect(liveActivityChildren(group, { keepTail: true }).map((item) => (item as ClineMessage).ts)).toEqual([2])
		expect(liveActivityChildren(group)).toEqual([])
	})
})

describe("activity fold summary", () => {
	it("summarises commands, edits, reads and searches", () => {
		const group = groupAgentActivities([
			reasoning(1_000),
			command(1_001),
			command(1_002),
			tool(1_003, "editedExistingFile", "a.ts"),
			tool(1_004, "editedExistingFile", "a.ts"),
			tool(1_005, "newFileCreated", "b.ts"),
			tool(1_006, "readFile", "c.ts"),
			tool(1_007, "searchFiles", "d.ts"),
		])[0] as ClineMessage[]

		const stats = getActivityGroupStats(group)
		expect(stats).toMatchObject({ commands: 2, editedFiles: 2, readFiles: 1, searches: 1, thoughts: 1 })
		expect(getActivityGroupLabel(group)).toBe("2 commands · 2 files edited · 1 file read · 1 search · 1× thinking")
	})

	it("counts a tool group's rows once and falls back to an action count", () => {
		const group = groupAgentActivities([toolGroup([tool(1, "useSkill", "s"), tool(2, "webFetch", "u")])])[0] as ClineMessage[]

		expect(getActivityGroupStats(group).actions).toBe(2)
		expect(getActivityGroupLabel(group)).toBe("2 actions")
	})

	it("appends the elapsed time of longer activity runs", () => {
		const group = groupAgentActivities([command(1_000), command(62_000)])[0] as ClineMessage[]
		expect(formatActivityDuration(getActivityGroupStats(group).durationMs)).toBe("1m 1s")
		expect(formatActivityDuration(0)).toBeUndefined()
	})
})

describe("markTurnFinalAnswers", () => {
	const say = (m: ClineMessage) => m.say

	it("retags the terminal answer of every turn, not just the last one", () => {
		const out = markTurnFinalAnswers([
			task(1),
			tool(2, "readFile", "a.ts"),
			text(3, "first answer"),
			userFeedback(4),
			tool(5, "searchFiles"),
			text(6, "second answer"),
		])

		expect(out.map(say)).toEqual(["task", "tool", "completion_result", "user_feedback", "tool", "completion_result"])
	})

	it("keeps the answer text and marks it finalised", () => {
		const out = markTurnFinalAnswers([task(1), text(2, "the answer")])

		expect(out[1].text).toBe("the answer")
		expect(out[1].partial).toBe(false)
	})

	it("leaves turns the live path already tagged untouched", () => {
		const out = markTurnFinalAnswers([task(1), text(2, "mid"), completion(3), text(4, "after")])

		// The turn already has a completion row → nothing to infer, so the trailing text stays plain.
		expect(out.map(say)).toEqual(["task", "text", "completion_result", "text"])
	})

	it("never presents an errored turn as a completion", () => {
		const out = markTurnFinalAnswers([task(1), text(2, "partial answer"), errorRow(3)])

		expect(out.map(say)).toEqual(["task", "text", "error"])
	})

	it("ignores a trailing blank answer but never a streaming one", () => {
		const blank: ClineMessage = { ts: 3, type: "say", say: "text", text: "   " }
		expect(markTurnFinalAnswers([task(1), text(2, "real"), blank]).map(say)).toEqual(["task", "completion_result", "text"])

		// Still streaming → the turn has not ended, so nothing may look final.
		const streaming: ClineMessage = { ts: 3, type: "say", say: "text", text: "half written", partial: true }
		expect(markTurnFinalAnswers([task(1), text(2, "earlier"), streaming]).map(say)).toEqual(["task", "text", "text"])
	})

	it("does not mark a status update that the agent followed up with more work", () => {
		// Regression: "Alles sauber. Build und Paketprüfung:" was shown green because the rule
		// took the last text row, ignoring that tools ran after it.
		const out = markTurnFinalAnswers([
			task(1),
			text(2, "Alles sauber. Endgültiger Build und Paketprüfung:"),
			command(3),
			apiReq(4, { cost: 0.01 }),
		])

		expect(out.map(say)).toEqual(["task", "text", "command", "api_req_started"])
	})

	it("marks the last text of a turn whose only trailing rows are usage bookkeeping", () => {
		const out = markTurnFinalAnswers([task(1), command(2), text(3, "fertig"), apiReq(4, { cost: 0.01 })])

		expect(out.map(say)).toEqual(["task", "command", "completion_result", "api_req_started"])
	})

	it("returns the very same array when there is nothing to retag", () => {
		const input = [task(1), tool(2, "readFile", "a.ts")]

		expect(markTurnFinalAnswers(input)).toBe(input)
	})

	it("is idempotent", () => {
		const once = markTurnFinalAnswers([task(1), text(2, "answer")])
		const twice = markTurnFinalAnswers(once)

		expect(twice.map(say)).toEqual(once.map(say))
		expect(twice).toBe(once)
	})
})
