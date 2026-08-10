import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@cline\/shared$/,
				replacement: resolve(packageDir, "../shared/src/index.ts"),
			},
			{
				find: /^@cline\/core\/hub-runtime$/,
				replacement: resolve(packageDir, "../core/src/hub-runtime/index.ts"),
			},
			{
				find: /^@cline\/hub$/,
				replacement: resolve(packageDir, "../hub/src/index.ts"),
			},
		],
	},
	test: { environment: "node", include: ["src/**/*.test.ts"] },
});
