import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { buildToolsWithReasoning, getToolGroupSummaryFromParsedTools } from "./ToolGroupRenderer"

const readToolMessage = (
	ts: number,
	type: "ask" | "say",
	path: string,
	range?: { start: number; end: number },
): ClineMessage => ({
	ts,
	type,
	...(type === "ask" ? { ask: "tool" as const } : { say: "tool" as const }),
	text: JSON.stringify({
		tool: "readFile",
		path,
		...(range ? { readLineStart: range.start, readLineEnd: range.end } : {}),
	}),
})

describe("buildToolsWithReasoning", () => {
	it("replaces an immediately-following read approval ask with the completed read", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
		])

		expect(tools).toHaveLength(1)
		expect(tools[0].tool.say).toBe("tool")
		expect(tools[0].parsedTool.readLineStart).toBe(1)
		expect(tools[0].parsedTool.readLineEnd).toBe(20)
	})

	it("keeps separate reads of the same file when they are distinct operations", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
			readToolMessage(3, "ask", "src/a.ts"),
			readToolMessage(4, "say", "src/a.ts", { start: 40, end: 60 }),
		])

		expect(tools).toHaveLength(2)
		expect(tools.map((tool) => [tool.parsedTool.readLineStart, tool.parsedTool.readLineEnd])).toEqual([
			[1, 20],
			[40, 60],
		])
	})
})

describe("getToolGroupSummaryFromParsedTools", () => {
	it("counts rendered read tools once after ask/say collapse", () => {
		const tools = buildToolsWithReasoning([
			readToolMessage(1, "ask", "src/a.ts"),
			readToolMessage(2, "say", "src/a.ts", { start: 1, end: 20 }),
		])

		expect(getToolGroupSummaryFromParsedTools(tools.map((tool) => tool.parsedTool))).toBe("Cline read 1 file")
	})
})
