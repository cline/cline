import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		watch: false,
		reporters: ["dot"],
		silent: true,
		environment: "jsdom",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@src": path.resolve(__dirname, "./src"),
			"@roo": path.resolve(__dirname, "../src/shared"),
		},
	},
})
