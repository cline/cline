import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")
const standalone = process.argv.includes("--standalone")
const e2eBuild = process.argv.includes("--e2e-build")
const destDir = standalone ? "dist-standalone" : "dist"

/**
 * @type {import('esbuild').Plugin}
 */
const aliasResolverPlugin = {
	name: "alias-resolver",
	setup(build) {
		const aliases = {
			"@": path.resolve(__dirname, "src"),
			"@api": path.resolve(__dirname, "src/api"),
			"@core": path.resolve(__dirname, "src/core"),
			"@integrations": path.resolve(__dirname, "src/integrations"),
			"@services": path.resolve(__dirname, "src/services"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@utils": path.resolve(__dirname, "src/utils"),
			"@packages": path.resolve(__dirname, "src/packages"),
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

const copyWasmFiles = {
	name: "copy-wasm-files",
	setup(build) {
		build.onEnd(() => {
			// tree sitter
			const sourceDir = path.join(__dirname, "node_modules", "web-tree-sitter")
			const targetDir = path.join(__dirname, destDir)

			// Copy tree-sitter.wasm
			fs.copyFileSync(path.join(sourceDir, "tree-sitter.wasm"), path.join(targetDir, "tree-sitter.wasm"))

			// Copy language-specific WASM files
			const languageWasmDir = path.join(__dirname, "node_modules", "tree-sitter-wasms", "out")
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

			languages.forEach((lang) => {
				const filename = `tree-sitter-${lang}.wasm`
				fs.copyFileSync(path.join(languageWasmDir, filename), path.join(targetDir, filename))
			})
		})
	},
}

// Base configuration shared between extension and standalone builds
const baseConfig = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: "silent",
	define: production
		? { "import.meta.url": "_importMetaUrl", "process.env.IS_DEV": JSON.stringify(!production) }
		: { "import.meta.url": "_importMetaUrl" },
	tsconfig: path.resolve(__dirname, "tsconfig.json"),
	plugins: [
		copyWasmFiles,
		aliasResolverPlugin,
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
	],
	format: "cjs",
	sourcesContent: false,
	platform: "node",
	banner: {
		js: "const _importMetaUrl=require('url').pathToFileURL(__filename)",
	},
}

// Extension-specific configuration
const extensionConfig = {
	...baseConfig,
	entryPoints: ["src/extension.ts"],
	outfile: `${destDir}/extension.js`,
	external: ["vscode"],
}

// Standalone-specific configuration
const standaloneConfig = {
	...baseConfig,
	entryPoints: ["src/standalone/cline-core.ts"],
	outfile: `${destDir}/cline-core.js`,
	// These gRPC protos need to load files from the module directory at runtime,
	// so they cannot be bundled.
	external: ["vscode", "@grpc/reflection", "grpc-health-check"],
}

// E2E build script configuration
const e2eBuildConfig = {
	...baseConfig,
	entryPoints: ["src/test/e2e/utils/build.ts"],
	outfile: `${destDir}/e2e-build.mjs`,
	external: ["@vscode/test-electron", "execa"],
	sourcemap: false,
	plugins: [aliasResolverPlugin, esbuildProblemMatcherPlugin],
}

async function main() {
	const config = standalone ? standaloneConfig : e2eBuild ? e2eBuildConfig : extensionConfig
	const extensionCtx = await esbuild.context(config)
	if (watch) {
		await extensionCtx.watch()
	} else {
		await extensionCtx.rebuild()
		await extensionCtx.dispose()
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
