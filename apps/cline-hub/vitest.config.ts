import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: rootDir,
	resolve: {
		alias: [
			{
				find: /^@cline\/core$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/index.ts"),
			},
			{
				find: /^@cline\/core\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/$1"),
			},
			{
				find: /^@cline\/shared$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/index.ts"),
			},
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/$1"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
