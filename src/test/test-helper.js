/**
 * Test helper for setting up the test environment
 * This file is required by test scripts and the mocha explorer
 */

// Set up TEST_MODE
process.env.TEST_MODE = "true"

// Set up module aliases for vscode
try {
	const moduleAlias = require("module-alias")

	// Register the alias for 'vscode'
	moduleAlias.addAlias("vscode", require("path").join(__dirname, "mock/vscode"))
	console.log("Successfully set up module alias for vscode")
} catch (err) {
	console.error("Failed to set up module alias:", err)
}

// Export a function that can be used to verify the test environment
module.exports = {
	isTestMode: () => process.env.TEST_MODE === "true",
}
