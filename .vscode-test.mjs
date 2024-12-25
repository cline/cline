import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
	files: "out/**/*.test.js",
	mocha: {
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
	},
})
