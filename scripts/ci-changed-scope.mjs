#!/usr/bin/env node

/**
 * Determines which CI scopes need to run based on changed files.
 *
 * Usage:
 *   node scripts/ci-changed-scope.mjs <base-ref>
 *
 * Outputs GitHub Actions outputs via $GITHUB_OUTPUT:
 *   run_core_tests=true|false        — src/ unit + integration tests
 *   run_webview_tests=true|false     — webview-ui/ vitest
 *   run_cli_tests=true|false         — cli/ vitest
 *   run_platform_tests=true|false    — testing-platform/ integration
 *   run_windows_tests=true|false     — Windows matrix leg
 *   run_quality_checks=true|false    — lint, format, typecheck
 */

import { execSync } from "node:child_process"
import { appendFileSync } from "node:fs"

const baseRef = process.argv[2] || "origin/main"
const outputFile = process.env.GITHUB_OUTPUT

let changedFiles
try {
	const diff = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: "utf-8" })
	changedFiles = diff.trim().split("\n").filter(Boolean)
} catch {
	// If diff fails (e.g. shallow clone), run everything
	console.log("Failed to compute diff — running all scopes")
	changedFiles = ["__force_all__"]
}

if (changedFiles.length === 0) {
	changedFiles = ["__force_all__"]
}

// Patterns that affect all scopes (config, CI, shared types)
const GLOBAL_PATTERNS = [
	/^package\.json$/,
	/^package-lock\.json$/,
	/^tsconfig.*\.json$/,
	/^\.mocharc\.json$/,
	/^\.vscode-test\.mjs$/,
	/^biome\.jsonc$/,
	/^proto\//,
	/^src\/shared\//,
	/^\.github\/workflows\/test\.yml$/,
	/^__force_all__$/,
]

// Component-specific patterns
const CORE_PATTERNS = [/^src\//, /^standalone\//, /^evals\//]
const WEBVIEW_PATTERNS = [/^webview-ui\//]
const CLI_PATTERNS = [/^cli\//]
const PLATFORM_PATTERNS = [/^testing-platform\//, /^standalone\//]
const WINDOWS_PATTERNS = [/^src\/integrations\/terminal\//, /^src\/utils\/shell/, /^src\/hosts\//]

function matchesAny(file, patterns) {
	return patterns.some((re) => re.test(file))
}

const isGlobal = changedFiles.some((f) => matchesAny(f, GLOBAL_PATTERNS))

const scopes = {
	run_quality_checks:
		isGlobal || changedFiles.some((f) => matchesAny(f, [...CORE_PATTERNS, ...WEBVIEW_PATTERNS, ...CLI_PATTERNS])),
	run_core_tests: isGlobal || changedFiles.some((f) => matchesAny(f, CORE_PATTERNS)),
	run_webview_tests: isGlobal || changedFiles.some((f) => matchesAny(f, WEBVIEW_PATTERNS)),
	run_cli_tests: isGlobal || changedFiles.some((f) => matchesAny(f, CLI_PATTERNS)),
	run_platform_tests: isGlobal || changedFiles.some((f) => matchesAny(f, PLATFORM_PATTERNS)),
	run_windows_tests: isGlobal || changedFiles.some((f) => matchesAny(f, WINDOWS_PATTERNS)),
}

// Log for debugging
console.log(`Changed files (${changedFiles.length}):`)
changedFiles.slice(0, 20).forEach((f) => console.log(`  ${f}`))
if (changedFiles.length > 20) console.log(`  ... and ${changedFiles.length - 20} more`)
console.log("\nScopes:")
for (const [key, value] of Object.entries(scopes)) {
	console.log(`  ${key}=${value}`)
}

// Write outputs
if (outputFile) {
	for (const [key, value] of Object.entries(scopes)) {
		appendFileSync(outputFile, `${key}=${value}\n`)
	}
} else {
	console.log("\nNo GITHUB_OUTPUT — dry run")
}
