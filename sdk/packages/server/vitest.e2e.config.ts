import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		name: "server-e2e",
		environment: "node",
		include: ["src/**/*.e2e.test.ts"],
	},
});
