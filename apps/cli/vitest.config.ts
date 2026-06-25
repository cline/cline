import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@cline\/core\/telemetry$/,
				replacement: resolve(
					rootDir,
					"../../sdk/packages/core/src/services/telemetry/index.ts",
				),
			},
			{
				find: /^@cline\/core$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/index.ts"),
			},
			{
				find: /^@cline\/core\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/$1"),
			},
			{
				find: /^@cline\/llms$/,
				replacement: resolve(rootDir, "../../sdk/packages/llms/src/index.ts"),
			},
			{
				find: /^@cline\/llms\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/llms/src/$1"),
			},
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/$1"),
			},
			{
				find: /^@cline\/agents$/,
				replacement: resolve(rootDir, "../../sdk/packages/agents/src/index.ts"),
			},
			{
				find: /^@cline\/core$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/index.ts"),
			},
			{
				find: /^@cline\/shared$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/index.ts"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts", "src/tests/**"],
		// Default 5s is tight on CI: each test uses `resetModules()` + dynamic `import("./main")`
		// (large graph). Cold transforms occasionally exceed 5s on shared runners.
		testTimeout: 15_000,
		pool: "forks",
		maxWorkers: 1,
		fileParallelism: false,
	},
});
