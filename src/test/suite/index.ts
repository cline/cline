import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as fs from "fs"

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

/**
 * Ensures TEST_MODE environment variable is set to true for consistent test behavior
 */
function ensureTestMode(): void {
	if (!process.env.TEST_MODE) {
		process.env.TEST_MODE = "true"
		console.log("Setting TEST_MODE environment variable to true for tests")
	} else {
		console.log("TEST_MODE already set to:", process.env.TEST_MODE)
	}
}

/**
 * Gets a list of test files from reference files in the suite directory
 * @param suiteDir The suite directory containing reference files
 * @returns Array of resolved test file paths
 */
async function getTestsFromReferences(suiteDir: string): Promise<string[]> {
	// Look for reference files created by setup-test-discovery.js
	const refFiles = await glob("*-*.js", { cwd: suiteDir })
	const testFiles: string[] = []

	console.log(`Found ${refFiles.length} reference files in suite directory`)

	for (const refFile of refFiles) {
		try {
			const fullPath = path.join(suiteDir, refFile)
			const content = fs.readFileSync(fullPath, "utf8")

			// Extract the actual test file path from the reference
			const match = content.match(/require\(['"](.*)['"]\)/)
			if (match && match[1]) {
				const testPath = match[1].replace(/\\/g, "/")

				// Convert to absolute path if needed
				if (path.isAbsolute(testPath)) {
					testFiles.push(testPath)
				} else {
					// Assume it's relative to the workspace root
					const absPath = path.resolve(process.cwd(), testPath)
					testFiles.push(absPath)
				}
			}
		} catch (error) {
			console.error(`Error reading reference file ${refFile}:`, error)
		}
	}

	return testFiles
}

export function run(): Promise<void> {
	// Set TEST_MODE for consistent test behavior
	ensureTestMode()

	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 20000,
		fullTrace: true,
	})

	const testsRoot = path.resolve(__dirname, "../..")
	const suiteDir = path.resolve(__dirname) // Current directory (suite)

	return new Promise<void>((resolve, reject) => {
		console.log(`Discovering tests in: ${testsRoot}`)

		// Combine tests from references and direct glob pattern
		Promise.all([
			// Get tests from reference files
			getTestsFromReferences(suiteDir),

			// Also do direct glob search as a fallback
			glob("**/*.test.js", { cwd: testsRoot }).then((files) => files.map((f) => path.resolve(testsRoot, f))),
		])
			.then(([refTests, globTests]) => {
				// Combine both approaches and remove duplicates
				const allPaths = [...new Set([...refTests, ...globTests])]

				if (allPaths.length === 0) {
					console.warn("No test files found! Did you run test:setup-discovery?")
					return resolve()
				}

				console.log(
					`Found ${allPaths.length} total test files (${refTests.length} from references, ${globTests.length} from glob)`,
				)

				// Organize tests by category
				const categories = organizeTestFiles(allPaths, testsRoot)

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
