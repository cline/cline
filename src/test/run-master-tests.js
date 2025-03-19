/**
 * Master test script to run all or specific categories of tests
 * This script provides a single entry point for running tests with consistent environment settings
 */

// Set test environment
process.env.TEST_MODE = "true"
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)
console.log("Platform:", process.platform)

const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")

// Color helpers for pretty output
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	bold: "\x1b[1m",
}

// Available test categories
const TEST_CATEGORIES = {
	all: "All tests",
	extension: "VS Code extension tests",
	utils: "Utility tests (path, fs, etc.)",
	api: "API integration tests",
	path: "Path utility tests",
	coverage: "Run tests with coverage reporting",
}

/**
 * Run a command and return a promise
 * @param {string} command The command to run
 * @param {string[]} args The arguments to pass to the command
 * @param {Object} options Options for the child process
 * @returns {Promise<{exitCode: number, output: string}>} The exit code and output
 */
function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const cp = spawn(command, args, {
			stdio: "pipe",
			env: { ...process.env, TEST_MODE: "true" },
			shell: true,
			...options,
		})

		let stdout = ""
		let stderr = ""

		cp.stdout.on("data", (data) => {
			const str = data.toString()
			stdout += str
			process.stdout.write(str)
		})

		cp.stderr.on("data", (data) => {
			const str = data.toString()
			stderr += str
			process.stderr.write(str)
		})

		cp.on("error", (err) => {
			reject(err)
		})

		cp.on("close", (code) => {
			resolve({
				exitCode: code,
				output: stdout + stderr,
			})
		})
	})
}

/**
 * Run tests based on the specified category
 * @param {string} category The test category to run
 */
async function runTests(category) {
	console.log(`\n${colors.bold}${colors.cyan}=== Running ${TEST_CATEGORIES[category]} ====${colors.reset}\n`)

	try {
		// Always compile tests first
		console.log(`${colors.yellow}Compiling TypeScript tests...${colors.reset}`)
		await runCommand("npm", ["run", "compile-tests"])

		// Run the appropriate test command based on category
		switch (category) {
			case "all":
				console.log(`${colors.yellow}Running all tests...${colors.reset}`)
				await runCommand("npm", ["run", "test:reliable"])
				break
			case "extension":
				console.log(`${colors.yellow}Running VS Code extension tests...${colors.reset}`)
				await runCommand("npm", ["run", "test:core"])
				break
			case "utils":
				console.log(`${colors.yellow}Running utility tests...${colors.reset}`)
				await runCommand("npm", ["run", "test:utils"])
				break
			case "api":
				console.log(`${colors.yellow}Running API tests...${colors.reset}`)
				await runCommand("npm", ["run", "test:api"])
				break
			case "path":
				console.log(`${colors.yellow}Running path utility tests...${colors.reset}`)
				await runCommand("npm", ["run", "test:path"])
				break
			case "coverage":
				console.log(`${colors.yellow}Running tests with coverage reporting...${colors.reset}`)
				await runCommand("npm", ["run", "test:coverage"])
				break
			default:
				console.error(`${colors.red}Unknown test category: ${category}${colors.reset}`)
				process.exit(1)
		}

		console.log(`\n${colors.green}✅ Tests completed successfully!${colors.reset}`)
	} catch (error) {
		console.error(`${colors.red}❌ Error running tests:${colors.reset}`, error)
		process.exit(1)
	}
}

/**
 * Verify the test environment
 */
async function verifyTestEnvironment() {
	console.log(`${colors.yellow}Verifying test environment...${colors.reset}`)
	const result = await runCommand("npm", ["run", "test:verify"])

	if (result.exitCode !== 0) {
		console.error(`${colors.red}❌ Test environment verification failed${colors.reset}`)
		process.exit(1)
	}
}

/**
 * Display help information
 */
function showHelp() {
	console.log(`\n${colors.bold}${colors.magenta}Cline Test Runner${colors.reset}\n`)
	console.log("Usage: node run-master-tests.js [category]\n")
	console.log("Available test categories:")

	Object.entries(TEST_CATEGORIES).forEach(([key, description]) => {
		console.log(`  ${colors.cyan}${key.padEnd(10)}${colors.reset} ${description}`)
	})

	console.log("\nExamples:")
	console.log(`  ${colors.green}node run-master-tests.js${colors.reset}             Run all tests`)
	console.log(`  ${colors.green}node run-master-tests.js path${colors.reset}        Run path utility tests`)
	console.log(`  ${colors.green}node run-master-tests.js coverage${colors.reset}    Run tests with coverage`)
}

/**
 * Main function
 */
async function main() {
	const category = process.argv[2] || "all"

	if (category === "--help" || category === "-h") {
		showHelp()
		return
	}

	if (!TEST_CATEGORIES[category]) {
		console.error(`${colors.red}Unknown test category: ${category}${colors.reset}`)
		showHelp()
		process.exit(1)
	}

	// First verify the test environment
	await verifyTestEnvironment()

	// Then run the tests
	await runTests(category)
}

// Run the main function
main().catch((error) => {
	console.error(`${colors.red}Unhandled error:${colors.reset}`, error)
	process.exit(1)
})
