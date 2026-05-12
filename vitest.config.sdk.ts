import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: [
			"src/sdk/**/*.test.ts",
			"src/core/storage/remote-config/**/*.test.ts",
			"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
			"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
		],
		environment: "node",
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "src/test/vscode-vitest-stub.ts"),
			"@": path.resolve(__dirname, "src"),
			"@api": path.resolve(__dirname, "src/core/api"),
			"@core": path.resolve(__dirname, "src/core"),
			"@generated": path.resolve(__dirname, "src/generated"),
			"@hosts": path.resolve(__dirname, "src/hosts"),
			"@integrations": path.resolve(__dirname, "src/integrations"),
			"@services": path.resolve(__dirname, "src/services"),
			"@shared/proto/cline/common": path.resolve(__dirname, "src/shared/proto/cline/common.ts"),
			"@shared/proto/cline/models": path.resolve(__dirname, "src/shared/proto/cline/models.ts"),
			"@shared/proto": path.resolve(__dirname, "src/shared/proto"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@utils": path.resolve(__dirname, "src/utils"),
			"@packages": path.resolve(__dirname, "src/packages"),
		},
	},
})
