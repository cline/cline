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

// Single source of truth for the test-runner split: any *.test.ts that imports
// from "bun:test" is owned by the bun runner (scripts/run-bun-unit-tests.ts),
// and any that imports from "vitest" is owned by the vitest runner (test:vitest,
// see vitest.config.ts). Neither may be compiled into the Node-based
// @vscode/test-cli `out/` tree: Node cannot load `bun:test`, and vitest suites
// use vitest-only APIs/matchers (e.g. `toHaveBeenCalledWith`) that the mocha
// runner does not provide. Generate a tsconfig that excludes them so the
// integration compile only ever sees mocha-owned tests.
const projectRoot = path.join(__dirname, "..")
const nonMochaTestImport =
	/from\s+["'](?:bun:test|vitest(?:\/[^"']*)?|@vitest\/[^"']*)["']/
function collectNonMochaTestFiles(dir, acc) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			collectNonMochaTestFiles(full, acc)
		} else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
			if (nonMochaTestImport.test(fs.readFileSync(full, "utf-8"))) {
				acc.push(path.relative(projectRoot, full).split(path.sep).join("/"))
			}
		}
	}
	return acc
}
const nonMochaOwnedTests = collectNonMochaTestFiles(path.join(projectRoot, "src"), [])
// tsconfig.test.json is JSONC (contains comments); parse with json5 (a project dep).
const JSON5 = require("json5")
const baseTestConfig = JSON5.parse(fs.readFileSync(path.join(projectRoot, "tsconfig.test.json"), "utf-8"))
baseTestConfig.exclude = [...(baseTestConfig.exclude ?? []), ...nonMochaOwnedTests]
const generatedConfigPath = path.join(projectRoot, "tsconfig.test.generated.json")
fs.writeFileSync(generatedConfigPath, JSON.stringify(baseTestConfig, null, "\t"))

execSync(`tsc -p ${JSON.stringify(generatedConfigPath)} --outDir out`, { encoding: "utf-8" })

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
