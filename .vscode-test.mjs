import { defineConfig } from "@vscode/test-cli"
import path from "path"

export default defineConfig({
	files: "{out/test/**/*.test.js,src/test/suite/**/*.test.js}",
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
	},
	workspaceFolder: "test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
})
