#!/usr/bin/env node
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const esbuild = require("esbuild")

const watch = process.argv.includes("--watch")

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started")
		})
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`)
				console.error(`    ${location.file}:${location.line}:${location.column}:`)
			})
			console.log("[watch] build finished")
		})
	},
}

const srcConfig = {
	bundle: true,
	minify: false,
	sourcemap: true,
	sourcesContent: true,
	logLevel: "silent",
	entryPoints: ["src/packages/**/*.ts"],
	outdir: "out/packages",
	format: "cjs",
	platform: "node",
	define: {
		"process.env.IS_TEST": "true",
	},
	external: ["vscode"],
	plugins: [esbuildProblemMatcherPlugin],
}

async function main() {
	const srcCtx = await esbuild.context(srcConfig)

	if (watch) {
		await srcCtx.watch()
	} else {
		await srcCtx.rebuild()

		await srcCtx.dispose()
	}
}

// tsc does not delete output for source/tests that were removed or are no longer
// part of tsconfig.test.json. The VS Code test runner globs out/src/**/*.test.js,
// so stale compiled tests can still run unless we clear the test build output first.
fs.rmSync(path.join(__dirname, "..", "out", "src"), { recursive: true, force: true })
fs.rmSync(path.join(__dirname, "..", "out", "packages"), { recursive: true, force: true })

execSync("tsc -p ./tsconfig.test.json --outDir out", { encoding: "utf-8" })

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
