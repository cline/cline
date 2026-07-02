/// <reference types="vitest/config" />

import { writeFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { resolve } from "path"
import { defineConfig, loadEnv, type Plugin, ViteDevServer } from "vite"

// Custom plugin to write the server port to a file
const writePortToFile = (): Plugin => {
	return {
		name: "write-port-to-file",
		configureServer(server: ViteDevServer) {
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address()
				const port = typeof address === "object" && address ? address.port : null

				if (port) {
					const portFilePath = resolve(__dirname, ".vite-port")
					writeFileSync(portFilePath, port.toString())
				} else {
					console.warn("[writePortToFile] Could not determine server port")
				}
			})
		},
	}
}

const isDevBuild = process.argv.includes("--dev-build")

// VS Code launch configurations load apps/vscode/.env for the extension host,
// but pre-launch webview tasks run as separate processes. Load the parent .env
// here so F5 builds get the same build-time constants in the webview bundle.
const parentEnv = loadEnv(process.env.NODE_ENV || "development", resolve(__dirname, ".."), "")
for (const [key, value] of Object.entries(parentEnv)) {
	process.env[key] ??= value
}

// Valid platforms, these should the keys in platform-configs.json
const VALID_PLATFORMS = ["vscode", "standalone"]
const platform = process.env.PLATFORM || "vscode" // Default to vscode

if (!VALID_PLATFORMS.includes(platform)) {
	throw new Error(`Invalid PLATFORM "${platform}". Must be one of: ${VALID_PLATFORMS.join(", ")}`)
}
console.log("Building webview for", platform)

export default defineConfig({
	base: "./",
	plugins: [react(), tailwindcss(), writePortToFile()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/setupTests.ts"],
		coverage: {
			provider: "v8",
			reportOnFailure: true,
			reporter: ["html", "lcov", "text"],
			reportsDirectory: "./coverage",
			exclude: [
				"**/*.{spec,test}.{js,jsx,ts,tsx,mjs,cjs}",

				"**/*.d.ts",
				"**/vite-env.d.ts",
				"**/*.{config,setup}.{js,ts,mjs,cjs}",

				"**/*.{css,scss,sass,less,styl}",
				"**/*.{svg,png,jpg,jpeg,gif,ico}",

				"**/*.{json,yaml,yml}",

				"**/__mocks__/**",
				"node_modules/**",
				"build/**",
				"coverage/**",
				"dist/**",
				"public/**",

				"src/services/grpc-client.ts",
			],
		},
	},
	build: {
		outDir: "build",
		reportCompressedSize: false,
		// Only minify in production build
		minify: !isDevBuild,
		// Enable inline source maps for dev build
		sourcemap: isDevBuild ? "inline" : false,
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
				entryFileNames: `assets/[name].js`,
				chunkFileNames: `assets/[name].js`,
				assetFileNames: `assets/[name].[ext]`,
				// Disable compact output for dev build
				compact: !isDevBuild,
				// Add generous formatting for dev build
				...(isDevBuild && {
					generatedCode: {
						constBindings: false,
						objectShorthand: false,
						arrowFunctions: false,
					},
				}),
			},
		},
		chunkSizeWarningLimit: 100000,
	},
	server: {
		port: 25463,
		fs: {
			allow: [resolve(__dirname, "../src/shared")],
		},
		hmr: {
			host: "localhost",
			protocol: "ws",
		},
		cors: {
			origin: "*",
			methods: "*",
			allowedHeaders: "*",
		},
	},
	define: {
		__PLATFORM__: JSON.stringify(platform),
		__NODE_PLATFORM__: JSON.stringify(process.platform),
		"process.env.CLINE_ENVIRONMENT": JSON.stringify(process.env.CLINE_ENVIRONMENT ?? "production"),
		"process.env.IS_DEV": JSON.stringify(process.env.IS_DEV),
		"process.env.IS_TEST": JSON.stringify(process.env.IS_TEST),
		"process.env.CI": JSON.stringify(process.env.CI),
		// PostHog environment variables
		"process.env.TELEMETRY_SERVICE_API_KEY": JSON.stringify(process.env.TELEMETRY_SERVICE_API_KEY),
		"process.env.ERROR_SERVICE_API_KEY": JSON.stringify(process.env.ERROR_SERVICE_API_KEY),
		"process.env.ENABLE_ERROR_AUTOCAPTURE": JSON.stringify(process.env.ENABLE_ERROR_AUTOCAPTURE),
		// OpenTelemetry environment variables
		"process.env.OTEL_TELEMETRY_ENABLED": JSON.stringify(process.env.OTEL_TELEMETRY_ENABLED),
		"process.env.OTEL_METRICS_EXPORTER": JSON.stringify(process.env.OTEL_METRICS_EXPORTER),
		"process.env.OTEL_LOGS_EXPORTER": JSON.stringify(process.env.OTEL_LOGS_EXPORTER),
		"process.env.OTEL_EXPORTER_OTLP_PROTOCOL": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_PROTOCOL),
		"process.env.OTEL_EXPORTER_OTLP_ENDPOINT": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
		"process.env.OTEL_EXPORTER_OTLP_HEADERS": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_HEADERS),
		"process.env.OTEL_METRIC_EXPORT_INTERVAL": JSON.stringify(process.env.OTEL_METRIC_EXPORT_INTERVAL),
	},
	resolve: {
		// Force a single React copy. In the bun workspace, sibling packages pull
		// react@19 into the shared store; without deduping, transitive webview deps
		// can resolve a second React instance, which bundles two copies and yields a
		// null hook dispatcher at runtime ("Cannot read properties of null (reading
		// 'useRef')"). Pin react/react-dom to webview-ui's own (React 18) copy.
		dedupe: ["react", "react-dom"],
		alias: {
			react: resolve(__dirname, "node_modules/react"),
			"react-dom": resolve(__dirname, "node_modules/react-dom"),
			"@": resolve(__dirname, "./src"),
			"@components": resolve(__dirname, "./src/components"),
			"@context": resolve(__dirname, "./src/context"),
			"@shared": resolve(__dirname, "../src/shared"),
			"@utils": resolve(__dirname, "./src/utils"),
		},
	},
})
