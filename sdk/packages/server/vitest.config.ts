import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		name: "server",
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
	},
});
