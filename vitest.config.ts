import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/__tests__/*.ts", "src/**/*.test.ts"],
		exclude: ["webview-ui/**/*"], // Explicitly exclude webview-ui tests
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["webview-ui/**/*"], // Exclude webview-ui from coverage
		},
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
})
