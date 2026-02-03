import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import * as esbuild from "esbuild"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

// Load .env from repo root
dotenv.config({ path: path.join(rootDir, ".env") })

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/**
 * Plugin to resolve path aliases from the parent project
 */
const aliasResolverPlugin: esbuild.Plugin = {
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

				// Handle .js -> .ts extension mapping (common in ESM TypeScript projects)
				if (importPath.endsWith(".js")) {
					const tsPath = importPath.replace(/\.js$/, ".ts")
					if (fs.existsSync(tsPath)) {
						return { path: tsPath }
					}
					const tsxPath = importPath.replace(/\.js$/, ".tsx")
					if (fs.existsSync(tsxPath)) {
						return { path: tsxPath }
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
 */
const vscodeStubPlugin: esbuild.Plugin = {
	name: "vscode-stub",
	setup(build) {
		// Redirect 'vscode' imports to our shim
		build.onResolve({ filter: /^vscode$/ }, () => {
			return { path: path.join(__dirname, "src", "vscode-shim.ts") }
		})
	},
}

const esbuildProblemMatcherPlugin: esbuild.Plugin = {
	name: "esbuild-problem-matcher",
	setup(build) {
		build.onStart(() => {
			console.log("[cli esbuild] Build started...")
		})
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`)
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`)
				}
			})
			console.log("[cli esbuild] Build finished")
		})
	},
}

// Plugin to stub out optional devtools module
const stubOptionalModulesPlugin: esbuild.Plugin = {
	name: "stub-optional-modules",
	setup(build) {
		build.onResolve({ filter: /^react-devtools-core$/ }, () => {
			return { path: path.join(__dirname, "src", "stub-devtools.js"), external: false }
		})
	},
}

const copyWasmFiles: esbuild.Plugin = {
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

const buildEnvVars: Record<string, string> = {
	"process.env.IS_STANDALONE": JSON.stringify("true"),
	"process.env.IS_CLI": JSON.stringify("true"),
}

const buildTimeEnvs = [
	"TELEMETRY_SERVICE_API_KEY",
	"ERROR_SERVICE_API_KEY",
	"POSTHOG_TELEMETRY_ENABLED",
	"OTEL_TELEMETRY_ENABLED",
	"OTEL_LOGS_EXPORTER",
	"OTEL_METRICS_EXPORTER",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_METRIC_EXPORT_INTERVAL",
	"CLINE_ENVIRONMENT",
]

buildTimeEnvs.forEach((envVar) => {
	if (process.env[envVar]) {
		console.log(`[cli esbuild] ${envVar} env var is set`)
		buildEnvVars[`process.env.${envVar}`] = JSON.stringify(process.env[envVar])
	}
})

if (production) {
	buildEnvVars["process.env.IS_DEV"] = "false"
}

const config: esbuild.BuildOptions = {
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
	external: [
		"@grpc/reflection",
		"grpc-health-check",
		"better-sqlite3",
		"ink",
		"ink-spinner",
		"ink-picture",
		"react",
		"aws4fetch",
		"pino",
		"pino-roll",
		"@vscode/ripgrep", // Uses __dirname to locate the binary
	],
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
		console.log("[cli] Watching for changes...")
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
