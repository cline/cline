import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.tuistory.e2e.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
