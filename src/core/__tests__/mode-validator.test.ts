import { Mode, isToolAllowedForMode, TestToolName, getModeConfig, modes } from "../../shared/modes"
import { validateToolUse } from "../mode-validator"

const asTestTool = (tool: string): TestToolName => tool as TestToolName
const [codeMode, architectMode, askMode] = modes.map((mode) => mode.slug)

describe("mode-validator", () => {
	describe("isToolAllowedForMode", () => {
		describe("code mode", () => {
			it("allows all code mode tools", () => {
				const mode = getModeConfig(codeMode)
				mode.tools.forEach(([tool]) => {
					expect(isToolAllowedForMode(tool, codeMode)).toBe(true)
				})
			})

			it("disallows unknown tools", () => {
				expect(isToolAllowedForMode(asTestTool("unknown_tool"), codeMode)).toBe(false)
			})
		})

		describe("architect mode", () => {
			it("allows configured tools", () => {
				const mode = getModeConfig(architectMode)
				mode.tools.forEach(([tool]) => {
					expect(isToolAllowedForMode(tool, architectMode)).toBe(true)
				})
			})
		})

		describe("ask mode", () => {
			it("allows configured tools", () => {
				const mode = getModeConfig(askMode)
				mode.tools.forEach(([tool]) => {
					expect(isToolAllowedForMode(tool, askMode)).toBe(true)
				})
			})
		})
	})

	describe("validateToolUse", () => {
		it("throws error for disallowed tools in architect mode", () => {
			expect(() => validateToolUse("unknown_tool", "architect")).toThrow(
				'Tool "unknown_tool" is not allowed in architect mode.',
			)
		})

		it("does not throw for allowed tools in architect mode", () => {
			expect(() => validateToolUse("read_file", "architect")).not.toThrow()
		})
	})
})
