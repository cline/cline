import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@clinebot\/core\/telemetry$/,
				replacement: resolve(
					rootDir,
					"../../packages/core/src/services/telemetry/index.ts",
				),
			},
			{
				find: /^@clinebot\/core$/,
				replacement: resolve(rootDir, "../../packages/core/src/index.ts"),
			},
			{
				find: /^@clinebot\/core\/(.+)$/,
				replacement: resolve(rootDir, "../../packages/core/src/$1"),
			},
			{
				find: /^@clinebot\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../packages/shared/src/$1"),
			},
			{
				find: /^@clinebot\/agents$/,
				replacement: resolve(rootDir, "../../packages/agents/src/index.ts"),
			},
			{
				find: /^@clinebot\/core$/,
				replacement: resolve(rootDir, "../../packages/core/src/index.ts"),
			},
			{
				find: /^@clinebot\/rpc$/,
				replacement: resolve(rootDir, "../../packages/rpc/src/index.ts"),
			},
			{
				find: /^@clinebot\/shared$/,
				replacement: resolve(rootDir, "../../packages/shared/src/index.ts"),
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
