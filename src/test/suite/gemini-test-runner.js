/**
 * Dedicated test runner for Gemini API integration tests
 */
const path = require("path")
const Mocha = require("mocha")

// Create a new Mocha instance
const mocha = new Mocha({
	ui: "bdd",
	color: true,
	timeout: 60000, // 60 seconds for API operations
})

// Add the compiled test file
mocha.addFile(path.join(__dirname, "../../../out/test/api/providers/gemini.test.js"))

// Run the tests
mocha.run((failures) => {
	process.on("exit", () => {
		process.exit(failures)
	})
})
