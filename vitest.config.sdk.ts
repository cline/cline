import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["src/sdk/**/*.test.ts"],
		environment: "node",
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@core": path.resolve(__dirname, "src/core"),
			"@integrations": path.resolve(__dirname, "src/integrations"),
			"@services": path.resolve(__dirname, "src/services"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@utils": path.resolve(__dirname, "src/utils"),
			"@packages": path.resolve(__dirname, "src/packages"),
		},
	},
})
