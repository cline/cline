/**
 * Verification script to check if the test environment is properly configured
 * This helps validate that tests can run via both npm and VS Code
 */
const fs = require("fs")
const path = require("path")

// Simple color helper functions since chalk might have ESM/CJS compatibility issues
const colors = {
	green: (text) => `\x1b[32m${text}\x1b[0m`,
	yellow: (text) => `\x1b[33m${text}\x1b[0m`,
	red: (text) => `\x1b[31m${text}\x1b[0m`,
}

// Set TEST_MODE for consistent test behavior
process.env.TEST_MODE = "true"

/**
 * Main verification function
 */
async function verifyTestSetup() {
	console.log(colors.green("🔍 Verifying test setup..."))

	const checks = [
		checkTestHelperExists(),
		checkVSCodeMockExists(),
		checkTestDiscoveryFiles(),
		checkRequiredScripts(),
		checkVSCodeConfig(),
	]

	const results = await Promise.all(checks)

	// Count successful checks
	const successCount = results.filter((result) => result.success).length
	console.log("\n" + colors.green(`✅ ${successCount}/${checks.length} checks passed`))

	// If any checks failed, print them
	const failedChecks = results.filter((result) => !result.success)
	if (failedChecks.length > 0) {
		console.log(colors.yellow("\n❗ Failed checks:"))
		failedChecks.forEach((check) => {
			console.log(colors.red(`  • ${check.name}: ${check.message}`))
		})

		console.log(colors.yellow("\n📋 Recommendation:"))
		console.log("  Run the following commands to fix the issues:")
		console.log("  1. npm run compile-tests")
		console.log("  2. npm run test:setup-discovery")
		console.log("  3. Reload VS Code window")
	} else {
		console.log(colors.green("\n🎉 All checks passed! Your test setup is ready."))
		console.log("\n🧪 You can now run tests using:")
		console.log("  • Via npm: npm run test:reliable")
		console.log("  • Via VS Code: Use the Test Explorer view or Debug launcher")
	}
}

/**
 * Check if test-helper.js exists
 */
async function checkTestHelperExists() {
	const result = {
		name: "Test Helper",
		success: false,
		message: "",
	}

	try {
		const testHelperPath = path.resolve(__dirname, "test-helper.js")
		const exists = fs.existsSync(testHelperPath)

		if (exists) {
			result.success = true
			result.message = "Test helper exists"
			console.log(colors.green("✅ Test helper found"))
		} else {
			result.message = "test-helper.js not found"
			console.log(colors.red("❌ Test helper missing"))
		}
	} catch (error) {
		result.message = `Error checking test helper: ${error.message}`
		console.log(colors.red(`❌ Error checking test helper: ${error.message}`))
	}

	return result
}

/**
 * Check if VS Code mock exists and is compiled
 */
async function checkVSCodeMockExists() {
	const result = {
		name: "VS Code Mock",
		success: false,
		message: "",
	}

	try {
		// Check TypeScript source
		const mockTsPath = path.resolve(__dirname, "mock/vscode.ts")
		const mockTsExists = fs.existsSync(mockTsPath)

		// Check compiled JS output
		const mockJsPath = path.resolve(process.cwd(), "out/test/mock/vscode.js")
		const mockJsExists = fs.existsSync(mockJsPath)

		if (mockTsExists && mockJsExists) {
			result.success = true
			result.message = "VS Code mock exists and is compiled"
			console.log(colors.green("✅ VS Code mock found and compiled"))
		} else if (mockTsExists && !mockJsExists) {
			result.message = "VS Code mock exists but is not compiled"
			console.log(colors.yellow("⚠️ VS Code mock exists but is not compiled"))
		} else {
			result.message = "VS Code mock not found"
			console.log(colors.red("❌ VS Code mock missing"))
		}
	} catch (error) {
		result.message = `Error checking VS Code mock: ${error.message}`
		console.log(colors.red(`❌ Error checking VS Code mock: ${error.message}`))
	}

	return result
}

/**
 * Check if test discovery files are created
 */
