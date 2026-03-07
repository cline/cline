import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/", "dist/"],
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
					exclude: ["src/**/*.markdown.test.tsx"],
				},
			},
			{
				extends: true,
				test: {
					name: "markdown",
					include: ["src/**/*.markdown.test.tsx"],
					env: { FORCE_COLOR: "3" },
				},
			},
		],
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "src/vscode-shim.ts"),
			// Match tsconfig paths - baseUrl is parent directory
			"@": path.resolve(__dirname, "../src"),
			"@api": path.resolve(__dirname, "../src/core/api"),
			"@core": path.resolve(__dirname, "../src/core"),
			"@generated": path.resolve(__dirname, "../src/generated"),
			"@hosts": path.resolve(__dirname, "../src/hosts"),
			"@integrations": path.resolve(__dirname, "../src/integrations"),
			"@packages": path.resolve(__dirname, "../src/packages"),
			"@services": path.resolve(__dirname, "../src/services"),
			"@shared": path.resolve(__dirname, "../src/shared"),
			"@utils": path.resolve(__dirname, "../src/utils"),
		},
	},
})
