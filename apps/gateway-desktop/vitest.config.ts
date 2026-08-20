import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@shared": `${root}shared`,
			"@": `${root}webview`,
		},
	},
	test: {
		environment: "node",
		include: [
			"shared/**/*.test.ts",
			"native/**/*.test.ts",
			"webview/lib/**/*.test.ts",
		],
		exclude: ["**/*.e2e.test.ts", "node_modules/**"],
		testTimeout: 15_000,
	},
});
