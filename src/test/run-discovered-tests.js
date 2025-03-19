/**
 * Script to run all discovered tests from the suite directory
 * This script avoids using glob patterns directly with vscode-test
 */
const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")

// Set TEST_MODE for consistent test behavior
process.env.TEST_MODE = "true"
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)
console.log("Platform:", process.platform)

// The directory where test references are stored
const suiteDir = path.join(__dirname, "suite")

/**
 * Runs the vscode-test command for all test files
 */
async function runDiscoveredTests() {
	// Ensure the suite directory exists
	if (!fs.existsSync(suiteDir)) {
		console.error("Error: Suite directory not found:", suiteDir)
		process.exit(1)
	}

	// Get all JavaScript test files from the suite directory
	const jsTestFiles = fs.readdirSync(suiteDir).filter((file) => file.endsWith(".test.js"))

	if (jsTestFiles.length === 0) {
		console.error("Error: No test files found in suite directory")
		process.exit(1)
	}

	console.log(`Found ${jsTestFiles.length} test files to run`)

	// Build the run command with all test files
	let runArgs = jsTestFiles.map((file) => `--run ./src/test/suite/${file}`).join(" ")

	// Build the full command
	const command = `npx --node-options=--force-node-api-uncaught-exceptions-policy=true vscode-test --pre-launch-hook="echo Running all discovered tests && node src/test/set-test-mode.js" ${runArgs}`

	console.log("Running command:", command)

	// Execute the command
	const child = exec(command, {
		env: { ...process.env, TEST_MODE: "true" },
	})

	// Forward stdout and stderr
	child.stdout.pipe(process.stdout)
	child.stderr.pipe(process.stderr)

	// Handle completion
	child.on("exit", (code) => {
		console.log(`Tests completed with exit code: ${code}`)
		process.exit(code)
	})
}

// Run the tests
runDiscoveredTests().catch((err) => {
	console.error("Error running tests:", err)
	process.exit(1)
})
