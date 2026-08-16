import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/tests/**/*.test.ts"],
		exclude: ["src/**/*.tuistory.e2e.test.ts"],
		testTimeout: 120_000,
		hookTimeout: 120_000,
		maxWorkers: 4,
		pool: "forks",
	},
});
