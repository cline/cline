import { shouldTriggerContextOverflowContingency, getContextOverflowMessage } from "../index"
import type { ModeConfig } from "@roo-code/types"

describe("Context Overflow Contingency", () => {
	const mockCustomModes: ModeConfig[] = [
		{
			slug: "test-mode",
			name: "Test Mode",
			roleDefinition: "Test role",
			groups: [],
			contextOverflowContingency: {
				enabled: true,
				message: "Custom overflow message",
				triggerTools: ["browser_action", "read_file"],
			},
		},
		{
			slug: "disabled-mode",
			name: "Disabled Mode",
			roleDefinition: "Disabled role",
			groups: [],
			contextOverflowContingency: {
				enabled: false,
			},
		},
	]

	describe("shouldTriggerContextOverflowContingency", () => {
		it("should return true when global setting is enabled", () => {
			const result = shouldTriggerContextOverflowContingency("code", [], "browser_action", {
				contextOverflowContingencyEnabled: true,
				contextOverflowContingencyTriggerTools: ["browser_action"],
			})
			expect(result).toBe(true)
		})

		it("should return false when global setting is disabled", () => {
			const result = shouldTriggerContextOverflowContingency("code", [], "browser_action", {
				contextOverflowContingencyEnabled: false,
			})
			expect(result).toBe(false)
		})

		it("should return true when mode-specific setting is enabled", () => {
			const result = shouldTriggerContextOverflowContingency("test-mode", mockCustomModes, "browser_action")
			expect(result).toBe(true)
		})

		it("should return false when mode-specific setting is disabled", () => {
			const result = shouldTriggerContextOverflowContingency("disabled-mode", mockCustomModes, "browser_action")
			expect(result).toBe(false)
		})

		it("should return false when tool is not in trigger list", () => {
			const result = shouldTriggerContextOverflowContingency("test-mode", mockCustomModes, "write_to_file")
			expect(result).toBe(false)
		})

		it("should return true when no tool is specified and contingency is enabled", () => {
			const result = shouldTriggerContextOverflowContingency("test-mode", mockCustomModes, undefined)
			expect(result).toBe(true)
		})

		it("should prioritize global settings over mode settings", () => {
			const result = shouldTriggerContextOverflowContingency("test-mode", mockCustomModes, "browser_action", {
				contextOverflowContingencyEnabled: true,
				contextOverflowContingencyTriggerTools: ["write_to_file"],
			})
			expect(result).toBe(false) // Global setting has different trigger tools
		})
	})

	describe("getContextOverflowMessage", () => {
		it("should return global message when available", () => {
			const result = getContextOverflowMessage("test-mode", mockCustomModes, {
				contextOverflowContingencyMessage: "Global overflow message",
			})
			expect(result).toBe("Global overflow message")
		})

		it("should return mode-specific message when global not available", () => {
			const result = getContextOverflowMessage("test-mode", mockCustomModes)
			expect(result).toBe("Custom overflow message")
		})

		it("should return default message when no custom message is available", () => {
			const result = getContextOverflowMessage("code", [])
			expect(result).toBe(
				"Task failed because of a context overflow, possibly because webpage returned from the browser was too big",
			)
		})

		it("should prioritize global message over mode message", () => {
			const result = getContextOverflowMessage("test-mode", mockCustomModes, {
				contextOverflowContingencyMessage: "Global message takes priority",
			})
			expect(result).toBe("Global message takes priority")
		})
	})
})
