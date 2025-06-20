import { getAttemptCompletionDescription } from "../attempt-completion"

describe("getAttemptCompletionDescription", () => {
	it("should NOT include command parameter in the description", () => {
		const args = {
			cwd: "/test/path",
			supportsComputerUse: false,
		}

		const description = getAttemptCompletionDescription(args)

		// Check that command parameter is NOT included (permanently disabled)
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

	it("should work when no args provided", () => {
		const description = getAttemptCompletionDescription()

		// Check that command parameter is NOT included (permanently disabled)
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
		}

		const description = getAttemptCompletionDescription(args)

		// Check example format
		expect(description).toContain("Example: Requesting to attempt completion with a result")
		expect(description).toContain("I've updated the CSS")
		expect(description).not.toContain("Example: Requesting to attempt completion with a result and command")
	})

	it("should contain core functionality description", () => {
		const description = getAttemptCompletionDescription()

		// Should contain core functionality
		const coreText = "After each tool use, the user will respond with the result of that tool use"
		expect(description).toContain(coreText)

		// Should contain the important note
		const importantNote = "IMPORTANT NOTE: This tool CANNOT be used until you've confirmed"
		expect(description).toContain(importantNote)

		// Should contain result parameter
		expect(description).toContain("- result: (required)")
	})
})
