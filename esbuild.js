const esbuild = require("esbuild")

const production = process.argv.includes("--production")
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

const baseConfig = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: "silent",
	plugins: [
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
	],
}

const extensionConfig = {
	...baseConfig,
	entryPoints: ["src/extension.ts"],
	format: "cjs",
	sourcesContent: false,
	platform: "node",
	outfile: "dist/extension.js",
	external: ["vscode"],
}

const webviewConfig = {
	...baseConfig,
	target: "es2020",
	format: "esm",
	entryPoints: ["src/webview/main.ts"],
	outfile: "dist/webview.js",
}

async function main() {
	const extensionCtx = await esbuild.context(extensionConfig)
	const webviewCtx = await esbuild.context(webviewConfig)
	if (watch) {
		await extensionCtx.watch()
		await webviewCtx.watch()
	} else {
		await extensionCtx.rebuild()
		await extensionCtx.dispose()
		await webviewCtx.rebuild()
		await webviewCtx.dispose()
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
