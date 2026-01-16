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
 * Alias resolver plugin - resolves path aliases from tsconfig.json
 * This is adapted from the root esbuild.mjs to work with the CLI's directory structure
 * @type {import('esbuild').Plugin}
 */
/**
 * Plugin to resolve 'vscode' imports to the standalone shim
 * The shim provides stub implementations for vscode APIs in standalone mode
 * @type {import('esbuild').Plugin}
 */
const vscodeShimPlugin = {
	name: "vscode-shim",
	setup(build) {
		const vscodeShimPath = path.resolve(rootDir, "standalone/runtime-files/vscode/index.js")

		// Resolve 'vscode' to our virtual shim entry
		build.onResolve({ filter: /^vscode$/ }, () => {
			return {
				path: vscodeShimPath,
				// Use sideEffects: false to avoid issues with initialization order
			}
		})

		// The vscode-stubs.js uses implicit global assignment (vscode = {})
		// which fails in strict mode. We need to load it without strict mode
		// by marking it and its dependencies as external
		build.onLoad({ filter: /vscode-stubs\.js$/ }, async (args) => {
			const contents = fs.readFileSync(args.path, "utf8")
			// Wrap the contents to declare vscode as a local variable
			return {
				contents: `var vscode;\n${contents}`,
				loader: "js",
			}
		})
	},
}

const aliasResolverPlugin = {
	name: "alias-resolver",
	setup(build) {
		// Aliases point to the root src directory (parent of cli-ts)
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
			// CLI-specific aliases
			"@cli": path.resolve(__dirname, "src"),
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
 * Problem matcher plugin for watch mode
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
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`)
				}
			})
			console.log("[watch] build finished")
		})
	},
}

// Read package.json for version injection
const rootPackageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8"))

// Build environment variables
const buildEnvVars = {
	"import.meta.url": "_importMetaUrl",
	"process.env.IS_STANDALONE": JSON.stringify("true"),
	// Inject the Cline version at build time to avoid runtime package.json loading
	__CLINE_VERSION__: JSON.stringify(rootPackageJson.version),
}

if (production) {
	buildEnvVars["process.env.IS_DEV"] = "false"
}

/**
 * Plugin to handle package.json requires by bundling them inline
 * This handles JSON files that may have broken relative paths after bundling
 * @type {import('esbuild').Plugin}
 */
const jsonResolverPlugin = {
	name: "json-resolver",
	setup(build) {
		// Handle requires to package.json files by resolving and loading them inline
		build.onResolve({ filter: /\.json$/ }, (args) => {
			// Only handle relative paths
			if (args.path.startsWith(".")) {
				const resolvedPath = path.resolve(args.resolveDir, args.path)
				if (fs.existsSync(resolvedPath)) {
					return {
						path: resolvedPath,
						namespace: "json-inline",
					}
				}
			}
			return null
		})

		// Load JSON files and emit them as CommonJS modules with the JSON data
		build.onLoad({ filter: /.*/, namespace: "json-inline" }, (args) => {
			const contents = fs.readFileSync(args.path, "utf8")
			return {
				contents: `module.exports = ${contents}`,
				loader: "js",
			}
		})
	},
}

// CLI-specific configuration
const cliConfig = {
	entryPoints: [path.resolve(__dirname, "src/index.ts")],
	outfile: path.resolve(__dirname, "dist/index.cjs"),
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: "silent",
	define: buildEnvVars,
	tsconfig: path.resolve(__dirname, "tsconfig.json"),
	plugins: [vscodeShimPlugin, jsonResolverPlugin, aliasResolverPlugin, esbuildProblemMatcherPlugin],
	format: "cjs",
	sourcesContent: false,
	platform: "node",
	loader: {
		".json": "json", // Bundle JSON files inline
	},
	banner: {
		js: "const _importMetaUrl=require('url').pathToFileURL(__filename)",
	},
	// These modules need to load files from the module directory at runtime,
	// so they cannot be bundled. Note: vscode is handled by vscodeShimPlugin
	external: ["@grpc/reflection", "grpc-health-check", "better-sqlite3"],
}

/**
 * Copy runtime files needed for standalone mode
 * The vscode-context.ts expects package.json at INSTALL_DIR/extension/package.json
 */
async function copyRuntimeFiles() {
	const extensionDir = path.resolve(__dirname, "dist/extension")

	// Create extension directory
	if (!fs.existsSync(extensionDir)) {
		fs.mkdirSync(extensionDir, { recursive: true })
	}

	// Copy package.json from standalone/runtime-files to dist/extension
	const sourcePackageJson = path.resolve(rootDir, "standalone/runtime-files/package.json")
	const destPackageJson = path.resolve(extensionDir, "package.json")

	if (fs.existsSync(sourcePackageJson)) {
		fs.copyFileSync(sourcePackageJson, destPackageJson)
	} else {
		console.warn(`Warning: ${sourcePackageJson} not found, creating minimal package.json`)
		// Fallback: create a minimal package.json with version from root
		const minimalPackageJson = {
			name: "cline",
			version: rootPackageJson.version,
			displayName: "Cline",
		}
		fs.writeFileSync(destPackageJson, JSON.stringify(minimalPackageJson, null, 2))
	}
}

async function main() {
	const ctx = await esbuild.context(cliConfig)
	if (watch) {
		await ctx.watch()
		await copyRuntimeFiles()
		console.log("Watching for changes...")
	} else {
		await ctx.rebuild()
		await copyRuntimeFiles()
		await ctx.dispose()
		console.log("Build completed successfully!")
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
