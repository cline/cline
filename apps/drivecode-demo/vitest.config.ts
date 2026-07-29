import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/$1"),
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
	},
});
