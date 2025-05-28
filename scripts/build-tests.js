const { execSync } = require("child_process")
const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const watch = process.argv.includes("--watch")

/**
 * Copy fixtures directory to the output directory
 */
function copyFixtures() {
	const srcDir = path.join(__dirname, "..", "src", "test", "fixtures")
	const destDir = path.join(__dirname, "..", "out", "test", "fixtures")

	// Create output directory if it doesn't exist
	if (!fs.existsSync(destDir)) {
		fs.mkdirSync(destDir, { recursive: true })
	}

	// Copy each file in the fixtures directory
	const files = fs.readdirSync(srcDir)
	for (const file of files) {
		const srcPath = path.join(srcDir, file)
		const destPath = path.join(destDir, file)

		// Skip directories
		if (fs.statSync(srcPath).isDirectory()) continue

		// Copy the file
		fs.copyFileSync(srcPath, destPath)
	}

	console.log("Fixtures copied successfully")
}

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
		"process.env.IS_DEV": "true",
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

execSync("tsc -p ./tsconfig.test.json --outDir out", { encoding: "utf-8" })

// Copy fixtures to output directory
copyFixtures()

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
