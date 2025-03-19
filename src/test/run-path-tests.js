/**
 * Script to run path utility tests with TEST_MODE enabled
 */

// Set the TEST_MODE environment variable
process.env.TEST_MODE = "true"
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)
console.log("Running path tests with TEST_MODE enabled...\n")

// Run the tests using Mocha
const Mocha = require("mocha")
const path = require("path")

// Create the mocha instance
const mocha = new Mocha({
	ui: "bdd",
	color: true,
})

// Add the path test file
const outFile = path.resolve(__dirname, "..", "..", "out", "utils", "path.test.js")
mocha.addFile(outFile)

// Run the tests
mocha.run((failures) => {
	process.exitCode = failures ? 1 : 0
})
