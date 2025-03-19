/**
 * Special test loader for VS Code Test Explorer
 * This script helps VS Code find and run all the tests in the project
 */

// Set TEST_MODE for consistent test behavior
process.env.TEST_MODE = "true"
console.log("TEST_MODE set to", process.env.TEST_MODE)

// Require the test helper to set up module aliasing for vscode
try {
	require("./test-helper")
	console.log("Successfully loaded test helper")
} catch (err) {
	console.error("Error loading test helper:", err)
}

const fs = require("fs")
const path = require("path")
const Mocha = require("mocha")

// Recursively get all JS test files
function findTestFiles(dir, testFiles = []) {
	const files = fs.readdirSync(dir)

	for (const file of files) {
		const filePath = path.join(dir, file)
		const stat = fs.statSync(filePath)

		if (stat.isDirectory()) {
			findTestFiles(filePath, testFiles)
		} else if (file.endsWith(".test.js")) {
			console.log("Found test file:", filePath)
			testFiles.push(filePath)
		}
	}

	return testFiles
}

// Export function to run all tests
exports.run = () => {
	// Create a new Mocha instance
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 20000,
	})

	// Get the workspace root directory
	const workspaceRoot = path.resolve(__dirname, "../..")
	const outDir = path.join(workspaceRoot, "out")

	console.log("Looking for tests in:", workspaceRoot)

	// Find all test files
	const testFiles = findTestFiles(outDir)
	console.log(`Found ${testFiles.length} test files`)

	// Add each test file to Mocha
	testFiles.forEach((file) => {
		mocha.addFile(file)
	})

	// Run the tests
	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed`))
			} else {
				resolve()
			}
		})
	})
}
