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
		// Heavy webview/React import graph; the 5s default produces false
		// timeouts when several workspace suites run in parallel.
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
