import { defineConfig } from "@vscode/test-cli"
import path from "path"

export default defineConfig({
	files: "{out/**/*.test.js,src/**/*.test.js,!src/test/e2e/**/*.test.js,!out/src/test/e2e/**/*.test.js}",
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up alias path resolution during tests
		 * @See {@link file://./test-setup.js}
		 */
		require: ["./test-setup.js"],
	},
	workspaceFolder: "test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
})
