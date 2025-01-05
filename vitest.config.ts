import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./tests/setup.ts"],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			enabled: true
		  },

		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		deps: {
			interopDefault: true,
		},
		alias: {
			"@": path.resolve(__dirname, "./src"),
			vscode: path.resolve(__dirname, "./tests/vscode-mocks.ts"),
		},
	},
})
