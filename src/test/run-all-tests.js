/**
 * Custom script to run all tests with the TEST_MODE environment variable set
 * This ensures consistent behavior across all test categories
 */

// Set TEST_MODE environment variable
process.env.TEST_MODE = "true"
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)
console.log("Platform:", process.platform)

// Function to spawn a child process and run a command
function runCommand(command) {
	return new Promise((resolve, reject) => {
		const { spawn } = require("child_process")

		// Split the command into the executable and arguments
		const parts = command.split(" ")
		const cmd = parts[0]
		const args = parts.slice(1)

		console.log(`\n\n==== Running: ${command} ====\n`)

		// Spawn the child process
		const child = spawn(cmd, args, {
			stdio: "inherit",
			shell: true,
			env: { ...process.env, TEST_MODE: "true" },
		})

		// Handle completion
		child.on("close", (code) => {
			if (code === 0) {
				console.log(`\n✅ Command succeeded: ${command}`)
				resolve()
			} else {
				console.error(`\n❌ Command failed with code ${code}: ${command}`)
				reject(new Error(`Command failed with code ${code}`))
			}
		})
	})
}

// Main async function to run all tests
async function runAllTests() {
	try {
		// First compile the tests
		await runCommand("npm run compile-tests")

		// Run extension tests first
		await runCommand(
			'node node_modules/@vscode/test-cli/out/main.js --pre-launch-hook="echo Running extension tests && node src/test/set-test-mode.js" --run ./src/test/suite/extension.test.js --run ./out/test/suite/api-tests.test.js',
		)

		// Run utility tests
		await runCommand("node src/test/run-path-tests.js")
		await runCommand(
			'node node_modules/@vscode/test-cli/out/main.js --pre-launch-hook="echo Running utility tests && node src/test/set-test-mode.js" --run ./out/utils/cost.test.js --run ./out/utils/fs.test.js',
		)

		// Run API tests
		await runCommand(
			'node node_modules/@vscode/test-cli/out/main.js --pre-launch-hook="echo Running API tests && node src/test/set-test-mode.js" --run ./out/test/api/retry.test.js --run ./out/test/api/transform/gemini-format.test.js --run ./out/test/api/providers/gemini.test.js',
		)

		console.log("\n\n✅ All tests completed successfully!")
		process.exit(0)
	} catch (error) {
		console.error("\n\n❌ Test suite failed:", error.message)
		process.exit(1)
	}
}

// Run the tests
runAllTests()
