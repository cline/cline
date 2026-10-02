import path from "node:path"
import { defineConfig } from "vitest/config"

// Vitest config for the VSCode extension's SDK-adapter and model-catalog
// unit tests. (The bulk of the extension's unit tests still run under mocha
// via `test:unit`; these suites are vitest-native.)
export default defineConfig({
	test: {
		include: [
			"src/sdk/**/*.test.ts",
			"src/hosts/vscode/VscodeEditPreview.test.ts",
			"src/shared/vsCodeSelectorUtils.test.ts",
			"src/shared/content-limits.test.ts",
			"src/shared/proto-conversions/models/**/*.test.ts",
			"src/core/storage/remote-config/**/*.test.ts",
			"src/core/controller/account/setUserOrganization.test.ts",
			"src/core/controller/remoteConfig/**/*.test.ts",
			"src/core/controller/state/**/*.test.ts",
			"src/core/controller/slash/**/*.test.ts",
			"src/services/ClineClientIdentity.test.ts",
			"src/services/mcp/__tests__/settingsLock.test.ts",
			"src/shared/model-catalog/provider-helpers.test.ts",
			"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
			"src/core/controller/models/__tests__/providerSwitchNormalization.test.ts",
			"src/core/controller/models/__tests__/resolveModelInfo.test.ts",
			"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
			"src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts",
			"src/core/controller/models/__tests__/refreshProviderModels.test.ts",
			"src/core/controller/models/__tests__/refreshOpenAiModels.test.ts",
		],
		environment: "node",
		setupFiles: ["./src/test/vitest-setup.ts"],
		// Several suites lazily `await import()` their subject inside the first test
		// (needed so vi.mock factories apply first). That import pulls in heavy
		// workspace packages (@cline/core/@cline/llms/@cline/shared), and on loaded
		// CI runners the first test in a file can blow past the 5s default and flake
		// (seen in catalog.test.ts and resolveModelInfo.test.ts). Raise the per-test
		// timeout so import cost attributed to the first test doesn't cause flakes.
		testTimeout: 20000,
		// Some matched files are intentionally-empty placeholders that point to
		// where the real suite lives (e.g. sdk-control-plane.test.ts), so an
		// empty file should not fail the run.
		passWithNoTests: true,
	},
	resolve: {
		alias: [
			// Vite drops Zod's named namespace export on Windows while preserving
			// its default export. Restore the package's declared `z` export for tests.
			{ find: /^zod$/, replacement: path.resolve(__dirname, "src/test/zod-vitest-stub.ts") },
			{ find: "@cline/core", replacement: path.resolve(__dirname, "src/test/cline-core-vitest-stub.ts") },
			{ find: "@cline/llms", replacement: path.resolve(__dirname, "node_modules/@cline/llms/dist/index.js") },
			// Map @cline/shared subpath exports explicitly. The bare "@cline/shared"
			// alias below does not cover subpaths (e.g. "@cline/shared/storage"), and
			// Vite's fallback Node resolution does not read the package `exports` map
			// here, so subpath imports fail with "Cannot find package". Keep the more
			// specific subpath alias(es) before the bare package alias.
			{
				find: "@cline/shared/storage",
				replacement: path.resolve(__dirname, "node_modules/@cline/shared/dist/storage/index.js"),
			},
			{ find: "@cline/shared/db", replacement: path.resolve(__dirname, "node_modules/@cline/shared/dist/db/index.js") },
			{ find: "@cline/shared", replacement: path.resolve(__dirname, "node_modules/@cline/shared/dist/index.js") },
			{ find: "vscode", replacement: path.resolve(__dirname, "src/test/vscode-vitest-stub.ts") },
			{ find: "@", replacement: path.resolve(__dirname, "src") },
			{ find: "@api", replacement: path.resolve(__dirname, "src/core/api") },
			{ find: "@core", replacement: path.resolve(__dirname, "src/core") },
			{ find: "@generated", replacement: path.resolve(__dirname, "src/generated") },
			{ find: "@hosts", replacement: path.resolve(__dirname, "src/hosts") },
			{ find: "@integrations", replacement: path.resolve(__dirname, "src/integrations") },
			{ find: "@services", replacement: path.resolve(__dirname, "src/services") },
			{ find: "@shared/proto/cline/common", replacement: path.resolve(__dirname, "src/shared/proto/cline/common.ts") },
			{ find: "@shared/proto/cline/models", replacement: path.resolve(__dirname, "src/shared/proto/cline/models.ts") },
			{ find: "@shared/proto", replacement: path.resolve(__dirname, "src/shared/proto") },
			{ find: "@shared", replacement: path.resolve(__dirname, "src/shared") },
			{ find: "@utils", replacement: path.resolve(__dirname, "src/utils") },
			{ find: "@packages", replacement: path.resolve(__dirname, "src/packages") },
		],
	},
})
