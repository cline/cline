import type { PromptComponent } from "@roo-code/types"

import { getModeSelection, modes } from "../modes"

describe("getModeSelection with empty promptComponent", () => {
	it("should use built-in mode instructions when promptComponent is undefined", () => {
		const architectMode = modes.find((m) => m.slug === "architect")!

		// Test with undefined promptComponent (which is what getPromptComponent returns for empty objects)
		const result = getModeSelection("architect", undefined, [])

		// Should use built-in mode values
		expect(result.roleDefinition).toBe(architectMode.roleDefinition)
		expect(result.baseInstructions).toBe(architectMode.customInstructions)
		expect(result.baseInstructions).toContain("Do some information gathering")
	})

	it("should use built-in mode instructions when promptComponent is null", () => {
		const debugMode = modes.find((m) => m.slug === "debug")!

		// Test with null promptComponent
		const result = getModeSelection("debug", null as any, [])

		// Should use built-in mode values
		expect(result.roleDefinition).toBe(debugMode.roleDefinition)
		expect(result.baseInstructions).toBe(debugMode.customInstructions)
		expect(result.baseInstructions).toContain("Reflect on 5-7 different possible sources")
	})

	it("should use promptComponent when it has actual content", () => {
		// Test with promptComponent that has actual content
		const validPromptComponent: PromptComponent = {
			roleDefinition: "Custom role",
			customInstructions: "Custom instructions",
		}
		const result = getModeSelection("architect", validPromptComponent, [])

		// Should use promptComponent values
		expect(result.roleDefinition).toBe("Custom role")
		expect(result.baseInstructions).toBe("Custom instructions")
	})

	it("should merge promptComponent with built-in mode when it has partial content", () => {
		const architectMode = modes.find((m) => m.slug === "architect")!

		// Test with promptComponent that only has customInstructions
		const partialPromptComponent: PromptComponent = {
			customInstructions: "Only custom instructions",
		}
		const result = getModeSelection("architect", partialPromptComponent, [])

		// Should merge: use promptComponent's customInstructions but fall back to built-in roleDefinition
		expect(result.roleDefinition).toBe(architectMode.roleDefinition) // Falls back to built-in
		expect(result.baseInstructions).toBe("Only custom instructions") // Uses promptComponent
	})

	it("should merge promptComponent with built-in mode when it only has roleDefinition", () => {
		const debugMode = modes.find((m) => m.slug === "debug")!

		// Test with promptComponent that only has roleDefinition
		const partialPromptComponent: PromptComponent = {
			roleDefinition: "Custom debug role",
		}
		const result = getModeSelection("debug", partialPromptComponent, [])

		// Should merge: use promptComponent's roleDefinition but fall back to built-in customInstructions
		expect(result.roleDefinition).toBe("Custom debug role") // Uses promptComponent
		expect(result.baseInstructions).toBe(debugMode.customInstructions) // Falls back to built-in
	})

	it("should handle promptComponent with both roleDefinition and customInstructions", () => {
		// Test with promptComponent that has both properties
		const fullPromptComponent: PromptComponent = {
			roleDefinition: "Full custom role",
			customInstructions: "Full custom instructions",
		}
		const result = getModeSelection("architect", fullPromptComponent, [])

		// Should use promptComponent values for both
		expect(result.roleDefinition).toBe("Full custom role")
		expect(result.baseInstructions).toBe("Full custom instructions")
	})

	it("should fall back to default mode when built-in mode is not found", () => {
		const defaultMode = modes[0] // First mode is the default

		// Test with non-existent mode
		const partialPromptComponent: PromptComponent = {
			customInstructions: "Custom instructions for unknown mode",
		}
		const result = getModeSelection("non-existent-mode", partialPromptComponent, [])

		// Should merge with default mode
		expect(result.roleDefinition).toBe(defaultMode.roleDefinition) // Falls back to default mode
		expect(result.baseInstructions).toBe("Custom instructions for unknown mode") // Uses promptComponent
	})
})
