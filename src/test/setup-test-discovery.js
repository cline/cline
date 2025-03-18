const fs = require("fs")
const path = require("path")
const { glob } = require("glob")

/**
 * Creates test file references in the suite directory to make them discoverable
 * by VS Code Test Explorer. Uses copying instead of symlinks for Windows compatibility.
 */
async function setupTestDiscovery() {
	const rootDir = path.resolve(__dirname, "../..")
	const suiteDir = path.resolve(__dirname, "suite")

	// Ensure suite directory exists
	if (!fs.existsSync(suiteDir)) {
		fs.mkdirSync(suiteDir, { recursive: true })
	}

	// Create a test helper file for common setup
	const helperPath = path.join(suiteDir, "test-helper.js")
	const helperContent = `// Common test setup for all tests
// This file is auto-generated and loads the main test helper
try {
	require("../test-helper")
} catch (err) {
	console.error("Error loading test helper:", err)
}
process.env.TEST_MODE = "true"
`
	fs.writeFileSync(helperPath, helperContent)

	// Find all test files
	const testFiles = await glob(["out/**/*.test.js", "src/test/**/*.test.ts", "src/test/**/*.test.js"], {
		cwd: rootDir,
		absolute: true,
	})

	console.log(`Found ${testFiles.length} test files to process`)

	// Create test file references in the suite directory
	for (const file of testFiles) {
		// Don't process files already in the suite directory
		if (file.includes(path.sep + "suite" + path.sep)) {
			continue
		}

		const relativePath = path.relative(rootDir, file)
		const isTypeScript = file.endsWith(".ts")
		const targetFile = path.join(suiteDir, `${relativePath.replace(/[/\\]/g, "-")}`)

		try {
			// Remove existing file if it exists
			if (fs.existsSync(targetFile)) {
				fs.unlinkSync(targetFile)
			}

			// Create a reference file
			const importPath = path.relative(suiteDir, file).replace(/\\/g, "/")

			if (isTypeScript) {
				// Remove .ts extension from import path for TypeScript files
				const importPathWithoutExt = importPath.replace(/\.ts$/, "")
				const content = `// This is an auto-generated reference for VS Code Test Explorer
// Original file: ${relativePath}
import './test-helper';
// Load the VS Code module mocking before importing the test file
try {
	require('./test-helper');
} catch (err) {
	console.error('Error loading test helper:', err);
}
export * from '${importPathWithoutExt}';
`
				fs.writeFileSync(targetFile, content)
			} else {
				const content = `// This is an auto-generated reference for VS Code Test Explorer
// Original file: ${relativePath}
// Load the VS Code module mocking before importing the test file
try {
	require('./test-helper');
} catch (err) {
	console.error('Error loading test helper:', err);
}
module.exports = require('${importPath}');
`
				fs.writeFileSync(targetFile, content)
			}

			console.log(`Referenced: ${relativePath} -> ${path.relative(rootDir, targetFile)}`)
		} catch (err) {
			console.error(`Error referencing ${relativePath}:`, err.message)
		}
	}

	console.log("Test discovery setup complete")
}

setupTestDiscovery().catch((err) => {
	console.error("Setup failed:", err)
	process.exit(1)
})
