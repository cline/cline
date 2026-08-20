import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["e2e/**/*.e2e.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		// The E2E suite runs a real Gateway (SQLite + TCP) per test file;
		// keep files sequential so locks and ports never contend.
		fileParallelism: false,
	},
});
