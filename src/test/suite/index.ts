import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as fs from "fs"

/**
 * Ensures TEST_MODE environment variable is set
 */
function ensureTestMode() {
	if (!process.env.TEST_MODE) {
		process.env.TEST_MODE = "true"
		console.log("Setting TEST_MODE environment variable to true for tests")
	} else {
		console.log("TEST_MODE already set to:", process.env.TEST_MODE)
	}
}

/**
 * Organizes test files into appropriate categories.
 * This function groups tests by their containing directories to create
 * a more structured test suite.
 */
function organizeTestFiles(files: string[], testsRoot: string): { [category: string]: string[] } {
	const categories: { [category: string]: string[] } = {
		"Extension Tests": [],
		"API Tests": [],
		"Utility Tests": [],
		"Other Tests": [],
	}

	files.forEach((file) => {
		const relativePath = path.relative(testsRoot, file).replace(/\\/g, "/")

		if (relativePath.includes("test/suite/")) {
			categories["Extension Tests"].push(file)
		} else if (relativePath.includes("test/api/")) {
			categories["API Tests"].push(file)
		} else if (relativePath.includes("utils/") || relativePath.includes("test/utilities/")) {
			categories["Utility Tests"].push(file)
		} else {
			categories["Other Tests"].push(file)
		}
	})

	return categories
}

export function run(): Promise<void> {
	// Ensure TEST_MODE is set
	ensureTestMode()

	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 20000,
		fullTrace: true,
	})

	const testsRoot = path.resolve(__dirname, "../..")
	const workspaceRoot = path.resolve(testsRoot, "../")

	// Load module aliases to replace 'vscode' imports with our mock
	try {
		require("../test-helper")
		console.log("Loaded test helper for module aliasing")
	} catch (err) {
		console.warn("Could not load test helper:", err)
	}

	return new Promise<void>((resolve, reject) => {
		console.log(`Discovering tests in workspaceRoot: ${workspaceRoot}`)
		console.log(`Starting from testsRoot: ${testsRoot}`)

		// Combine different glob patterns to find all test files
		Promise.all([
			// Find compiled JS test files in the out directory
			glob("out/**/*.test.js", { cwd: workspaceRoot }),

			// Find TypeScript test files in the src directory
			glob("src/**/*.test.ts", { cwd: workspaceRoot }),

			// Find reference files in the suite directory
			glob("src/test/suite/*.js", { cwd: workspaceRoot }),
		])
			.then(([outTests, srcTests, refTests]) => {
				const outTestPaths = outTests.map((f) => path.resolve(workspaceRoot, f))
				const srcTestPaths = srcTests.map((f) => path.resolve(workspaceRoot, f))

				// Filter reference files to only include those that are test references
				const refTestPaths = refTests
					.filter((f) => f.includes("-test") || f.includes(".test."))
					.map((f) => path.resolve(workspaceRoot, f))

				// Combine all unique test paths
				const allTestPaths = [...new Set([...outTestPaths, ...srcTestPaths, ...refTestPaths])]

				if (allTestPaths.length === 0) {
					console.warn("No test files found!")
					return resolve()
				}

				console.log(
					`Found ${allTestPaths.length} test files (${outTestPaths.length} compiled, ${srcTestPaths.length} source, ${refTestPaths.length} references)`,
				)

				// Organize tests by category
				const categories = organizeTestFiles(allTestPaths, testsRoot)

				// Log discovered tests by category
				Object.entries(categories).forEach(([category, testFiles]) => {
					if (testFiles.length > 0) {
						console.log(`\n${category} (${testFiles.length} files):`)
						testFiles.forEach((file) => {
							console.log(`  - ${path.relative(testsRoot, file)}`)
							mocha.addFile(file)
						})
					}
				})

				try {
					// Run the mocha test
					mocha.run((failures: number) => {
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
			.catch((err: Error) => {
				console.error("Error discovering tests:", err)
				reject(err)
			})
	})
}
