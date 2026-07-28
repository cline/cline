import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { createVscodeExtraTools } from "./vscode-runtime-builder"

describe("createVscodeExtraTools", () => {
	it("does not register the removed attempt_completion tool", async () => {
		const mcpHub = { getServers: () => [] } as unknown as McpHub

		const tools = await createVscodeExtraTools(mcpHub)

		// attempt_completion was removed (ENG-2331): models rarely called it, and
		// when they did the run never ended because the tool lacked
		// lifecycle.completesRun — costing an extra model request per task and
		// allowing unbounded request loops. Runs now end when the model finishes
		// a turn without tool calls.
		expect(tools.some((tool) => tool.name === "attempt_completion")).toBe(false)
	})
})
