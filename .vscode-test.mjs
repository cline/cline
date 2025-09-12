import { defineConfig } from "@vscode/test-cli"
import path from "path"

export default defineConfig({
	files: "src/test/*.test.ts",
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up TypeScript compilation and alias path resolution during tests
		 * @See {@link file://./test-setup-integration.js}
		 */
		require: ["ts-node/register/transpile-only", "./test-setup-integration.js"],
	},
	workspaceFolder: "test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
	env: {
		TS_NODE_PROJECT: "./tsconfig.test.json",
	},
})
