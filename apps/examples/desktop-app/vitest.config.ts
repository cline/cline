import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./webview", import.meta.url)),
			"@cline/hub": fileURLToPath(
				new URL("../../../sdk/packages/hub/src/index.ts", import.meta.url),
			),
			"@cline/hub-daemon": fileURLToPath(
				new URL(
					"../../../sdk/packages/hub-daemon/src/index.ts",
					import.meta.url,
				),
			),
		},
	},
	test: {
		environment: "node",
	},
});
