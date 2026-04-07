import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/tests/live/**/*.live.test.ts"],
		testTimeout: 300_000,
		hookTimeout: 300_000,
		pool: "forks",
		maxWorkers: 1,
		fileParallelism: false,
	},
});
