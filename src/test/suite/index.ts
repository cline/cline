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
		"Shell Tests": [],
		"Other Tests": [],
	}

	// Log the total files being organized
	console.log(`Organizing ${files.length} test files into categories...`)

	files.forEach((file) => {
		const relativePath = path.relative(testsRoot, file).replace(/\\/g, "/")
		console.log(`Categorizing file: ${relativePath}`)

		let categorized = false

		// Check for Extension Tests
		if (relativePath.includes("test/suite/") || relativePath.includes("extension") || relativePath.includes("commands")) {
			categories["Extension Tests"].push(file)
			console.log(`  - Added to Extension Tests`)
			categorized = true
		}

		// Check for API Tests - expanded patterns
		else if (
			relativePath.includes("test/api/") ||
			relativePath.includes("api/") ||
			relativePath.includes("providers") ||
			relativePath.includes("transform") ||
			relativePath.includes("gemini") ||
			relativePath.includes("anthropic") ||
			relativePath.includes("openai") ||
			relativePath.includes("ollama")
		) {
			categories["API Tests"].push(file)
			console.log(`  - Added to API Tests`)
			categorized = true
		}

		// Check for Shell Tests
		else if (
			relativePath.includes("shell") ||
			relativePath.includes("terminal") ||
			relativePath.includes("command") ||
			relativePath.includes("exec")
		) {
			categories["Shell Tests"].push(file)
			console.log(`  - Added to Shell Tests`)
			categorized = true
		}

		// Check for Utility Tests - broader patterns
		else if (
			relativePath.includes("utils") ||
			relativePath.includes("util/") ||
			relativePath.includes("utilities") ||
			relativePath.includes("shared") ||
			relativePath.includes("helpers") ||
			relativePath.includes("common") ||
			relativePath.includes("path") ||
			relativePath.includes("fs") ||
			relativePath.includes("file") ||
			relativePath.includes("cost") ||
			relativePath.includes("test/utilities")
		) {
			categories["Utility Tests"].push(file)
			console.log(`  - Added to Utility Tests`)
			categorized = true
		}

		// Add to Other Tests if no match found
		if (!categorized) {
			categories["Other Tests"].push(file)
			console.log(`  - Added to Other Tests (no category matched)`)
		}
	})

	// Add summary counts
	Object.entries(categories).forEach(([category, testFiles]) => {
		console.log(`Category "${category}" contains ${testFiles.length} tests`)
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

		// Debug function to log which pattern found which files
		const runGlobWithDebug = async (pattern: string, options: any) => {
			console.log(`Searching with pattern: ${pattern}`)
			const matches = await glob(pattern, options)
			if (matches.length > 0) {
				console.log(`  - Pattern ${pattern} found ${matches.length} matches:`)
				matches.forEach((m) => console.log(`    * ${m}`))
			} else {
				console.log(`  - Pattern ${pattern} found no matches`)
			}
			return matches
		}

		// More comprehensive test discovery
		Promise.all([
			// Find all standard test files (singular "test")
			runGlobWithDebug("out/**/*.test.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/**/*.test.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

			// Find plural "tests" files (with dot)
			runGlobWithDebug("out/**/*.tests.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/**/*.tests.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

			// Find test files with different naming conventions
			runGlobWithDebug("out/**/*-test.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/**/*-test.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("out/**/*_test.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/**/*_test.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

			// Find spec files
			runGlobWithDebug("out/**/*.spec.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/**/*.spec.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

			// Look in specific directories where tests might be located
			runGlobWithDebug("out/test/**/*.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
			runGlobWithDebug("src/test/**/*.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

			// Specific directory searches
			runGlobWithDebug("out/api/**/*.js", { cwd: workspaceRoot }),
			runGlobWithDebug("out/utils/**/*.js", { cwd: workspaceRoot }),
			runGlobWithDebug("out/**/shell/**/*.js", { cwd: workspaceRoot }),
		])
			.then((results) => {
				// Flatten the arrays and resolve paths
				const allPaths = results
					.flat()
					.map((f) => path.resolve(workspaceRoot, f))
					// Remove duplicates
					.filter((f, i, a) => a.indexOf(f) === i)

				console.log(`\n\nSUMMARY: Found ${allPaths.length} unique test files in total`)

				// Try one more check for any files that might be tests but we missed
				// by looking for 'test' in the filename without extension restrictions
				if (allPaths.length < 8) {
					console.log("Too few tests found! Trying broader search patterns...")
					return Promise.all([
						// First try a focused approach looking for exactly .tests. files
						runGlobWithDebug("**/*.tests.js", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("**/*.tests.ts", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),

						// Then try broader patterns
						runGlobWithDebug("out/**/*test*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("src/**/*test*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("out/**/*spec*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("src/**/*spec*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("out/test/**/*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
						runGlobWithDebug("src/test/**/*.*", { cwd: workspaceRoot, ignore: "**/node_modules/**" }),
					]).then((moreResults) => {
						const morePaths = moreResults
							.flat()
							.map((f) => path.resolve(workspaceRoot, f))
							.filter((f) => !allPaths.includes(f)) // Only add files we haven't already found

						console.log(`Found ${morePaths.length} additional test files with broader search`)

						// Combine all found paths
						const combinedPaths = [...allPaths, ...morePaths].filter((f, i, a) => a.indexOf(f) === i) // Ensure still unique

						// If we STILL haven't found tests, this will be our last resort
						if (combinedPaths.length < 8) {
							console.log("STILL too few tests! Using last-resort search approach...")

							// List all .js files and look for test-like names
							return glob("**/*.{js,ts}", {
								cwd: workspaceRoot,
								ignore: ["**/node_modules/**", "**/out/node_modules/**"],
							}).then((allFiles) => {
								console.log(`Examining ${allFiles.length} total .js and .ts files...`)

								// Filter to find potential test files
								const potentialTests = allFiles.filter((file) => {
									const lowerFile = file.toLowerCase()
									return (
										lowerFile.includes("test") ||
										lowerFile.includes("spec") ||
										lowerFile.includes("suite") ||
										lowerFile.endsWith(".tests.js") ||
										lowerFile.endsWith(".tests.ts")
									)
								})

								console.log(`Found ${potentialTests.length} potential test files by name`)
								potentialTests.forEach((f) => console.log(`  * ${f}`))

								// Add these to our combined paths
								const morePaths2 = potentialTests
									.map((f) => path.resolve(workspaceRoot, f))
									.filter((f) => !combinedPaths.includes(f))

								const finalPaths = [...combinedPaths, ...morePaths2].filter((f, i, a) => a.indexOf(f) === i)

								console.log(`Total test files found after all searches: ${finalPaths.length}`)
								return processPaths(finalPaths)
							})
						}

						return processPaths(combinedPaths)
					})
				}

				return processPaths(allPaths)
			})
			.catch((err: Error) => {
				console.error("Error discovering tests:", err)
				reject(err)
			})

		// Function to process test paths and continue with test running
		function processPaths(paths: string[]) {
			console.log(`Processing ${paths.length} test paths`)

			// Debug - log each found file
			paths.forEach((file) => {
				const relativePath = path.relative(workspaceRoot, file)
				console.log(`Found test file: ${relativePath}`)
			})

			if (paths.length === 0) {
				console.warn("No test files found! Verify your glob patterns.")
				return resolve()
			}

			// Organize tests by category
			const categories = organizeTestFiles(paths, testsRoot)

			// Log discovered tests by category
			Object.entries(categories).forEach(([category, testFiles]) => {
				if (testFiles.length > 0) {
					console.log(`\n${category} (${testFiles.length} files):`)
					testFiles.forEach((file) => {
						console.log(`  - ${path.relative(testsRoot, file)}`)
						// Add the file to mocha
						mocha.addFile(file)
					})
				}
			})

			// Run the mocha test
			try {
				// Make sure we add any leftover "Other Tests" to Mocha as well
				if (categories["Other Tests"].length > 0) {
					console.log(`\nOther Tests (${categories["Other Tests"].length} files):`)
					categories["Other Tests"].forEach((file) => {
						console.log(`  - ${path.relative(testsRoot, file)}`)
						// Add the file to mocha
						mocha.addFile(file)
					})
					console.log("All 'Other Tests' have been added to the test suite.")
				}

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
		}
	})
}
