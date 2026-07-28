import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { createVscodeExtraTools } from "./vscode-runtime-builder"

describe("createVscodeExtraTools", () => {
	it("marks attempt_completion as completing the run", async () => {
		const mcpHub = { getServers: () => [] } as unknown as McpHub

		const tools = await createVscodeExtraTools(mcpHub)
		const attemptCompletion = tools.find((tool) => tool.name === "attempt_completion")

		expect(attemptCompletion).toBeDefined()
		// Without lifecycle.completesRun the runtime loops back for another
		// model request after every attempt_completion instead of ending the
		// run (ENG-2331): an extra request per task, and an unbounded loop when
		// the model keeps calling the tool.
		expect(attemptCompletion?.lifecycle?.completesRun).toBe(true)
	})
})
