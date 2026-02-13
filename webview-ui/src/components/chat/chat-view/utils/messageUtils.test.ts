import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { groupLowStakesTools } from "./messageUtils"

const makeSay = (say: ClineMessage["say"], ts: number, extras: Partial<ClineMessage> = {}): ClineMessage =>
	({
		type: "say",
		say,
		ts,
		...extras,
	}) as ClineMessage

describe("groupLowStakesTools", () => {
	it("keeps standalone reasoning when no low-stakes tool follows", () => {
		const reasoning = makeSay("reasoning", 1, {
			text: "This is reasoning content that should stay visible.",
			partial: true,
		})
		const completion = makeSay("completion_result", 2, {
			text: "Final response",
		})

		const result = groupLowStakesTools([reasoning, completion])

		expect(result).toHaveLength(2)
		expect(result[0]).toEqual(reasoning)
		expect(result[1]).toEqual(completion)
	})

	it("still absorbs reasoning into a tool group when a low-stakes tool follows", () => {
		const reasoning = makeSay("reasoning", 1, {
			text: "Reasoning before file read.",
		})
		const readTool = makeSay("tool", 2, {
			text: JSON.stringify({ tool: "readFile", path: "README.md" }),
		})

		const result = groupLowStakesTools([reasoning, readTool])

		expect(result).toHaveLength(1)
		expect(Array.isArray(result[0])).toBe(true)
		const grouped = result[0] as ClineMessage[]
		expect(grouped.map((m) => m.say)).toEqual(["reasoning", "tool"])
	})
})
