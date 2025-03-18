/**
 * Dedicated test runner for Retry Decorator tests
 */
const path = require("path")
const Mocha = require("mocha")

// Create a new Mocha instance
const mocha = new Mocha({
	ui: "bdd",
	color: true,
	timeout: 30000, // 30 seconds for retry operations
})

// Add the compiled test file
mocha.addFile(path.join(__dirname, "../../../out/test/api/retry.test.js"))

// Run the tests
mocha.run((failures) => {
	process.on("exit", () => {
		process.exit(failures)
	})
})
