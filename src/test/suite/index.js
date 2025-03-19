/**
 * Main entry point for VS Code extension tests
 * This file is referenced in the Extension Tests launch configuration
 */
const path = require("path")
const Mocha = require("mocha")
const glob = require("glob")

// Set TEST_MODE for consistent test behavior
process.env.TEST_MODE = "true"
console.log("TEST_MODE set to:", process.env.TEST_MODE)
console.log("Platform:", process.platform)

// Load test helper for module aliasing
require("../test-helper")

/**
 * Use glob to discover and run all tests
 * @param {Object} options Mocha options
 * @returns {Promise<void>}
 */
function runTests(options = {}) {
	// Create the mocha test runner
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 10000,
		fullTrace: true,
		...options,
	})

	const testsRoot = path.resolve(__dirname, "..")

	return new Promise((resolve, reject) => {
		// Find all test files using glob
		glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
			if (err) {
				return reject(err)
			}

			// Add all files to the test suite
			files.forEach((f) => {
				console.log(`Adding test file: ${f}`)
				mocha.addFile(path.resolve(testsRoot, f))
			})

			try {
				// Run the tests
				mocha.run((failures) => {
					if (failures > 0) {
						reject(new Error(`${failures} tests failed.`))
					} else {
						resolve()
					}
				})
			} catch (err) {
				console.error("Error running tests:", err)
				reject(err)
			}
		})
	})
}

module.exports = {
	run: runTests,
}
