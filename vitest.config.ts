import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			"sdk/packages/agents/vitest.config.ts",
			"sdk/packages/core/vitest.config.ts",
			"sdk/packages/llms/vitest.config.ts",
			"sdk/packages/shared/vitest.config.ts",
			"apps/cli/vitest.config.ts",
		],
	},
});