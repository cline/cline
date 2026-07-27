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
	},
});
