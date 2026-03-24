import { describe, it } from "mocha"
import "should"
import { checkRepeatedToolCall, toolCallSignature } from "../loop-detection"
import { TaskState } from "../TaskState"

/** Simulate a tool call matching production order in ToolExecutor. */
function simulateToolCall(state: TaskState, toolName: string, params: Record<string, string>, maxMistakes = 3) {
	const sig = toolCallSignature(params)
	const result = checkRepeatedToolCall(state, toolName, sig)

	if (result.softWarning) {
		state.userMessageContent.push({ type: "text", text: `[WARNING] loop detected for ${toolName}` })
	}
	if (result.hardEscalation) {
		state.consecutiveMistakeCount = maxMistakes
	}

	state.lastToolName = toolName
	state.lastToolParams = sig
	return result
}

describe("toolCallSignature", () => {
	it("produces identical output regardless of key order", () => {
		toolCallSignature({ b: "2", a: "1" }).should.equal(toolCallSignature({ a: "1", b: "2" }))
	})
})

describe("Loop Detection", () => {
	it("should warn at 3 identical calls and escalate at 5", () => {
		const state = new TaskState()
		const results = []
		for (let i = 0; i < 5; i++) {
			results.push(simulateToolCall(state, "read_file", { path: "src/main.ts" }))
		}

		results[0].softWarning.should.be.false()
		results[1].softWarning.should.be.false()
		results[2].softWarning.should.be.true()
		results[3].softWarning.should.be.false()
		results[3].hardEscalation.should.be.false()
		results[4].softWarning.should.be.false()
		results[4].hardEscalation.should.be.true()
		state.userMessageContent.length.should.equal(1)
		state.consecutiveMistakeCount.should.equal(3)
	})

	it("should reset when tool or params change", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "b.ts" }) // different params
		state.consecutiveIdenticalToolCount.should.equal(1)

		simulateToolCall(state, "read_file", { path: "b.ts" })
		simulateToolCall(state, "list_files", { path: "b.ts" }) // different tool
		state.consecutiveIdenticalToolCount.should.equal(1)
	})

	it("should NOT count different tools with same params as identical", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "search_files", { path: "src/main.ts" })
		simulateToolCall(state, "list_files", { path: "src/main.ts" })

		state.consecutiveIdenticalToolCount.should.equal(1)
	})

	it("should re-arm after loop detection state is reset", () => {
		const state = new TaskState()

		// First cycle: escalate at call 5
		for (let i = 0; i < 5; i++) {
			simulateToolCall(state, "read_file", { path: "src/main.ts" })
		}
		state.consecutiveIdenticalToolCount.should.equal(5)
		state.consecutiveMistakeCount.should.equal(3)

		// Simulate what index.ts does when user clicks "continue"
		state.consecutiveMistakeCount = 0
		state.consecutiveIdenticalToolCount = 0
		state.lastToolName = ""
		state.lastToolParams = ""

		// Second cycle: same tool + params should trigger again
		const results = []
		for (let i = 0; i < 5; i++) {
			results.push(simulateToolCall(state, "read_file", { path: "src/main.ts" }))
		}

		results[2].softWarning.should.be.true()
		results[4].hardEscalation.should.be.true()
		state.consecutiveMistakeCount.should.equal(3)
	})

	it("should work correctly when tool changes after reset", () => {
		const state = new TaskState()

		// Escalate with one tool
		for (let i = 0; i < 5; i++) {
			simulateToolCall(state, "read_file", { path: "src/main.ts" })
		}

		// Reset (user clicks "continue")
		state.consecutiveMistakeCount = 0
		state.consecutiveIdenticalToolCount = 0
		state.lastToolName = ""
		state.lastToolParams = ""

		// Model switches to a different tool — no false positives
		const result = simulateToolCall(state, "list_files", { path: "src/" })
		result.softWarning.should.be.false()
		result.hardEscalation.should.be.false()
		state.consecutiveIdenticalToolCount.should.equal(1)
	})

	it("should strip task_progress from comparison", () => {
		const state = new TaskState()
		const results = []
		for (let i = 0; i < 5; i++) {
			results.push(
				simulateToolCall(state, "read_file", {
					path: "src/index.ts",
					task_progress: `step ${i} of 5`,
				}),
			)
		}

		results[2].softWarning.should.be.true()
		results[4].hardEscalation.should.be.true()
	})
})
