import { getToolUseGuidelinesSection } from "../tool-use-guidelines"
import { CodeIndexManager } from "../../../../services/code-index/manager"

describe("getToolUseGuidelinesSection", () => {
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
		it("should include codebase_search first enforcement", () => {
			const guidelines = getToolUseGuidelinesSection(mockCodeIndexManagerEnabled)

			// Check that the guidelines include the codebase_search enforcement
			expect(guidelines).toContain(
				"IMPORTANT: When starting a new task or when you need to understand existing code/functionality, you MUST use the `codebase_search` tool FIRST",
			)
			expect(guidelines).toContain("before any other search tools")
			expect(guidelines).toContain(
				"semantic search tool helps you find relevant code based on meaning rather than just keywords",
			)
		})

		it("should maintain proper numbering with codebase_search", () => {
			const guidelines = getToolUseGuidelinesSection(mockCodeIndexManagerEnabled)

			// Check that all numbered items are present
			expect(guidelines).toContain("1. In <thinking> tags")
			expect(guidelines).toContain("2. **IMPORTANT:")
			expect(guidelines).toContain("3. Choose the most appropriate tool")
			expect(guidelines).toContain("4. If multiple actions are needed")
			expect(guidelines).toContain("5. Formulate your tool use")
			expect(guidelines).toContain("6. After each tool use")
			expect(guidelines).toContain("7. ALWAYS wait for user confirmation")
		})
	})

	describe("when codebase_search is not available", () => {
		it("should not include codebase_search enforcement", () => {
			const guidelines = getToolUseGuidelinesSection(mockCodeIndexManagerDisabled)

			// Check that the guidelines do not include the codebase_search enforcement
			expect(guidelines).not.toContain(
				"IMPORTANT: When starting a new task or when you need to understand existing code/functionality, you MUST use the `codebase_search` tool FIRST",
			)
			expect(guidelines).not.toContain("semantic search tool helps you find relevant code based on meaning")
		})

		it("should maintain proper numbering without codebase_search", () => {
			const guidelines = getToolUseGuidelinesSection(mockCodeIndexManagerDisabled)

			// Check that all numbered items are present with correct numbering
			expect(guidelines).toContain("1. In <thinking> tags")
			expect(guidelines).toContain("2. Choose the most appropriate tool")
			expect(guidelines).toContain("3. If multiple actions are needed")
			expect(guidelines).toContain("4. Formulate your tool use")
			expect(guidelines).toContain("5. After each tool use")
			expect(guidelines).toContain("6. ALWAYS wait for user confirmation")
		})
	})

	it("should include iterative process guidelines regardless of codebase_search availability", () => {
		const guidelinesEnabled = getToolUseGuidelinesSection(mockCodeIndexManagerEnabled)
		const guidelinesDisabled = getToolUseGuidelinesSection(mockCodeIndexManagerDisabled)

		// Check that the iterative process section is included in both cases
		for (const guidelines of [guidelinesEnabled, guidelinesDisabled]) {
			expect(guidelines).toContain("It is crucial to proceed step-by-step")
			expect(guidelines).toContain("1. Confirm the success of each step before proceeding")
			expect(guidelines).toContain("2. Address any issues or errors that arise immediately")
			expect(guidelines).toContain("3. Adapt your approach based on new information")
			expect(guidelines).toContain("4. Ensure that each action builds correctly")
		}
	})
})
