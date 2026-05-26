#!/usr/bin/env node

// Wraps the marketplace publish flow (vsce + ovsx) so the .vsix gets packaged
// with the marketplace-flavored README instead of the GitHub-flavored README.
//
// vsce reads README.md from the extension root at publish time and there's no
// flag to point it elsewhere, so we swap README.marketplace.md into place
// first and restore the original on the way out. The swap helper is
// idempotent, so this is safe to run nested under another wrapper (e.g., the
// CI step in .github/workflows/ext-vscode-publish-stable.yml that also packages a .vsix for the
// GitHub release artifact before invoking this script).
//
// Usage:
//   node scripts/publish-marketplace.mjs                  # release channel
//   node scripts/publish-marketplace.mjs --pre-release    # pre-release channel

import { execFileSync } from "node:child_process"
import { restore, swapIn } from "./marketplace-readme.mjs"

const isPrerelease = process.argv.includes("--pre-release")

const result = swapIn()

let interrupted = false
const cleanupOnSignal = (exitCode) => () => {
	interrupted = true
	try {
		if (!result.skipped) {
			restore()
		}
	} catch (err) {
		console.error(`marketplace-readme: failed to restore on signal: ${err.message}`)
	}
	process.exit(exitCode)
}
process.on("SIGINT", cleanupOnSignal(130))
process.on("SIGTERM", cleanupOnSignal(143))

try {
	const vsceArgs = ["publish", "--allow-package-secrets", "sendgrid"]
	if (isPrerelease) {
		vsceArgs.push("--pre-release")
	}
	execFileSync("vsce", vsceArgs, { stdio: "inherit" })

	const ovsxArgs = ["ovsx", "publish"]
	if (isPrerelease) {
		ovsxArgs.push("--pre-release")
	}
	execFileSync("npx", ovsxArgs, { stdio: "inherit" })
} finally {
	if (!interrupted && !result.skipped) {
		restore()
	}
}
