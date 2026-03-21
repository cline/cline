import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@clinebot\/core\/telemetry\/opentelemetry$/,
				replacement: resolve(
					rootDir,
					"../../packages/core/src/telemetry/opentelemetry.ts",
				),
			},
			{
				find: /^@clinebot\/core\/node$/,
				replacement: resolve(rootDir, "../../packages/core/src/index.node.ts"),
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
				find: /^@clinebot\/llms$/,
				replacement: resolve(rootDir, "../../packages/llms/src/index.ts"),
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
	},
});
