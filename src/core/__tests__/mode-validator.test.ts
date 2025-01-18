import { Mode, isToolAllowedForMode, getModeConfig, modes } from "../../shared/modes"
import { validateToolUse } from "../mode-validator"
import { TOOL_GROUPS } from "../../shared/tool-groups"
const [codeMode, architectMode, askMode] = modes.map((mode) => mode.slug)

describe("mode-validator", () => {
	describe("isToolAllowedForMode", () => {
		describe("code mode", () => {
			it("allows all code mode tools", () => {
				const mode = getModeConfig(codeMode)
				// Code mode has all groups
				Object.entries(TOOL_GROUPS).forEach(([_, tools]) => {
					tools.forEach((tool) => {
						expect(isToolAllowedForMode(tool, codeMode, [])).toBe(true)
					})
				})
			})

			it("disallows unknown tools", () => {
				expect(isToolAllowedForMode("unknown_tool" as any, codeMode, [])).toBe(false)
			})
		})

		describe("architect mode", () => {
			it("allows configured tools", () => {
				const mode = getModeConfig(architectMode)
				// Architect mode has read, browser, and mcp groups
				const architectTools = [...TOOL_GROUPS.read, ...TOOL_GROUPS.browser, ...TOOL_GROUPS.mcp]
				architectTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, architectMode, [])).toBe(true)
				})
			})
		})

		describe("ask mode", () => {
			it("allows configured tools", () => {
				const mode = getModeConfig(askMode)
				// Ask mode has read, browser, and mcp groups
				const askTools = [...TOOL_GROUPS.read, ...TOOL_GROUPS.browser, ...TOOL_GROUPS.mcp]
				askTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, askMode, [])).toBe(true)
				})
			})
		})

		describe("custom modes", () => {
			it("allows tools from custom mode configuration", () => {
				const customModes = [
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]
				// Should allow tools from read and edit groups
				expect(isToolAllowedForMode("read_file", "custom-mode", customModes)).toBe(true)
				expect(isToolAllowedForMode("write_to_file", "custom-mode", customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("execute_command", "custom-mode", customModes)).toBe(false)
			})

			it("allows custom mode to override built-in mode", () => {
				const customModes = [
					{
						slug: codeMode,
						name: "Custom Code Mode",
						roleDefinition: "Custom role",
						groups: ["read"] as const,
					},
				]
				// Should allow tools from read group
				expect(isToolAllowedForMode("read_file", codeMode, customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("write_to_file", codeMode, customModes)).toBe(false)
			})
		})
	})

	describe("validateToolUse", () => {
		it("throws error for disallowed tools in architect mode", () => {
			expect(() => validateToolUse("unknown_tool" as any, "architect", [])).toThrow(
				'Tool "unknown_tool" is not allowed in architect mode.',
			)
		})

		it("does not throw for allowed tools in architect mode", () => {
			expect(() => validateToolUse("read_file", "architect", [])).not.toThrow()
		})
	})
})
