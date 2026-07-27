import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.interactive.e2e.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
