import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
	files: [
		"out/test/**/*.test.js",
		"out/test/webview/**/*.test.js", // Include webview tests
	],
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		require: ["chai"],
	},
	workspaceFolder: "test-workspace",
	version: "stable",
})
