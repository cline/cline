import { defineConfig } from "@vscode/test-cli"
import path from "path"

export default defineConfig({
	files: "src/test/*.test.ts",
	mocha: {
		ui: "bdd",
		timeout: 20000,
		require: ["ts-node/register/transpile-only", "./test-setup-integration.js"],
	},
	workspaceFolder: "test-workspace",
	version: "stable",
	extensionDevelopmentPath: path.resolve("./"),
	launchArgs: ["--disable-extensions"],
	env: {
		TS_NODE_PROJECT: "./tsconfig.test.json",
	},
	coverage: {
		reporter: ["lcov", "text"],
		include: ["src/**/*.ts"],
		exclude: ["**/*.d.ts", "**/*.test.ts", "**/*.spec.ts", "**/test/**", "**/tests/**", "src/test/**", "src/generated/**"],
	},
})
