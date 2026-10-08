import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.e2e.test.ts"],
		// These files start an in-process hub and a fake model server.
		testTimeout: 60_000,
		hookTimeout: 30_000,
		fileParallelism: false,
	},
});
