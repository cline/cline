/**
 * Custom script to run the path utility tests with the TEST_MODE environment variable set
 */

// Set TEST_MODE environment variable
process.env.TEST_MODE = "true"
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)

// Use Mocha directly to run the tests
const Mocha = require("mocha")
const path = require("path")

// Create a new Mocha instance
const mocha = new Mocha({
	timeout: 10000,
	color: true,
})

// Add the path test file
const testFile = path.resolve(__dirname, "../../out/utils/path.test.js")
mocha.addFile(testFile)

// Run the tests
console.log("Running path tests with TEST_MODE enabled...")
mocha.run((failures) => {
	process.exitCode = failures ? 1 : 0
})
