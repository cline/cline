import { describe, it } from "mocha"
import "should"
import { checkRepeatedToolCall, toolCallSignature } from "../loop-detection"
import { TaskState } from "../TaskState"

/**
 * Tests for plan-mode-restricted tool loop detection.
 *
 * When a tool is blocked in plan mode, the ToolExecutor now tracks
 * repeated blocked calls just like other repeated tool calls.
 * This prevents infinite loops of the same blocked tool after task resume.
 */

/** Simulate a blocked plan-mode tool call with loop detection. */
function simulateBlockedPlanModeCall(
	state: TaskState,
	toolName: string,
	params: Record<string, string>,
	maxMistakes = 3,
): { softWarning: boolean; hardEscalation: boolean } {
	const sig = toolCallSignature(params)
	const result = checkRepeatedToolCall(state, toolName, sig)

	if (result.softWarning) {
		state.userMessageContent.push({ type: "text", text: `[PLAN_MODE_WARNING] repeated ${toolName}` })
	}
	if (result.hardEscalation) {
		state.consecutiveMistakeCount = maxMistakes
	}

	state.lastToolName = toolName
	state.lastToolParams = sig
	return result
}

describe("Plan Mode Loop Detection", () => {
	it("should track repeated plan-mode-blocked tool calls", () => {
		const state = new TaskState()
		const results = []

		// Simulate 5 consecutive calls to write_to_file while in plan mode
		for (let i = 0; i < 5; i++) {
			results.push(
				simulateBlockedPlanModeCall(state, "write_to_file", {
					path: "src/main.ts",
					file_text: "// attempt " + i,
				}),
			)
		}

		// Should trigger soft warning at 3rd call
		results[0].softWarning.should.be.false()
		results[1].softWarning.should.be.false()
		results[2].softWarning.should.be.true()

		// Should trigger hard escalation at 5th call
		results[3].softWarning.should.be.false()
		results[3].hardEscalation.should.be.false()
		results[4].softWarning.should.be.false()
		results[4].hardEscalation.should.be.true()

		// Verify loop detection state was updated
		state.consecutiveIdenticalToolCount.should.equal(5)
		state.consecutiveMistakeCount.should.equal(3)
	})

	it("should reset count when blocked tool is replaced with different tool", () => {
		const state = new TaskState()

		// Call write_to_file 3 times (triggers soft warning)
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "code" })
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "code" })
		const result3 = simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "code" })
		result3.softWarning.should.be.true()

		// Switch to a different blocked tool (e.g., file_new)
		const result4 = simulateBlockedPlanModeCall(state, "file_new", { path: "new.ts" })
		result4.softWarning.should.be.false()
		result4.hardEscalation.should.be.false()
		state.consecutiveIdenticalToolCount.should.equal(1)
	})

	it("should reset count when blocked tool params differ", () => {
		const state = new TaskState()

		// Same tool, same params, 3 times
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "v1" })
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "v1" })
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "v1" })

		// Different params, same tool
		const result4 = simulateBlockedPlanModeCall(state, "write_to_file", { path: "b.ts", file_text: "v1" })
		result4.softWarning.should.be.false()
		state.consecutiveIdenticalToolCount.should.equal(1)
	})

	it("should allow re-arming after task resume clears state", () => {
		const state = new TaskState()

		// First cycle: escalate at call 5
		for (let i = 0; i < 5; i++) {
			simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "data" })
		}
		state.consecutiveIdenticalToolCount.should.equal(5)
		state.consecutiveMistakeCount.should.equal(3)

		// Simulate task resume: clear loop detection state
		state.consecutiveMistakeCount = 0
		state.consecutiveIdenticalToolCount = 0
		state.lastToolName = ""
		state.lastToolParams = ""

		// Second cycle: should trigger again
		const results = []
		for (let i = 0; i < 5; i++) {
			results.push(simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "data" }))
		}

		results[2].softWarning.should.be.true()
		results[4].hardEscalation.should.be.true()
		state.consecutiveMistakeCount.should.equal(3)
	})

	it("should ignore task_progress changes when detecting blocked call loops", () => {
		const state = new TaskState()
		const results = []

		// Same tool+path, but task_progress changes each call
		for (let i = 0; i < 5; i++) {
			results.push(
				simulateBlockedPlanModeCall(state, "write_to_file", {
					path: "src/main.ts",
					file_text: "same content",
					task_progress: `Step ${i} of 5: writing file`, // This should be ignored
				}),
			)
		}

		// Should still trigger warnings/escalation as if params were identical
		results[2].softWarning.should.be.true()
		results[4].hardEscalation.should.be.true()
	})

	it("should track multiple different plan-mode-restricted tools independently", () => {
		const state = new TaskState()

		// Blocked tool 1: write_to_file
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "x" })
		simulateBlockedPlanModeCall(state, "write_to_file", { path: "a.ts", file_text: "x" })
		state.consecutiveIdenticalToolCount.should.equal(2)

		// Switch to blocked tool 2: file_new
		const switchResult = simulateBlockedPlanModeCall(state, "file_new", { path: "b.ts" })
		switchResult.softWarning.should.be.false()
		state.consecutiveIdenticalToolCount.should.equal(1)

		// Back to write_to_file but different params
		const result3 = simulateBlockedPlanModeCall(state, "write_to_file", { path: "c.ts", file_text: "y" })
		result3.softWarning.should.be.false()
		state.consecutiveIdenticalToolCount.should.equal(1)
	})
})
