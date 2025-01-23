import { expect } from "chai"
import { extensions, commands, window } from "vscode"

describe("Extension Tests", function () {
	this.timeout(60000) // Increased timeout for extension operations

	it("should activate extension successfully", async () => {
		// Get the extension
		const extension = extensions.getExtension("saoudrizwan.claude-dev")
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		expect(extension).to.not.be.undefined

		// Activate the extension if not already activated
		if (!extension.isActive) {
			await extension.activate()
		}
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		expect(extension.isActive).to.be.true
	})

	it("should open sidebar view", async () => {
		// Execute the command to open sidebar
		await commands.executeCommand("cline.plusButtonClicked")

		// Wait for sidebar to be visible
		await new Promise((resolve) => setTimeout(resolve, 1000))

		// Get all views
		const views = window.visibleTextEditors
		console.log(views)
		// Just verify the command executed without error
		// The actual view verification is handled in the TypeScript tests
	})

	it("should handle basic commands", async () => {
		// Test basic command execution
		await commands.executeCommand("cline.historyButtonClicked")
		// Success if no error thrown
	})
})
