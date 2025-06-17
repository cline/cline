import { getObjectiveSection } from "../objective"
import type { CodeIndexManager } from "../../../../services/code-index/manager"

describe("getObjectiveSection", () => {
	// Mock CodeIndexManager with codebase search available
	const mockCodeIndexManagerEnabled = {
		isFeatureEnabled: true,
		isFeatureConfigured: true,
		isInitialized: true,
	} as CodeIndexManager

	// Mock CodeIndexManager with codebase search unavailable
	const mockCodeIndexManagerDisabled = {
		isFeatureEnabled: false,
		isFeatureConfigured: false,
		isInitialized: false,
	} as CodeIndexManager

	describe("when codebase_search is available", () => {
		it("should include codebase_search first enforcement in thinking process", () => {
			const objective = getObjectiveSection(mockCodeIndexManagerEnabled)

			// Check that the objective includes the codebase_search enforcement
			expect(objective).toContain(
				"if the task involves understanding existing code or functionality, you MUST use the `codebase_search` tool",
			)
			expect(objective).toContain("BEFORE using any other search or file exploration tools")
		})
	})

	describe("when codebase_search is not available", () => {
		it("should not include codebase_search enforcement", () => {
			const objective = getObjectiveSection(mockCodeIndexManagerDisabled)

			// Check that the objective does not include the codebase_search enforcement
			expect(objective).not.toContain("you MUST use the `codebase_search` tool")
			expect(objective).not.toContain("BEFORE using any other search or file exploration tools")
		})
	})

	it("should maintain proper structure regardless of codebase_search availability", () => {
		const objectiveEnabled = getObjectiveSection(mockCodeIndexManagerEnabled)
		const objectiveDisabled = getObjectiveSection(mockCodeIndexManagerDisabled)

		// Check that all numbered items are present in both cases
		for (const objective of [objectiveEnabled, objectiveDisabled]) {
			expect(objective).toContain("1. Analyze the user's task")
			expect(objective).toContain("2. Work through these goals sequentially")
			expect(objective).toContain("3. Remember, you have extensive capabilities")
			expect(objective).toContain("4. Once you've completed the user's task")
			expect(objective).toContain("5. The user may provide feedback")
		}
	})

	it("should include thinking tags guidance regardless of codebase_search availability", () => {
		const objectiveEnabled = getObjectiveSection(mockCodeIndexManagerEnabled)
		const objectiveDisabled = getObjectiveSection(mockCodeIndexManagerDisabled)

		// Check that thinking tags guidance is included in both cases
		for (const objective of [objectiveEnabled, objectiveDisabled]) {
			expect(objective).toContain("<thinking></thinking> tags")
			expect(objective).toContain("analyze the file structure provided in environment_details")
			expect(objective).toContain("think about which of the provided tools is the most relevant")
		}
	})

	it("should include parameter inference guidance regardless of codebase_search availability", () => {
		const objectiveEnabled = getObjectiveSection(mockCodeIndexManagerEnabled)
		const objectiveDisabled = getObjectiveSection(mockCodeIndexManagerDisabled)

		// Check parameter inference guidance in both cases
		for (const objective of [objectiveEnabled, objectiveDisabled]) {
			expect(objective).toContain("Go through each of the required parameters")
			expect(objective).toContain(
				"determine if the user has directly provided or given enough information to infer a value",
			)
			expect(objective).toContain("DO NOT invoke the tool (not even with fillers for the missing params)")
			expect(objective).toContain("ask_followup_question tool")
		}
	})
})
