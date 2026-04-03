import { resolve } from "path"
import { defineConfig, type Plugin } from "vitest/config"

const sdkDir = (pkg: string, file: string) => resolve(__dirname, `node_modules/@clinebot/${pkg}/${file}`)

/**
 * Vite plugin to redirect @clinebot SDK imports that resolve to
 * non-existent src/ files (leaked 'development' condition in published
 * packages) to the corresponding dist/ files.
 */
function sdkSrcToDistPlugin(): Plugin {
	return {
		name: "sdk-src-to-dist",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer) return null
			// Catch resolved absolute paths to @clinebot/*/src/*.ts
			if (source.includes("node_modules/@clinebot/") && source.includes("/src/")) {
				const fixed = source.replace(
					/\/node_modules\/@clinebot\/([^/]+)\/src\/(.+)\.ts$/,
					"/node_modules/@clinebot/$1/dist/$2.js",
				)
				if (fixed !== source) return fixed
			}
			return null
		},
	}
}

export default defineConfig({
	plugins: [sdkSrcToDistPlugin()],
	test: {
		root: ".",
		include: ["src/sdk/**/*.test.ts"],
		environment: "node",
		globals: true,
		testTimeout: 10_000,
		// Force Vitest to process SDK packages through Vite's pipeline
		// so that aliases and the resolveId plugin apply to their imports.
		server: {
			deps: {
				inline: [/@clinebot\//],
			},
		},
	},
	resolve: {
		conditions: ["node", "import", "module", "default"],
		alias: [
			// SDK packages: force Node.js dist entries (bypass browser/development conditions)
			{ find: "@clinebot/llms/providers/browser", replacement: sdkDir("llms", "dist/providers.browser.js") },
			{ find: "@clinebot/llms/providers", replacement: sdkDir("llms", "dist/providers.js") },
			{ find: "@clinebot/llms/models", replacement: sdkDir("llms", "dist/models.js") },
			{ find: "@clinebot/llms/runtime", replacement: sdkDir("llms", "dist/runtime.js") },
			{ find: "@clinebot/llms/browser", replacement: sdkDir("llms", "dist/index.browser.js") },
			{ find: "@clinebot/llms", replacement: sdkDir("llms", "dist/index.js") },
			{ find: "@clinebot/agents/node", replacement: sdkDir("agents", "dist/index.node.js") },
			{ find: "@clinebot/agents/browser", replacement: sdkDir("agents", "dist/index.browser.js") },
			{ find: "@clinebot/agents", replacement: sdkDir("agents", "dist/index.js") },
			{ find: "@clinebot/shared/storage", replacement: sdkDir("shared", "dist/storage/index.js") },
			{ find: "@clinebot/shared/db", replacement: sdkDir("shared", "dist/db/index.js") },
			{ find: "@clinebot/shared/browser", replacement: sdkDir("shared", "dist/index.browser.js") },
			{ find: "@clinebot/shared", replacement: sdkDir("shared", "dist/index.js") },
			{ find: "@clinebot/core/telemetry", replacement: sdkDir("core", "dist/telemetry/index.js") },
			{ find: "@clinebot/core", replacement: sdkDir("core", "dist/index.js") },
			// Project path aliases
			{ find: /^@sdk\/(.*)/, replacement: resolve(__dirname, "./src/sdk/$1") },
			{ find: /^@\/(.*)/, replacement: resolve(__dirname, "./src/$1") },
			{ find: /^@shared\/(.*)/, replacement: resolve(__dirname, "./src/shared/$1") },
			{ find: /^@core\/(.*)/, replacement: resolve(__dirname, "./src/core/$1") },
			{ find: /^@hosts\/(.*)/, replacement: resolve(__dirname, "./src/hosts/$1") },
			{ find: /^@services\/(.*)/, replacement: resolve(__dirname, "./src/services/$1") },
			{ find: /^@integrations\/(.*)/, replacement: resolve(__dirname, "./src/integrations/$1") },
			{ find: /^@utils\/(.*)/, replacement: resolve(__dirname, "./src/utils/$1") },
		],
	},
})
