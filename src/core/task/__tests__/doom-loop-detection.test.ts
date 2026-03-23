import { describe, it } from "mocha"
import "should"
import { TaskState } from "../TaskState"

/**
 * Tests for doom loop detection logic.
 *
 * The detection tracks consecutive identical tool calls (same name + same params)
 * and escalates in two stages:
 *   Stage 1 (3 calls): warning message pushed to userMessageContent
 *   Stage 2 (5 calls): consecutiveMistakeCount set to maxConsecutiveMistakes threshold
 *
 * The actual detection runs in ToolExecutor.handleCompleteBlock() after line 579.
 * These tests validate the state tracking logic in isolation.
 */

function simulateToolCall(
	state: TaskState,
	toolName: string,
	params: Record<string, string>,
	opts: { softThreshold?: number; hardThreshold?: number; maxMistakes?: number } = {},
) {
	const SOFT = opts.softThreshold ?? 3
	const HARD = opts.hardThreshold ?? 5
	const maxMistakes = opts.maxMistakes ?? 3

	const currentParams = JSON.stringify(params)

	if (toolName === state.lastToolName && currentParams === state.lastToolParams) {
		state.consecutiveIdenticalToolCount++
	} else {
		state.consecutiveIdenticalToolCount = 1
	}
	state.lastToolName = toolName
	state.lastToolParams = currentParams

	if (state.consecutiveIdenticalToolCount === SOFT) {
		state.userMessageContent.push({
			type: "text",
			text: `[WARNING] You have called "${toolName}" with identical arguments ${SOFT} times consecutively without making progress. You MUST try a different approach — use a different tool, different arguments, or reconsider your strategy.`,
		})
	}

	if (state.consecutiveIdenticalToolCount >= HARD) {
		state.consecutiveMistakeCount = maxMistakes
	}
}

describe("Doom Loop Detection", () => {
	it("should not trigger warning before threshold", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "read_file", { path: "src/main.ts" })

		state.consecutiveIdenticalToolCount.should.equal(2)
		state.userMessageContent.length.should.equal(0)
		state.consecutiveMistakeCount.should.equal(0)
	})

	it("should inject warning at soft threshold (3 identical calls)", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "read_file", { path: "src/main.ts" })

		state.consecutiveIdenticalToolCount.should.equal(3)
		state.userMessageContent.length.should.equal(1)
		state.userMessageContent[0].type.should.equal("text")
		;(state.userMessageContent[0] as any).text.should.containEql("[WARNING]")
		;(state.userMessageContent[0] as any).text.should.containEql("read_file")
		// Should not yet escalate to mistake count
		state.consecutiveMistakeCount.should.equal(0)
	})

	it("should escalate to consecutiveMistakeCount at hard threshold (5 identical calls)", () => {
		const state = new TaskState()
		const maxMistakes = 3

		for (let i = 0; i < 5; i++) {
			simulateToolCall(state, "search_files", { regex: "TODO", path: "." }, { maxMistakes })
		}

		state.consecutiveIdenticalToolCount.should.equal(5)
		state.consecutiveMistakeCount.should.equal(maxMistakes)
		// Should have exactly one warning (from threshold 3)
		state.userMessageContent.length.should.equal(1)
	})

	it("should reset counter when different tool is used", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		// Different tool breaks the streak
		simulateToolCall(state, "list_files", { path: "src/" })

		state.consecutiveIdenticalToolCount.should.equal(1)
		state.lastToolName.should.equal("list_files")
		state.userMessageContent.length.should.equal(0)
	})

	it("should reset counter when same tool is used with different params", () => {
		const state = new TaskState()

		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		simulateToolCall(state, "read_file", { path: "src/main.ts" })
		// Same tool, different params
		simulateToolCall(state, "read_file", { path: "src/utils.ts" })

		state.consecutiveIdenticalToolCount.should.equal(1)
		state.userMessageContent.length.should.equal(0)
	})

	it("should track params correctly via JSON.stringify", () => {
		const state = new TaskState()

		simulateToolCall(state, "search_files", { regex: "TODO", path: "src/" })
		state.lastToolParams.should.equal(JSON.stringify({ regex: "TODO", path: "src/" }))

		simulateToolCall(state, "search_files", { regex: "FIXME", path: "src/" })
		state.consecutiveIdenticalToolCount.should.equal(1) // different params, reset
	})

	it("should handle empty params", () => {
		const state = new TaskState()

		simulateToolCall(state, "attempt_completion", {})
		simulateToolCall(state, "attempt_completion", {})
		simulateToolCall(state, "attempt_completion", {})

		state.consecutiveIdenticalToolCount.should.equal(3)
		state.userMessageContent.length.should.equal(1)
	})

	it("should not interfere with existing consecutiveMistakeCount from errors", () => {
		const state = new TaskState()

		// Simulate some errors incrementing the mistake count
		state.consecutiveMistakeCount = 2

		// Doom loop detection should not reset the mistake count below threshold
		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "a.ts" })

		state.consecutiveMistakeCount.should.equal(2) // untouched
	})

	it("should resume counting after a break", () => {
		const state = new TaskState()

		// Build up to 2
		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "a.ts" })
		// Break
		simulateToolCall(state, "list_files", { path: "." })
		// Start again
		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "a.ts" })
		simulateToolCall(state, "read_file", { path: "a.ts" })

		// Should trigger warning on the new streak
		state.consecutiveIdenticalToolCount.should.equal(3)
		state.userMessageContent.length.should.equal(1)
	})
})
