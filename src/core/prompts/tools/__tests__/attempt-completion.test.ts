import { getAttemptCompletionDescription } from "../attempt-completion"
import { EXPERIMENT_IDS } from "../../../../shared/experiments"

describe("getAttemptCompletionDescription - DISABLE_COMPLETION_COMMAND experiment", () => {
	describe("when experiment is disabled (default)", () => {
		it("should include command parameter in the description", () => {
			const args = {
				cwd: "/test/path",
				supportsComputerUse: false,
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: false,
				},
			}

			const description = getAttemptCompletionDescription(args)

			// Check that command parameter is included
			expect(description).toContain("- command: (optional)")
			expect(description).toContain("A CLI command to execute to show a live demo")
			expect(description).toContain("<command>Command to demonstrate result (optional)</command>")
			expect(description).toContain("<command>open index.html</command>")
		})

		it("should include command parameter when experiments is undefined", () => {
			const args = {
				cwd: "/test/path",
				supportsComputerUse: false,
			}

			const description = getAttemptCompletionDescription(args)

			// Check that command parameter is included
			expect(description).toContain("- command: (optional)")
			expect(description).toContain("A CLI command to execute to show a live demo")
			expect(description).toContain("<command>Command to demonstrate result (optional)</command>")
			expect(description).toContain("<command>open index.html</command>")
		})

		it("should include command parameter when no args provided", () => {
			const description = getAttemptCompletionDescription()

			// Check that command parameter is included
			expect(description).toContain("- command: (optional)")
			expect(description).toContain("A CLI command to execute to show a live demo")
			expect(description).toContain("<command>Command to demonstrate result (optional)</command>")
			expect(description).toContain("<command>open index.html</command>")
		})
	})

	describe("when experiment is enabled", () => {
		it("should NOT include command parameter in the description", () => {
			const args = {
				cwd: "/test/path",
				supportsComputerUse: false,
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: true,
				},
			}

			const description = getAttemptCompletionDescription(args)

			// Check that command parameter is NOT included
			expect(description).not.toContain("- command: (optional)")
			expect(description).not.toContain("A CLI command to execute to show a live demo")
			expect(description).not.toContain("<command>Command to demonstrate result (optional)</command>")
			expect(description).not.toContain("<command>open index.html</command>")

			// But should still have the basic structure
			expect(description).toContain("## attempt_completion")
			expect(description).toContain("- result: (required)")
			expect(description).toContain("<attempt_completion>")
			expect(description).toContain("</attempt_completion>")
		})

		it("should show example without command", () => {
			const args = {
				cwd: "/test/path",
				supportsComputerUse: false,
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: true,
				},
			}

			const description = getAttemptCompletionDescription(args)

			// Check example format
			expect(description).toContain("Example: Requesting to attempt completion with a result")
			expect(description).toContain("I've updated the CSS")
			expect(description).not.toContain("Example: Requesting to attempt completion with a result and command")
		})
	})

	describe("description content", () => {
		it("should maintain core functionality description regardless of experiment", () => {
			const argsWithExperimentDisabled = {
				cwd: "/test/path",
				supportsComputerUse: false,
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: false,
				},
			}

			const argsWithExperimentEnabled = {
				cwd: "/test/path",
				supportsComputerUse: false,
				experiments: {
					[EXPERIMENT_IDS.DISABLE_COMPLETION_COMMAND]: true,
				},
			}

			const descriptionDisabled = getAttemptCompletionDescription(argsWithExperimentDisabled)
			const descriptionEnabled = getAttemptCompletionDescription(argsWithExperimentEnabled)

			// Both should contain core functionality
			const coreText = "After each tool use, the user will respond with the result of that tool use"
			expect(descriptionDisabled).toContain(coreText)
			expect(descriptionEnabled).toContain(coreText)

			// Both should contain the important note
			const importantNote = "IMPORTANT NOTE: This tool CANNOT be used until you've confirmed"
			expect(descriptionDisabled).toContain(importantNote)
			expect(descriptionEnabled).toContain(importantNote)

			// Both should contain result parameter
			expect(descriptionDisabled).toContain("- result: (required)")
			expect(descriptionEnabled).toContain("- result: (required)")
		})
	})
})
