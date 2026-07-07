import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/example.test.ts"],
		passWithNoTests: true,
	},
});
