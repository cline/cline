import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
		// The suite's import graph is heavy; the 5s default produces false
		// timeouts when several workspace suites run in parallel.
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
