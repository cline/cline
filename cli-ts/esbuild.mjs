import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/**
 * Plugin to resolve path aliases from the parent project
 * @type {import('esbuild').Plugin}
 */
const aliasResolverPlugin = {
	name: "alias-resolver",
	setup(build) {
		const aliases = {
			"@": path.resolve(rootDir, "src"),
			"@core": path.resolve(rootDir, "src/core"),
			"@integrations": path.resolve(rootDir, "src/integrations"),
			"@services": path.resolve(rootDir, "src/services"),
			"@shared": path.resolve(rootDir, "src/shared"),
			"@utils": path.resolve(rootDir, "src/utils"),
			"@packages": path.resolve(rootDir, "src/packages"),
			"@hosts": path.resolve(rootDir, "src/hosts"),
			"@generated": path.resolve(rootDir, "src/generated"),
			"@api": path.resolve(rootDir, "src/core/api"),
		}

		// For each alias entry, create a resolver
		Object.entries(aliases).forEach(([alias, aliasPath]) => {
			const aliasRegex = new RegExp(`^${alias}($|/.*)`)
			build.onResolve({ filter: aliasRegex }, (args) => {
				const importPath = args.path.replace(alias, aliasPath)

				// First, check if the path exists as is
				if (fs.existsSync(importPath)) {
					const stats = fs.statSync(importPath)
					if (stats.isDirectory()) {
						// If it's a directory, try to find index files
						const extensions = [".ts", ".tsx", ".js", ".jsx"]
						for (const ext of extensions) {
							const indexFile = path.join(importPath, `index${ext}`)
							if (fs.existsSync(indexFile)) {
								return { path: indexFile }
							}
						}
					} else {
						// It's a file that exists, so return it
						return { path: importPath }
					}
				}

				// If the path doesn't exist, try appending extensions
				const extensions = [".ts", ".tsx", ".js", ".jsx"]
				for (const ext of extensions) {
					const pathWithExtension = `${importPath}${ext}`
					if (fs.existsSync(pathWithExtension)) {
						return { path: pathWithExtension }
					}
				}

				// If nothing worked, return the original path and let esbuild handle the error
				return { path: importPath }
			})
		})
	},
}

/**
 * Plugin to redirect vscode imports to our shim
 * @type {import('esbuild').Plugin}
 */
const vscodeStubPlugin = {
	name: "vscode-stub",
	setup(build) {
		// Redirect 'vscode' imports to our shim
		build.onResolve({ filter: /^vscode$/ }, (args) => {
			return { path: path.join(__dirname, "src", "vscode-shim.ts") }
		})
	},
}

const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",
	setup(build) {
		build.onStart(() => {
			console.log("[cli-ts] Build started...")
		})
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`)
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`)
				}
			})
			console.log("[cli-ts] Build finished")
		})
	},
}

// Plugin to stub out optional devtools module
const stubOptionalModulesPlugin = {
	name: "stub-optional-modules",
	setup(build) {
		build.onResolve({ filter: /^react-devtools-core$/ }, () => {
			return { path: path.join(__dirname, "src", "stub-devtools.js"), external: false }
		})
	},
}

const copyWasmFiles = {
	name: "copy-wasm-files",
	setup(build) {
		build.onEnd(() => {
			const destDir = path.join(__dirname, "dist")

			// Ensure dist directory exists
			if (!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true })
			}

			// tree sitter
			const sourceDir = path.join(rootDir, "node_modules", "web-tree-sitter")

			// Copy tree-sitter.wasm
			const treeSitterWasm = path.join(sourceDir, "tree-sitter.wasm")
			if (fs.existsSync(treeSitterWasm)) {
				fs.copyFileSync(treeSitterWasm, path.join(destDir, "tree-sitter.wasm"))
			}

			// Copy language-specific WASM files
			const languageWasmDir = path.join(rootDir, "node_modules", "tree-sitter-wasms", "out")
			const languages = [
				"typescript",
				"tsx",
				"python",
				"rust",
				"javascript",
				"go",
				"cpp",
				"c",
				"c_sharp",
				"ruby",
				"java",
				"php",
				"swift",
				"kotlin",
			]

			if (fs.existsSync(languageWasmDir)) {
				languages.forEach((lang) => {
					const filename = `tree-sitter-${lang}.wasm`
					const sourcePath = path.join(languageWasmDir, filename)
					if (fs.existsSync(sourcePath)) {
						fs.copyFileSync(sourcePath, path.join(destDir, filename))
					}
				})
			}
		})
	},
}

const buildEnvVars = {
	"process.env.IS_STANDALONE": JSON.stringify("true"),
	"process.env.IS_CLI": JSON.stringify("true"),
}

if (production) {
	buildEnvVars["process.env.IS_DEV"] = "false"
}

// Set the environment
if (process.env.CLINE_ENVIRONMENT) {
	buildEnvVars["process.env.CLINE_ENVIRONMENT"] = JSON.stringify(process.env.CLINE_ENVIRONMENT)
}

const config = {
	entryPoints: [path.join(__dirname, "src", "index.ts")],
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: "silent",
	define: buildEnvVars,
	tsconfig: path.join(__dirname, "tsconfig.json"),
	plugins: [copyWasmFiles, aliasResolverPlugin, vscodeStubPlugin, stubOptionalModulesPlugin, esbuildProblemMatcherPlugin],
	format: "esm",
	sourcesContent: false,
	platform: "node",
	target: "node20",
	outfile: path.join(__dirname, "dist", "cli.mjs"),
	// These modules need to load files from the module directory at runtime
	external: ["@grpc/reflection", "grpc-health-check", "better-sqlite3", "ink", "ink-spinner", "react"],
	supported: { "top-level-await": true },
	banner: {
		js: `#!/usr/bin/env node
// Suppress all Node.js warnings (deprecation, experimental, etc.)
process.emitWarning = () => {};
import { createRequire as _createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _dirname } from 'path';
const require = _createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _dirname(__filename);`,
	},
}

async function main() {
	const ctx = await esbuild.context(config)
	if (watch) {
		await ctx.watch()
		console.log("[cli-ts] Watching for changes...")
	} else {
		await ctx.rebuild()
		await ctx.dispose()

		// Make the output executable
		const outfile = path.join(__dirname, "dist", "cli.mjs")
		if (fs.existsSync(outfile)) {
			fs.chmodSync(outfile, "755")
		}
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
