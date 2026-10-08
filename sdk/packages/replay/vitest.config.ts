import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
		// Hang guards for filesystem-heavy bundle tests on slow CI runners, not
		// timing assertions.
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
