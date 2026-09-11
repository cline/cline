import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./webview", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		// First test in a file pays the @cline/core → llms module-graph import
		// cost, which sits near the 5s default under CI contention.
		testTimeout: 20_000,
	},
});
