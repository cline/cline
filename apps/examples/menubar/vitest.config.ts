import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["sidecar/**/*.test.ts"],
	},
});
