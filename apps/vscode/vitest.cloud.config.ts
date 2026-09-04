import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["src/test/cloud/**/*.test.ts"],
		environment: "node",
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@shared": path.resolve(__dirname, "src/shared"),
		},
	},
})
