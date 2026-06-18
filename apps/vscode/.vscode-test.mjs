import { defineConfig } from "@vscode/test-cli"
import path from "path"

const vscodeTestVersion = process.env.VSCODE_TEST_VERSION ?? "stable"

export default defineConfig({
	files: [
		"out/src/{core,test,utils,shared,integrations,hosts,services}/**/*.test.js",
		"src/{core,test,utils,shared,integrations,hosts,services}/**/*.test.js",
		// The bun unit suite (src/**/__tests__/* and src/test/services/**) runs under
		// `bun test` (run-bun-unit-tests.ts) and imports `bun:test`, which this
		// Node-based runner cannot load. Exclude it here.
		"!out/src/**/__tests__/**/*.test.js",
		"!out/src/test/services/**/*.test.js",
		"!src/**/__tests__/**/*.test.js",
		"!src/test/services/**/*.test.js",
	],
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up alias path resolution during tests
		 * @See {@link file://./test-setup.js}
		 */
		require: ["./test-setup.js"],
	},
	workspaceFolder: "test-workspace",
	version: vscodeTestVersion,
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
})
