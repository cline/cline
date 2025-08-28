// npx vitest run src/core/tools/__tests__/ToolRepetitionDetector.spec.ts

import type { ToolName } from "@roo-code/types"

import type { ToolUse } from "../../../shared/tools"

import { ToolRepetitionDetector } from "../ToolRepetitionDetector"

vitest.mock("../../../i18n", () => ({
	t: vitest.fn((key, options) => {
		// For toolRepetitionLimitReached key, return a message with the tool name.
		if (key === "tools:toolRepetitionLimitReached" && options?.toolName) {
			return `Roo appears to be stuck in a loop, attempting the same action (${options.toolName}) repeatedly. This might indicate a problem with its current strategy.`
		}
		return key
	}),
}))

function createToolUse(name: string, displayName?: string, params: Record<string, string> = {}): ToolUse {
	return {
		type: "tool_use",
		name: (displayName || name) as ToolName,
		params,
		partial: false,
	}
}

describe("ToolRepetitionDetector", () => {
	// ===== Initialization tests =====
	describe("initialization", () => {
		it("should default to a limit of 3 if no argument provided", () => {
			const detector = new ToolRepetitionDetector()
			// We'll verify this through behavior in subsequent tests

			// First call (counter = 0)
			const result1 = detector.check(createToolUse("test", "test-tool"))
			expect(result1.allowExecution).toBe(true)

			// Second identical call (counter = 1)
			const result2 = detector.check(createToolUse("test", "test-tool"))
			expect(result2.allowExecution).toBe(true)

			// Third identical call (counter = 2)
			const result3 = detector.check(createToolUse("test", "test-tool"))
			expect(result3.allowExecution).toBe(true)

			// Fourth identical call (counter = 3) reaches the default limit
			const result4 = detector.check(createToolUse("test", "test-tool"))
			expect(result4.allowExecution).toBe(false)
		})

		it("should use the custom limit when provided", () => {
			const customLimit = 2
			const detector = new ToolRepetitionDetector(customLimit)

			// First call (counter = 0)
			const result1 = detector.check(createToolUse("test", "test-tool"))
			expect(result1.allowExecution).toBe(true)

			// Second identical call (counter = 1)
			const result2 = detector.check(createToolUse("test", "test-tool"))
			expect(result2.allowExecution).toBe(true)

			// Third identical call (counter = 2) reaches the custom limit
			const result3 = detector.check(createToolUse("test", "test-tool"))
			expect(result3.allowExecution).toBe(false)
		})
	})

	// ===== No Repetition tests =====
	describe("no repetition", () => {
		it("should allow execution for different tool calls", () => {
			const detector = new ToolRepetitionDetector()

			const result1 = detector.check(createToolUse("first", "first-tool"))
			expect(result1.allowExecution).toBe(true)
			expect(result1.askUser).toBeUndefined()

			const result2 = detector.check(createToolUse("second", "second-tool"))
			expect(result2.allowExecution).toBe(true)
			expect(result2.askUser).toBeUndefined()

			const result3 = detector.check(createToolUse("third", "third-tool"))
			expect(result3.allowExecution).toBe(true)
			expect(result3.askUser).toBeUndefined()
		})

		it("should reset the counter when different tool calls are made", () => {
			const detector = new ToolRepetitionDetector(2)

			// First call
			detector.check(createToolUse("same", "same-tool"))

			// Second identical call would reach limit of 2, but we'll make a different call
			detector.check(createToolUse("different", "different-tool"))

			// Back to the first tool - should be allowed since counter was reset
			const result = detector.check(createToolUse("same", "same-tool"))
			expect(result.allowExecution).toBe(true)
		})
	})

	// ===== Repetition Below Limit tests =====
	describe("repetition below limit", () => {
		it("should allow execution when repetition is below limit and block when limit reached", () => {
			const detector = new ToolRepetitionDetector(3)

			// First call (counter = 0)
			const result1 = detector.check(createToolUse("repeat", "repeat-tool"))
			expect(result1.allowExecution).toBe(true)

			// Second identical call (counter = 1)
			const result2 = detector.check(createToolUse("repeat", "repeat-tool"))
			expect(result2.allowExecution).toBe(true)

			// Third identical call (counter = 2)
			const result3 = detector.check(createToolUse("repeat", "repeat-tool"))
			expect(result3.allowExecution).toBe(true)

			// Fourth identical call (counter = 3) reaches limit
			const result4 = detector.check(createToolUse("repeat", "repeat-tool"))
			expect(result4.allowExecution).toBe(false)
		})
	})

	// ===== Repetition Reaches Limit tests =====
	describe("repetition reaches limit", () => {
		it("should block execution when repetition reaches the limit", () => {
			const detector = new ToolRepetitionDetector(3)

			// First call (counter = 0)
			detector.check(createToolUse("repeat", "repeat-tool"))

			// Second identical call (counter = 1)
			detector.check(createToolUse("repeat", "repeat-tool"))

			// Third identical call (counter = 2)
			detector.check(createToolUse("repeat", "repeat-tool"))

			// Fourth identical call (counter = 3) - should reach limit
			const result = detector.check(createToolUse("repeat", "repeat-tool"))

			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
			expect(result.askUser?.messageKey).toBe("mistake_limit_reached")
			expect(result.askUser?.messageDetail).toContain("repeat-tool")
		})

		it("should reset internal state after limit is reached", () => {
			const detector = new ToolRepetitionDetector(2)

			// Reach the limit
			detector.check(createToolUse("repeat", "repeat-tool"))
			detector.check(createToolUse("repeat", "repeat-tool"))
			const limitResult = detector.check(createToolUse("repeat", "repeat-tool")) // This reaches limit
			expect(limitResult.allowExecution).toBe(false)

			// Use a new tool call - should be allowed since state was reset
			const result = detector.check(createToolUse("new", "new-tool"))
			expect(result.allowExecution).toBe(true)
		})
	})

	// ===== Repetition After Limit (Post-Reset) tests =====
	describe("repetition after limit", () => {
		it("should allow execution of previously problematic tool after reset", () => {
			const detector = new ToolRepetitionDetector(2)

			// Reach the limit with a specific tool
			detector.check(createToolUse("problem", "problem-tool"))
			detector.check(createToolUse("problem", "problem-tool"))
			const limitResult = detector.check(createToolUse("problem", "problem-tool")) // This reaches limit
			expect(limitResult.allowExecution).toBe(false)

			// The same tool that previously caused problems should now be allowed
			const result = detector.check(createToolUse("problem", "problem-tool"))
			expect(result.allowExecution).toBe(true)
		})

		it("should require reaching the limit again after reset", () => {
			const detector = new ToolRepetitionDetector(2)

			// Reach the limit
			detector.check(createToolUse("repeat", "repeat-tool"))
			detector.check(createToolUse("repeat", "repeat-tool"))
			const limitResult = detector.check(createToolUse("repeat", "repeat-tool")) // This reaches limit
			expect(limitResult.allowExecution).toBe(false)

			// First call after reset
			detector.check(createToolUse("repeat", "repeat-tool"))

			// Second call after reset
			detector.check(createToolUse("repeat", "repeat-tool"))

			// Third identical call (counter = 2) should reach limit again
			const result = detector.check(createToolUse("repeat", "repeat-tool"))
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})
	})

	// ===== Tool Name Interpolation tests =====
	describe("tool name interpolation", () => {
		it("should include tool name in the error message", () => {
			const detector = new ToolRepetitionDetector(2)
			const toolName = "special-tool-name"

			// Reach the limit
			detector.check(createToolUse("test", toolName))
			detector.check(createToolUse("test", toolName))
			const result = detector.check(createToolUse("test", toolName))

			expect(result.allowExecution).toBe(false)
			expect(result.askUser?.messageDetail).toContain(toolName)
		})
	})

	// ===== Edge Cases =====
	describe("edge cases", () => {
		it("should handle empty tool call", () => {
			const detector = new ToolRepetitionDetector(2)

			// Create an empty tool call - a tool with no parameters
			// Use the empty tool directly in the check calls
			detector.check(createToolUse("empty-tool", "empty-tool"))
			detector.check(createToolUse("empty-tool", "empty-tool"))
			const result = detector.check(createToolUse("empty-tool", "empty-tool"))

			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})

		it("should handle different tool names with identical serialized JSON", () => {
			const detector = new ToolRepetitionDetector(2)

			// First, call with tool-name-1 to set up the counter
			const toolUse1 = createToolUse("tool-name-1", "tool-name-1", { param: "value" })
			detector.check(toolUse1)

			// Create a tool that will serialize to the same JSON as toolUse1
			// We need to mock the serializeToolUse method to return the same value
			const toolUse2 = createToolUse("tool-name-2", "tool-name-2", { param: "value" })

			// Override the private method to force identical serialization
			const originalSerialize = (detector as any).serializeToolUse
			;(detector as any).serializeToolUse = (tool: ToolUse) => {
				// Use string comparison for the name since it's technically an enum
				if (String(tool.name) === "tool-name-2") {
					return originalSerialize.call(detector, toolUse1) // Return the same JSON as toolUse1
				}
				return originalSerialize.call(detector, tool)
			}

			// Second call - this should be considered identical due to our mock
			const result2 = detector.check(toolUse2)
			expect(result2.allowExecution).toBe(true) // Still allowed (counter = 1)

			// Third call - should be blocked (limit is 2)
			const result3 = detector.check(toolUse2)

			// Restore the original method
			;(detector as any).serializeToolUse = originalSerialize

			// Since we're directly manipulating the internal state for testing,
			// we expect it to consider this a repetition
			expect(result3.allowExecution).toBe(false)
			expect(result3.askUser).toBeDefined()
		})

		it("should treat tools with same parameters in different order as identical", () => {
			const detector = new ToolRepetitionDetector(2)

			// First call with parameters in one order
			const toolUse1 = createToolUse("same-tool", "same-tool", { a: "1", b: "2", c: "3" })
			detector.check(toolUse1)

			// Second call with same parameters but in different order
			const toolUse2 = createToolUse("same-tool", "same-tool", { c: "3", a: "1", b: "2" })
			detector.check(toolUse2)

			// Third call - should be blocked (limit is 2)
			const toolUse3 = createToolUse("same-tool", "same-tool", { b: "2", c: "3", a: "1" })
			const result = detector.check(toolUse3)

			// Since parameters are sorted alphabetically in the serialized JSON,
			// these should be considered identical
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})
	})

	// ===== Explicit Nth Call Blocking tests =====
	describe("explicit Nth call blocking behavior", () => {
		it("should allow the 1st call but block on the 2nd call for limit 1", () => {
			const detector = new ToolRepetitionDetector(1)

			// First call (counter = 0) should be allowed
			const result1 = detector.check(createToolUse("tool", "tool-name"))
			expect(result1.allowExecution).toBe(true)
			expect(result1.askUser).toBeUndefined()

			// Second identical call (counter = 1) should be blocked
			const result2 = detector.check(createToolUse("tool", "tool-name"))
			expect(result2.allowExecution).toBe(false)
			expect(result2.askUser).toBeDefined()
		})

		it("should allow first 2 calls but block on the 3rd call for limit 2", () => {
			const detector = new ToolRepetitionDetector(2)

			// First call (counter = 0)
			const result1 = detector.check(createToolUse("tool", "tool-name"))
			expect(result1.allowExecution).toBe(true)

			// Second identical call (counter = 1)
			const result2 = detector.check(createToolUse("tool", "tool-name"))
			expect(result2.allowExecution).toBe(true)

			// Third identical call (counter = 2) should be blocked
			const result3 = detector.check(createToolUse("tool", "tool-name"))
			expect(result3.allowExecution).toBe(false)
			expect(result3.askUser).toBeDefined()
		})

		it("should allow first 3 calls but block on the 4th call for limit 3 (default)", () => {
			const detector = new ToolRepetitionDetector(3)

			// First call (counter = 0)
			const result1 = detector.check(createToolUse("tool", "tool-name"))
			expect(result1.allowExecution).toBe(true)

			// Second identical call (counter = 1)
			const result2 = detector.check(createToolUse("tool", "tool-name"))
			expect(result2.allowExecution).toBe(true)

			// Third identical call (counter = 2)
			const result3 = detector.check(createToolUse("tool", "tool-name"))
			expect(result3.allowExecution).toBe(true)

			// Fourth identical call (counter = 3) should be blocked
			const result4 = detector.check(createToolUse("tool", "tool-name"))
			expect(result4.allowExecution).toBe(false)
			expect(result4.askUser).toBeDefined()
		})

		it("should never block when limit is 0 (unlimited)", () => {
			const detector = new ToolRepetitionDetector(0)

			// Try many identical calls
			for (let i = 0; i < 10; i++) {
				const result = detector.check(createToolUse("tool", "tool-name"))
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}
		})

		it("should handle different limits correctly", () => {
			// Test with limit of 5
			const detector5 = new ToolRepetitionDetector(5)
			const tool = createToolUse("tool", "tool-name")

			// First 5 calls should be allowed
			for (let i = 0; i < 5; i++) {
				const result = detector5.check(tool)
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}

			// 6th call should be blocked
			const result6 = detector5.check(tool)
			expect(result6.allowExecution).toBe(false)
			expect(result6.askUser).toBeDefined()
			expect(result6.askUser?.messageKey).toBe("mistake_limit_reached")
		})

		it("should reset counter after blocking and allow new attempts", () => {
			const detector = new ToolRepetitionDetector(2)
			const tool = createToolUse("tool", "tool-name")

			// First call allowed
			expect(detector.check(tool).allowExecution).toBe(true)

			// Second call allowed
			expect(detector.check(tool).allowExecution).toBe(true)

			// Third call should block (limit is 2)
			const blocked = detector.check(tool)
			expect(blocked.allowExecution).toBe(false)

			// After blocking, counter should reset and allow new attempts
			expect(detector.check(tool).allowExecution).toBe(true)
		})

		it("should handle negative limits as 0 (unlimited)", () => {
			const detector = new ToolRepetitionDetector(-1)

			// Should behave like unlimited
			for (let i = 0; i < 5; i++) {
				const result = detector.check(createToolUse("tool", "tool-name"))
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}
		})
	})

	// ===== Browser Scroll Action Exclusion tests =====
	describe("browser scroll action exclusion", () => {
		it("should not count browser scroll_down actions as repetitions", () => {
			const detector = new ToolRepetitionDetector(2)

			// Create browser_action tool use with scroll_down
			const scrollDownTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "scroll_down" },
				partial: false,
			}

			// Should allow unlimited scroll_down actions
			for (let i = 0; i < 10; i++) {
				const result = detector.check(scrollDownTool)
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}
		})

		it("should not count browser scroll_up actions as repetitions", () => {
			const detector = new ToolRepetitionDetector(2)

			// Create browser_action tool use with scroll_up
			const scrollUpTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "scroll_up" },
				partial: false,
			}

			// Should allow unlimited scroll_up actions
			for (let i = 0; i < 10; i++) {
				const result = detector.check(scrollUpTool)
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}
		})

		it("should not count alternating scroll_down and scroll_up as repetitions", () => {
			const detector = new ToolRepetitionDetector(2)

			const scrollDownTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "scroll_down" },
				partial: false,
			}

			const scrollUpTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "scroll_up" },
				partial: false,
			}

			// Alternate between scroll_down and scroll_up
			for (let i = 0; i < 5; i++) {
				let result = detector.check(scrollDownTool)
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()

				result = detector.check(scrollUpTool)
				expect(result.allowExecution).toBe(true)
				expect(result.askUser).toBeUndefined()
			}
		})

		it("should still apply repetition detection to other browser_action types", () => {
			const detector = new ToolRepetitionDetector(2)

			// Create browser_action tool use with click action
			const clickTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "click", coordinate: "[100, 200]" },
				partial: false,
			}

			// First call allowed
			expect(detector.check(clickTool).allowExecution).toBe(true)

			// Second call allowed
			expect(detector.check(clickTool).allowExecution).toBe(true)

			// Third identical call should be blocked (limit is 2)
			const result = detector.check(clickTool)
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})

		it("should still apply repetition detection to non-browser tools", () => {
			const detector = new ToolRepetitionDetector(2)

			const readFileTool = createToolUse("read_file", "read_file", { path: "test.txt" })

			// First call allowed
			expect(detector.check(readFileTool).allowExecution).toBe(true)

			// Second call allowed
			expect(detector.check(readFileTool).allowExecution).toBe(true)

			// Third identical call should be blocked (limit is 2)
			const result = detector.check(readFileTool)
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})

		it("should not interfere with repetition detection of other tools when scroll actions are interspersed", () => {
			const detector = new ToolRepetitionDetector(2)

			const scrollTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: { action: "scroll_down" },
				partial: false,
			}

			const otherTool = createToolUse("execute_command", "execute_command", { command: "ls" })

			// First execute_command
			expect(detector.check(otherTool).allowExecution).toBe(true)

			// Scroll actions in between (should not affect counter)
			expect(detector.check(scrollTool).allowExecution).toBe(true)
			expect(detector.check(scrollTool).allowExecution).toBe(true)

			// Second execute_command
			expect(detector.check(otherTool).allowExecution).toBe(true)

			// More scroll actions
			expect(detector.check(scrollTool).allowExecution).toBe(true)

			// Third execute_command should be blocked
			const result = detector.check(otherTool)
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})

		it("should handle browser_action with missing or invalid action parameter gracefully", () => {
			const detector = new ToolRepetitionDetector(2)

			// Browser action without action parameter
			const noActionTool: ToolUse = {
				type: "tool_use",
				name: "browser_action" as ToolName,
				params: {},
				partial: false,
			}

			// Should apply normal repetition detection
			expect(detector.check(noActionTool).allowExecution).toBe(true)
			expect(detector.check(noActionTool).allowExecution).toBe(true)
			const result = detector.check(noActionTool)
			expect(result.allowExecution).toBe(false)
			expect(result.askUser).toBeDefined()
		})
	})
})
