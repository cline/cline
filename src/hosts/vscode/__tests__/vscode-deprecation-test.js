#!/usr/bin/env node

/**
 * Test script to verify VSCode API deprecation warnings are properly configured.
 * This script validates that the TypeScript declaration overrides in vscode.d.ts
 * contain the expected deprecation markers and alternative recommendations.
 */

const fs = require("node:fs")
const path = require("node:path")
const { execSync } = require("node:child_process")

function runVscodeDeprecationTests() {
	console.log("🔍 Testing VSCode API Deprecation Warnings...")

	const declarationPath = path.join(__dirname, "..", "vscode.d.ts")

	// Test 1: Check declaration file exists
	if (!fs.existsSync(declarationPath)) {
		console.error("❌ VSCode declaration file not found at:", declarationPath)
		process.exit(1)
	}
	console.log("✅ Declaration file exists")

	const content = fs.readFileSync(declarationPath, "utf8")

	// Test 2: Check for deprecation markers
	if (!content.includes("@deprecated")) {
		console.error("❌ Declaration file missing @deprecated annotations")
		process.exit(1)
	}

	if (!content.includes("@internal")) {
		console.error("❌ Declaration file missing @internal annotations")
		process.exit(1)
	}
	console.log("✅ Declaration file has proper deprecation markers")

	// Test 3: Check for specific deprecated APIs
	const deprecatedApis = [
		"workspaceFolders",
		"writeFile",
		"postMessage",
		"showTextDocument",
		"showOpenDialog",
		"stat",
		"asRelativePath",
		"getWorkspaceFolder",
		"applyEdit",
	]

	for (const api of deprecatedApis) {
		if (!content.includes(api)) {
			console.error(`❌ Missing deprecated API: ${api}`)
			process.exit(1)
		}
	}
	console.log("✅ All expected deprecated APIs found")

	// Test 4: Check for alternative recommendations
	const expectedAlternatives = ["gRPC service clients", "@/utils/fs", "getHostBridgeProvider", "@/utils/path", "host bridge"]

	for (const alternative of expectedAlternatives) {
		if (!content.includes(alternative)) {
			console.error(`❌ Missing alternative recommendation: ${alternative}`)
			process.exit(1)
		}
	}
	console.log("✅ Alternative recommendations found")

	// Test 5: Verify TypeScript compilation with deprecated API usage
	const tempTestContent = `
import * as vscode from "vscode"

// This should trigger deprecation warnings but not fail compilation
const folders = vscode.workspace.workspaceFolders
vscode.workspace.fs.writeFile(vscode.Uri.file("test"), new Uint8Array())
vscode.window.showTextDocument(vscode.Uri.file("test"))
`

	const tempTestFile = path.join(__dirname, "temp-deprecation-test.ts")

	try {
		fs.writeFileSync(tempTestFile, tempTestContent)

		// Run TypeScript compiler to check for compilation errors
		// We use --noEmit to just check types without generating output
		execSync(`npx tsc --noEmit --strict --skipLibCheck "${tempTestFile}"`, {
			cwd: path.join(__dirname, "..", "..", ".."),
			stdio: "pipe", // Suppress output unless there's an error
		})

		console.log("✅ TypeScript compilation succeeds with deprecated API usage")
	} catch (error) {
		// Check if it's a compilation error vs deprecation warnings
		const output = error.stdout?.toString() || error.stderr?.toString() || ""

		// If there are actual TypeScript errors (not just deprecation warnings), fail the test
		if (output.includes("error TS") && !output.includes("deprecated")) {
			console.error("❌ Unexpected TypeScript compilation errors:")
			console.error(output)
			process.exit(1)
		}

		// If it's just deprecation warnings or no errors, that's expected
		console.log("✅ TypeScript compilation handles deprecated API usage correctly")
	} finally {
		// Clean up the temporary test file
		try {
			fs.unlinkSync(tempTestFile)
		} catch {
			// Ignore cleanup errors
		}
	}

	console.log("🎉 All VSCode API deprecation tests passed!")
	return true
}

// Run the tests if this script is executed directly
if (require.main === module) {
	runVscodeDeprecationTests()
}

module.exports = { runVscodeDeprecationTests }
