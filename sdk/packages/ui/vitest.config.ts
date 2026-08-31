import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	resolve: {
		alias: [
			// @opentui/react imports this subpath without an extension; Node's
			// ESM loader (used for externalized deps) requires the .js suffix.
			{
				find: /^react-reconciler\/constants$/,
				replacement: "react-reconciler/constants.js",
			},
		],
	},
	test: {
		server: {
			deps: {
				// Route OpenTUI through the vite resolver so its extensionless
				// react-reconciler subpath import resolves under the node runner.
				inline: [/@opentui\//, /@opentui-ui\//, /opentui-spinner/],
			},
		},
		environment: "node",
		include: [
			"tests/**/*.test.{ts,tsx}",
			"tui/**/*.test.{ts,tsx}",
			"protocol/**/*.test.{ts,tsx}",
		],
	},
});