async function checkTestDiscoveryFiles() {
	const result = {
		name: "Test Discovery Files",
		success: false,
		message: "",
	}

	try {
		const suiteDir = path.resolve(__dirname, "suite")

		if (!fs.existsSync(suiteDir)) {
			result.message = "Test suite directory not found"
			console.log(colors.red("❌ Test suite directory not found"))
			return result
		}

		const files = fs.readdirSync(suiteDir)
		const refFiles = files.filter((file) => file.includes("-"))

		if (refFiles.length > 0) {
			result.success = true
			result.message = `${refFiles.length} test reference files found`
			console.log(colors.green(`✅ Found ${refFiles.length} test reference files`))
		} else {
			result.message = "No test reference files found"
			console.log(colors.red("❌ No test reference files found"))
		}
	} catch (error) {
		result.message = `Error checking test discovery files: ${error.message}`
		console.log(colors.red(`❌ Error checking test discovery files: ${error.message}`))
	}

	return result
}

/**
 * Check if required npm scripts exist
 */
async function checkRequiredScripts() {
	const result = {
		name: "Required Scripts",
		success: false,
		message: "",
	}

	try {
		const packageJsonPath = path.resolve(process.cwd(), "package.json")
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

		const requiredScripts = ["compile-tests", "test:setup-discovery", "test:reliable", "test:path"]

		const missingScripts = requiredScripts.filter((script) => !packageJson.scripts[script])

		if (missingScripts.length === 0) {
			result.success = true
			result.message = "All required scripts found"
			console.log(colors.green("✅ All required npm scripts found"))
		} else {
			result.message = `Missing scripts: ${missingScripts.join(", ")}`
			console.log(colors.red(`❌ Missing scripts: ${missingScripts.join(", ")}`))
		}
	} catch (error) {
		result.message = `Error checking required scripts: ${error.message}`
		console.log(colors.red(`❌ Error checking required scripts: ${error.message}`))
	}

	return result
}

/**
 * Check VS Code configuration files
 */
async function checkVSCodeConfig() {
	const result = {
		name: "VS Code Configuration",
		success: false,
		message: "",
	}

	try {
		const vscodeDir = path.resolve(process.cwd(), ".vscode")

		if (!fs.existsSync(vscodeDir)) {
			result.message = ".vscode directory not found"
			console.log(colors.red("❌ .vscode directory not found"))
			return result
		}

		// Check required config files
		const requiredFiles = ["settings.json", "launch.json", "tasks.json"]
		const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(vscodeDir, file)))

		if (missingFiles.length === 0) {
			// Check settings.json for proper Mocha Explorer configuration
			try {
				// Read the file content
				const settingsContent = fs.readFileSync(path.join(vscodeDir, "settings.json"), "utf8")

				// Strip comments from JSON (VS Code allows comments in JSON, but JSON.parse doesn't)
				const jsonContent = settingsContent.replace(/\/\/.*$/gm, "")
				const settingsJson = JSON.parse(jsonContent)

				if (
					settingsJson.mochaExplorer &&
					settingsJson.mochaExplorer.files &&
					settingsJson.mochaExplorer.require &&
					settingsJson.mochaExplorer.env &&
					settingsJson.mochaExplorer.env.TEST_MODE === "true"
				) {
					result.success = true
					result.message = "VS Code configuration is valid"
					console.log(colors.green("✅ VS Code configuration is valid"))
				} else {
					result.message = "VS Code settings.json is missing Mocha Explorer configuration"
					console.log(colors.yellow("⚠️ VS Code settings.json is missing proper Mocha Explorer configuration"))
				}
			} catch (jsonError) {
				// If we can't parse the JSON, check for settings with regex instead
				const settingsContent = fs.readFileSync(path.join(vscodeDir, "settings.json"), "utf8")

				if (
					settingsContent.includes("mochaExplorer.files") &&
					settingsContent.includes("mochaExplorer.require") &&
					settingsContent.includes("TEST_MODE")
				) {
					result.success = true
					result.message = "VS Code configuration is valid (validated with regex)"
					console.log(colors.green("✅ VS Code configuration is valid (validated with regex)"))
				} else {
					result.message = `Error parsing VS Code settings: ${jsonError.message}`
					console.log(colors.yellow(`⚠️ Error parsing VS Code settings: ${jsonError.message}`))
				}
			}
		} else {
			result.message = `Missing VS Code config files: ${missingFiles.join(", ")}`
			console.log(colors.red(`❌ Missing VS Code config files: ${missingFiles.join(", ")}`))
		}
	} catch (error) {
		result.message = `Error checking VS Code configuration: ${error.message}`
		console.log(colors.red(`❌ Error checking VS Code configuration: ${error.message}`))
	}

	return result
}

// Run verification
verifyTestSetup().catch((error) => {
	console.error("Verification failed with error:", error)
	process.exit(1)
})
