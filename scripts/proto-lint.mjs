#!/usr/bin/env node

/**
 * Cross-platform proto lint script (replaces proto-lint.sh)
 * Runs buf lint, buf format check, and validates RPC naming conventions.
 */

import { execSync } from "child_process"
import { readFileSync } from "fs"
import { globSync } from "glob"

const protoFiles = globSync("proto/**/*.proto")

// 1. Run buf lint
console.log("Running buf lint...")
try {
	execSync("npx buf lint", { stdio: "inherit" })
} catch {
	process.exit(1)
}

// 2. Run buf format check
console.log("Running buf format check...")
try {
	execSync("npx buf format -w --exit-code", { stdio: "inherit" })
} catch {
	console.log("Proto files were formatted")
}

// 3. Check for RPC names with consecutive capital letters
// See https://github.com/cline/cline/pull/7054
console.log("Checking RPC naming conventions...")
const regex = /rpc .*[A-Z][A-Z].*\(/
let hasError = false

for (const file of protoFiles) {
	const content = readFileSync(file, "utf-8")
	const lines = content.split("\n")
	for (let i = 0; i < lines.length; i++) {
		if (regex.test(lines[i])) {
			console.log(`${file}:${i + 1}:${lines[i].trim()}`)
			hasError = true
		}
	}
}

if (hasError) {
	console.error("Error: Proto RPC names cannot contain repeated capital letters")
	process.exit(1)
}

console.log("Proto lint passed.")
