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
		alias: [
			// Vite drops Zod's named namespace export on Windows while preserving
			// its default export. Restore the package's declared `z` export for tests.
			{ find: /^zod$/, replacement: path.resolve(__dirname, "src/test/zod-vitest-stub.ts") },
			{ find: "@", replacement: path.resolve(__dirname, "src") },
			{ find: "@core", replacement: path.resolve(__dirname, "src/core") },
			{ find: "@utils", replacement: path.resolve(__dirname, "src/utils") },
			{ find: "@shared", replacement: path.resolve(__dirname, "src/shared") },
		],
	},
})
