import { defineConfig } from "@vscode/test-cli"
import path from "path"

export default defineConfig({
	files: "{out/test/**/*.test.js,src/test/**/*.test.js}",
	mocha: {
		ui: "bdd",
		bail: true,
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up alias path resolution and Mocha globals during tests
		 * @See {@link file://./test-setup.js}
		 */
		require: ["./test-setup.js", "./src/test/setup.js"],
	},
	workspaceFolder: "src/test/fixtures/test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
})
