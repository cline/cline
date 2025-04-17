import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.spec.ts"],
		exclude: ["webview-ui/**/*"],
		reporters: "verbose",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["webview-ui/**/*"],
		},
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
})
