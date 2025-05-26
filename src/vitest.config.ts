import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		include: ["**/__tests__/**/*.spec.ts"],
		globals: true,
	},
	resolve: {
		alias: {
			"@roo-code/types": path.resolve(__dirname, "..", "packages", "types", "src", "index.ts"),
		},
	},
})
