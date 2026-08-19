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
		setupFiles: ["./vitest.setup.ts"],
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts", "src/tests/**"],
		// Default 5s is tight on CI: each test uses `resetModules()` + dynamic `import("./main")`
		// (large graph). Cold transforms occasionally exceed 5s on shared runners.
		testTimeout: 15_000,
		pool: "forks",
		// Windows CI runners struggle under full fork fan-out (process spawn cost
		// plus CPU contention), so cap the pool there; everywhere else the suite
		// is parallel-safe and runs ~4x faster than the old serial configuration.
		...(process.env.CI && process.platform === "win32"
			? { maxWorkers: 2 }
			: {}),
	},
});
