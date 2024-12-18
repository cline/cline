import { defineConfig } from "@vscode/test-cli"

export default defineConfig([
	{
		label: "VSCode Extension Tests",
		files: "out/src/test/vscode/*.test.js",
		version: "stable",
	},
])
