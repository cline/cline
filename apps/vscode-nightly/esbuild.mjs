import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

import { getGitSha, copyPaths, copyLocales, copyWasms, generatePackageJson } from "@roo-code/build"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
	const name = "extension-nightly"
	const production = process.argv.includes("--production")
	const minify = production
	const sourcemap = !production

	const overrideJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.nightly.json"), "utf8"))
	console.log(`[${name}] name: ${overrideJson.name}`)
	console.log(`[${name}] version: ${overrideJson.version}`)

	const gitSha = getGitSha()
	console.log(`[${name}] gitSha: ${gitSha}`)

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const buildOptions = {
		bundle: true,
		minify,
		sourcemap,
		logLevel: "silent",
		format: "cjs",
		sourcesContent: false,
		platform: "node",
		define: {
			"process.env.PKG_NAME": '"roo-code-nightly"',
			"process.env.PKG_VERSION": `"${overrideJson.version}"`,
			"process.env.PKG_OUTPUT_CHANNEL": '"Roo-Code-Nightly"',
			...(gitSha ? { "process.env.PKG_SHA": `"${gitSha}"` } : {}),
		},
	}

	const srcDir = path.join(__dirname, "..", "..", "src")
	const buildDir = path.join(__dirname, "build")
	const distDir = path.join(buildDir, "dist")

	console.log(`[${name}] srcDir: ${srcDir}`)
	console.log(`[${name}] buildDir: ${buildDir}`)
	console.log(`[${name}] distDir: ${distDir}`)

	// Clean build directory before starting new build
	if (fs.existsSync(buildDir)) {
		console.log(`[${name}] Cleaning build directory: ${buildDir}`)
		fs.rmSync(buildDir, { recursive: true, force: true })
	}

	/**
	 * @type {import('esbuild').Plugin[]}
	 */
	const plugins = [
		{
			name: "copyPaths",
			setup(build) {
				build.onEnd(() => {
					copyPaths(
						[
							["../README.md", "README.md"],
							["../CHANGELOG.md", "CHANGELOG.md"],
							["../LICENSE", "LICENSE"],
							["../.env", ".env", { optional: true }],
							[".vscodeignore", ".vscodeignore"],
							["assets", "assets"],
							["integrations", "integrations"],
							["node_modules/vscode-material-icons/generated", "assets/vscode-material-icons"],
							["../webview-ui/audio", "webview-ui/audio"],
						],
						srcDir,
						buildDir,
					)
				})
			},
		},
		{
			name: "generatePackageJson",
			setup(build) {
				build.onEnd(() => {
					const packageJson = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8"))

					const generatedPackageJson = generatePackageJson({
						packageJson,
						overrideJson,
						substitution: ["roo-cline", "roo-code-nightly"],
					})

					fs.writeFileSync(path.join(buildDir, "package.json"), JSON.stringify(generatedPackageJson, null, 2))
					console.log(`[generatePackageJson] Generated package.json`)

					let count = 0

					fs.readdirSync(path.join(srcDir)).forEach((file) => {
						if (file.startsWith("package.nls")) {
							fs.copyFileSync(path.join(srcDir, file), path.join(buildDir, file))
							count++
						}
					})

					console.log(`[generatePackageJson] Copied ${count} package.nls*.json files to ${buildDir}`)

					const nlsPkg = JSON.parse(fs.readFileSync(path.join(srcDir, "package.nls.json"), "utf8"))

					const nlsNightlyPkg = JSON.parse(
						fs.readFileSync(path.join(__dirname, "package.nls.nightly.json"), "utf8"),
					)

					fs.writeFileSync(
						path.join(buildDir, "package.nls.json"),
						JSON.stringify({ ...nlsPkg, ...nlsNightlyPkg }, null, 2),
					)

					console.log(`[generatePackageJson] Generated package.nls.json`)
				})
			},
		},
		{
			name: "copyWasms",
			setup(build) {
				build.onEnd(() => copyWasms(srcDir, distDir))
			},
		},
		{
			name: "copyLocales",
			setup(build) {
				build.onEnd(() => copyLocales(srcDir, distDir))
			},
		},
	]

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const extensionBuildOptions = {
		...buildOptions,
		plugins,
		entryPoints: [path.join(srcDir, "extension.ts")],
		outfile: path.join(distDir, "extension.js"),
		external: ["vscode"],
	}

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const workerBuildOptions = {
		...buildOptions,
		entryPoints: [path.join(srcDir, "workers", "countTokens.ts")],
		outdir: path.join(distDir, "workers"),
	}

	const [extensionBuildContext, workerBuildContext] = await Promise.all([
		esbuild.context(extensionBuildOptions),
		esbuild.context(workerBuildOptions),
	])

	await Promise.all([
		extensionBuildContext.rebuild(),
		extensionBuildContext.dispose(),

		workerBuildContext.rebuild(),
		workerBuildContext.dispose(),
	])
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
