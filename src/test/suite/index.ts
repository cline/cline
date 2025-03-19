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

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 20000,
		fullTrace: true,
	})

	const testsRoot = path.resolve(__dirname, "../..")

	return new Promise<void>((resolve, reject) => {
		console.log(`Discovering tests in: ${testsRoot}`)

		// Discover all test files
		glob("**/*.test.js", { cwd: testsRoot })
			.then((files: string[]) => {
				if (files.length === 0) {
					console.warn("No test files found!")
					return resolve()
				}

				console.log(`Found ${files.length} test files`)

				// Organize tests by category
				const categories = organizeTestFiles(
					files.map((f) => path.resolve(testsRoot, f)),
					testsRoot,
				)

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
