/**
 * Watch script - runs esbuild and tsc in watch mode in parallel.
 *
 * This replaces npm-run-all's `-p watch:*` pattern which has issues
 * on Windows with cross-spawn v6 (npm-run-all's dependency).
 *
 * Usage: node scripts/watch.js
 */

const { spawn } = require("child_process")
const path = require("path")

const cwd = path.resolve(__dirname, "..")

function run(name, command, args) {
	const child = spawn(command, args, {
		cwd,
		stdio: "inherit",
		shell: true,
	})

	child.on("error", (err) => {
		console.error(`[${name}] Failed to start:`, err.message)
	})

	child.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.error(`[${name}] Exited with code ${code}`)
		}
	})

	return child
}

console.log("Starting watch mode...")
console.log("  - esbuild (--watch)")
console.log("  - tsc (--noEmit --watch)")
console.log("")

const children = [
	run("esbuild", "node", ["esbuild.mjs", "--watch"]),
	run("tsc", "npx", ["tsc", "--noEmit", "--watch", "--project", "tsconfig.json"]),
]

process.on("SIGINT", () => {
	console.log("\nShutting down...")
	for (const child of children) {
		child.kill("SIGINT")
	}
	process.exit(0)
})

process.on("SIGTERM", () => {
	for (const child of children) {
		child.kill("SIGTERM")
	}
	process.exit(0)
})
